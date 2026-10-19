import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpecNode } from '../shared/types.ts';
import { mockResponse, sampleSchema, validateMockRequest, mockControls, sampleRequest, type RequestIssue } from '../shared/mock.ts';
import { summarizeSpecChanges } from '../src/lib/spec-diff.ts';
import { Miniflare } from 'miniflare';
import { readdir, readFile } from 'node:fs/promises';
import { testAdapter, type JsonResponse } from './helpers.ts';
const spec: SpecNode = { openapi: '3.0.3', info: { title: 'Mock QA', version: '1' }, paths: {
  '/pets/{id}': { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' }, examples: { normal: { value: { id: 42, name: 'Mochi' } }, empty: { value: null } } } } }, 404: { description: 'missing', content: { 'application/json': { example: { error: 'missing' } } } } } } },
  '/pets/count': { get: { responses: { 200: { description: 'count', content: { 'application/json': { schema: { type: 'integer', minimum: 2 } } } } } } },
  '/pets': { post: { responses: { 201: { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } }, delete: { responses: { 204: { description: 'empty' } } } },
}, components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Generated' }, privateValue: { type: 'string', writeOnly: true } } } } } };
test('mock prioritizes examples, selects statuses and named examples, matches static paths first', () => {
  assert.deepEqual(JSON.parse(mockResponse(spec, 'GET', '/pets/7').body!), { id: 42, name: 'Mochi' });
  assert.equal(mockResponse(spec, 'GET', '/pets/7', '404').status, 404);
  assert.equal(mockResponse(spec, 'GET', '/pets/7', '200', 'empty').body, 'null');
  assert.equal(mockResponse(spec, 'GET', '/pets/count').body, '2');
  assert.deepEqual(JSON.parse(mockResponse(spec, 'POST', '/pets').body!), { id: 0, name: 'Generated' });
  assert.equal(mockResponse(spec, 'DELETE', '/pets').body, null);
  assert.throws(() => mockResponse(spec, 'PATCH', '/pets/count'), (e: any) => e.status === 405);
  assert.throws(() => mockResponse(spec, 'GET', '/nope'), (e: any) => e.status === 404);
  assert.throws(() => mockResponse(spec, 'GET', '/pets/1', '500'), (e: any) => e.status === 400);
  assert.throws(() => mockResponse(spec, 'GET', '/pets/1', '', 'missing'), (e: any) => e.status === 400);
});
test('mock handles Swagger 2 examples and bounded schema samples without fetching refs', () => {
  const legacy: SpecNode = { swagger: '2.0', paths: { '/x': { get: { responses: { 200: { examples: { 'application/json': { legacy: true } } } } } } } };
  assert.equal(mockResponse(legacy, 'GET', '/x').body, '{"legacy":true}');
  assert.deepEqual(sampleSchema({}, { allOf: [{ type: 'object', properties: { x: { enum: ['a'] } } }, { type: 'object', properties: { y: { type: 'boolean' } } }] }), Object.assign(Object.create(null), { x: 'a', y: true }));
  assert.equal(sampleSchema({}, { type: 'array', minItems: 100, items: { type: 'string' } }).length, 5);
  assert.throws(() => sampleSchema({}, { $ref: 'https://private.test/schema' }), /參照/);
  const cyclic: SpecNode = { components: { schemas: { Loop: { properties: { next: { $ref: '#/components/schemas/Loop' } } } } } };
  assert.throws(() => sampleSchema(cyclic, { $ref: '#/components/schemas/Loop' }), /循環/);
  const huge = structuredClone(spec); huge.paths['/pets/{id}'].get.responses[200].content['application/json'].examples.normal.value = 'x'.repeat(262145);
  assert.throws(() => mockResponse(huge, 'GET', '/pets/1'), /256 KB/);
  assert.throws(() => sampleSchema({}, { $ref: '#/__proto__' }));
});
test('semantic diff flags required inputs, referenced output removals and types, ignoring object order', () => {
  const next = structuredClone(spec);
  next.paths['/pets/{id}'].get.parameters = [{ in: 'query', name: 'token', required: true, schema: { type: 'string' } }];
  delete next.components.schemas.Pet.properties.name;
  next.components.schemas.Pet.properties.id.type = 'string';
  next.paths['/pets/{id}'].get.security = [{ bearer: [] }];
  const diff = summarizeSpecChanges(spec, next);
  assert.ok(diff.hasBreaking);
  assert.ok(diff.changes.some(c => c.label.includes('query:token') && c.risk === 'breaking'));
  assert.ok(diff.changes.some(c => c.label.includes('Response 201') && c.label.includes('.name') && c.risk === 'breaking'));
  assert.ok(diff.changes.some(c => c.label.includes('Schema Pet.id') && c.detail.includes('integer')));
  assert.ok(diff.changes.some(c => c.label.includes('security')));
  assert.deepEqual(summarizeSpecChanges(spec, JSON.parse(JSON.stringify(spec))).changes, []);
  const reordered = structuredClone(spec); reordered.components.schemas.Pet.properties = Object.fromEntries(Object.entries(reordered.components.schemas.Pet.properties).reverse());
  assert.deepEqual(summarizeSpecChanges(spec, reordered).changes, []);
});
test('semantic diff resolves inherited parameters, warns on unresolved refs and compares recursive schemas', () => {
  const next = structuredClone(spec); next.paths['/pets/{id}'].parameters[0].required = false;
  assert.ok(summarizeSpecChanges(spec, next).changes.some(c => c.label.includes('改為選填')));
  const external = structuredClone(spec); external.paths['/x'] = { $ref: 'https://private.test/x' };
  assert.ok(summarizeSpecChanges(spec, external).warnings.length);
  const recursive: SpecNode = { paths: {}, components: { schemas: { A: { properties: { next: { $ref: '#/components/schemas/A' } } } } } };
  assert.deepEqual(summarizeSpecChanges(recursive, structuredClone(recursive)).changes, []);
});
const strict: SpecNode = { openapi: '3.0.3', info: { title: 'Strict', version: '1' }, paths: {
  '/orders/{orderId}': { parameters: [{ in: 'path', name: 'orderId', required: true, schema: { type: 'integer', minimum: 1 } }], get: { parameters: [{ in: 'query', name: 'expand', schema: { type: 'array', items: { enum: ['lines', 'customer'] } } }, { in: 'header', name: 'X-Tenant', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'ok', content: { 'application/json': { example: { id: 1 } } } } } } },
  '/orders': { post: { requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } }, responses: { 201: { description: 'created', content: { 'application/json': { example: { id: 2 } } } } } } },
}, components: { schemas: { NewOrder: { type: 'object', required: ['id', 'quantity', 'kind'], additionalProperties: false, properties: { id: { type: 'integer', readOnly: true }, quantity: { type: 'integer', minimum: 1, maximum: 10 }, note: { type: 'string', maxLength: 5, nullable: true }, kind: { oneOf: [{ enum: ['retail'] }, { enum: ['wholesale'] }] } } } } } };
const headers = (value: Record<string, string>) => new Headers(value);
test('mock request validation checks parameters and JSON bodies with bounded structural rules', () => {
  const at = (issues: RequestIssue[]) => issues.map(issue => issue.at);
  assert.deepEqual(validateMockRequest(strict, 'GET', '/orders/3', { query: new URLSearchParams('expand=lines,customer'), headers: headers({ 'x-tenant': 'a' }) }), []);
  assert.deepEqual(at(validateMockRequest(strict, 'GET', '/orders/abc', { headers: headers({}) })), ['path.orderId', 'header.X-Tenant']);
  assert.deepEqual(at(validateMockRequest(strict, 'GET', '/orders/0', { query: new URLSearchParams('expand=bogus'), headers: headers({ 'x-tenant': 'a' }) })), ['path.orderId', 'query.expand[0]']);
  const post = (body: string, type = 'application/json') => validateMockRequest(strict, 'POST', '/orders', { headers: headers(type ? { 'content-type': type } : {}), body });
  assert.deepEqual(post(JSON.stringify({ quantity: 2, kind: 'retail', note: null })), [], 'readOnly required fields are not required in requests');
  assert.deepEqual(at(post('')), ['body']);
  assert.match(post('{')[0]!.message, /JSON/);
  assert.match(post('<x/>', 'application/xml')[0]!.message, /Content-Type/);
  assert.deepEqual(at(post(JSON.stringify({ quantity: 11, kind: 'other', note: 'too long', extra: true }))).sort(), ['body.extra', 'body.kind', 'body.note', 'body.quantity']);
  assert.deepEqual(at(post(JSON.stringify({ quantity: '2', kind: 'retail' }))), ['body.quantity']);
  assert.ok(post(JSON.stringify(Array.from({ length: 50 }, () => ({}))), 'application/json').length <= 20);
  assert.throws(() => validateMockRequest(strict, 'DELETE', '/orders'), (e: any) => e.status === 405);
  const legacy: SpecNode = { swagger: '2.0', paths: { '/x': { post: { parameters: [{ in: 'body', name: 'body', required: true, schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } }, { in: 'query', name: 'n', type: 'integer', required: true }], responses: { 200: { description: 'ok' } } } } } };
  assert.deepEqual(at(validateMockRequest(legacy, 'POST', '/x', { query: new URLSearchParams('n=x'), body: '{}' })), ['query.n', 'body.a']);
});
test('mock controls are bounded and sample requests omit readOnly fields', () => {
  assert.deepEqual(mockControls(new URLSearchParams('')), { status: null, example: null, validate: true, delay: 0, failRate: 0, failStatus: 500 });
  assert.deepEqual(mockControls(new URLSearchParams('__validate=off&__delay=250&__fail=0.5&__failStatus=503&__status=404')), { status: '404', example: null, validate: false, delay: 250, failRate: 0.5, failStatus: 503 });
  for (const query of ['__delay=6000', '__delay=-1', '__fail=2', '__failStatus=200', '__failStatus=500.5', '__validate=no']) assert.throws(() => mockControls(new URLSearchParams(query)), (e: any) => e.status === 400, query);
  const sample = sampleRequest(strict, 'post', '/orders');
  assert.deepEqual(JSON.parse(sample.body), { quantity: 1, note: 'sampl', kind: 'retail' });
  assert.deepEqual(validateMockRequest(strict, 'POST', '/orders', { headers: headers({ 'content-type': 'application/json' }), body: sample.body }), [], 'the prefilled body passes validation');
  assert.equal(sampleRequest(strict, 'get', '/orders/{orderId}').path, '/orders/1');
});
test('mock config ownership, opt-in, immutable versions, CORS, expiry, rotation and deletion', async t => {
  const origin = 'https://swagger.stanmao.com';
  const mf = new Miniflare({ modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], r2Buckets: ['BUCKET'], bindings: { SITE_ORIGIN: origin, AUTH_GOOGLE_ID: 'test.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'test-only', AUTH_SECRET: 'test-only-secret-12345678901234567890123' } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const f of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) await db.batch((await readFile('drizzle/' + f, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const adapter = testAdapter(db), tokens = [];
  for (const name of ['alice', 'bob']) { const u = await adapter.createUser({ name, email: name + '@example.test', emailVerified: new Date() }); const token = crypto.randomUUID(); tokens.push(token); await adapter.createSession({ sessionToken: token, userId: u.id, expires: new Date(Date.now() + 86400000) }); }
  const req = (p: string, token?: string | null, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => mf.dispatchFetch(origin + p, { method, headers: { origin, ...(token ? { cookie: '__Secure-authjs.session-token=' + token } : {}), 'x-file-name': 'mock.json', 'x-source-type': 'paste', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }) as Promise<JsonResponse>;
  const created = await req('/api/documents', tokens[0], 'POST', spec); assert.equal(created.status, 201); const id = (await created.json()).document.id;
  const config = `/api/documents/${id}/mock`, input = { version: 1, expiresInDays: 7, confirmPublic: true };
  assert.equal((await req(config)).status, 401);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await req(config, tokens[1], method, method === 'PUT' ? input : undefined)).status, 404);
  assert.equal((await req(config, tokens[0], 'PUT', { ...input, confirmPublic: false })).status, 400);
  assert.equal((await req(config, tokens[0], 'PUT', input, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await req(config, tokens[0], 'PUT', { ...input, version: 999 })).status, 404);
  const enabled = await req(config, tokens[0], 'PUT', input); assert.equal(enabled.status, 200); let mock = (await enabled.json()).mock;
  let route = `/mock/${mock.id}`;
  const get = await req(route + '/pets/123'); assert.equal(get.status, 200); assert.deepEqual(await get.json(), { id: 42, name: 'Mochi' }); assert.equal(get.headers.get('access-control-allow-origin'), '*'); assert.equal(get.headers.get('access-control-allow-credentials'), null); assert.equal(get.headers.get('cache-control'), 'no-store');
  const preflight = await req(route + '/pets', null, 'OPTIONS', undefined, { origin: 'https://frontend.test', 'access-control-request-method': 'POST' }); assert.equal(preflight.status, 204);
  const post = await req(route + '/pets', null, 'POST', { name: 'not persisted' }, { origin: 'https://frontend.test' }); assert.equal(post.status, 201); assert.equal((await post.json()).name, 'Generated');
  const head = await req(route + '/pets/1', null, 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const delayed = Date.now(); const failed = await req(route + '/pets/1?__fail=1&__failStatus=503&__delay=150'); assert.equal(failed.status, 503); assert.equal(failed.headers.get('x-mock-source'), 'fault'); assert.ok(Date.now() - delayed >= 140, 'delay applies before responding');
  assert.equal((await req(route + '/pets/1?__delay=99999')).status, 400);
  const strictDoc = await req('/api/documents', tokens[0], 'POST', strict); assert.equal(strictDoc.status, 201); const strictId = (await strictDoc.json()).document.id;
  const strictMock = (await (await req(`/api/documents/${strictId}/mock`, tokens[0], 'PUT', input)).json()).mock, strictRoute = '/mock/' + strictMock.id;
  const rejected = await req(strictRoute + '/orders', null, 'POST', { quantity: 0, kind: 'retail' }, { 'content-type': 'application/json' }); assert.equal(rejected.status, 400); assert.equal(rejected.headers.get('x-mock-source'), 'validation');
  assert.deepEqual((await rejected.json()).issues.map((i: RequestIssue) => i.at), ['body.quantity']);
  assert.equal((await req(strictRoute + '/orders', null, 'POST', { quantity: 2, kind: 'retail' }, { 'content-type': 'application/json' })).status, 201);
  assert.equal((await req(strictRoute + '/orders?__validate=off', null, 'POST', 'not json', { 'content-type': 'application/json' })).status, 201);
  assert.equal((await req(strictRoute + '/orders', null, 'POST', 'x'.repeat(256 * 1024 + 1), { 'content-type': 'application/json' })).status, 413);
  assert.equal((await req(strictRoute + '/orders/5', null, 'HEAD')).status, 400, 'HEAD is validated like GET');
  assert.equal((await req('/api/documents/' + strictId, tokens[0], 'DELETE')).status, 200); assert.equal((await req(strictRoute + '/orders/5')).status, 404);
  const next = structuredClone(spec); next.paths['/pets/{id}'].get.responses[200].content['application/json'].examples.normal.value.name = 'Changed';
  const update = await req('/api/documents/' + id + '/content', tokens[0], 'PUT', next, { 'x-expected-version': '1' }); assert.equal(update.status, 201);
  assert.equal((await (await req(route + '/pets/1')).json()).name, 'Mochi');
  mock = (await (await req(config, tokens[0], 'PUT', { ...input, version: 2 })).json()).mock;
  assert.equal((await req(route + '/pets/1')).status, 404); route = '/mock/' + mock.id;
  assert.equal((await (await req(route + '/pets/1')).json()).name, 'Changed');
  await db.prepare('UPDATE mocks SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', mock.id).run(); assert.equal((await req(route + '/pets/1')).status, 404);
  mock = (await (await req(config, tokens[0], 'PUT', input)).json()).mock; route = '/mock/' + mock.id;
  assert.equal((await req(config, tokens[0], 'DELETE')).status, 200); assert.equal((await req(route + '/pets/1')).status, 404);
  mock = (await (await req(config, tokens[0], 'PUT', input)).json()).mock; route = '/mock/' + mock.id;
  assert.equal((await req('/api/documents/' + id, tokens[0], 'DELETE')).status, 200); assert.equal((await req(route + '/pets/1')).status, 404);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM mocks').first()).n, 0);
});
test('mock validation accepts parameterized media keys, Swagger 2 consumes and object parameters; samples drop referenced readOnly fields', () => {
  const charset: SpecNode = { openapi: '3.0.3', paths: { '/x': { post: { requestBody: { required: true, content: { 'application/json; charset=utf-8': { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } } }, responses: { 200: { description: 'ok' } } } } } };
  assert.deepEqual(validateMockRequest(charset, 'POST', '/x', { headers: headers({ 'content-type': 'application/json' }), body: '{"a":"x"}' }), []);
  assert.deepEqual(validateMockRequest(charset, 'POST', '/x', { headers: headers({ 'content-type': 'application/json' }), body: '{}' }).map(i => i.at), ['body.a']);
  const xml: SpecNode = { swagger: '2.0', consumes: ['application/xml'], paths: { '/x': { post: { parameters: [{ in: 'body', name: 'body', required: true, schema: { type: 'object' } }], responses: { 200: { description: 'ok' } } } } } };
  assert.deepEqual(validateMockRequest(xml, 'POST', '/x', { headers: headers({ 'content-type': 'application/xml' }), body: '<a/>' }), []);
  assert.match(validateMockRequest(xml, 'POST', '/x', { headers: headers({ 'content-type': 'text/csv' }), body: 'a' })[0].message, /Content-Type/);
  const deep: SpecNode = { openapi: '3.0.3', paths: { '/x': { get: { parameters: [{ in: 'query', name: 'filter', required: true, style: 'deepObject', schema: { type: 'object', properties: { name: { type: 'string' } } } }], responses: { 200: { description: 'ok' } } } } } };
  assert.deepEqual(validateMockRequest(deep, 'GET', '/x', { query: new URLSearchParams('filter[name]=x') }), []);
  const refs: SpecNode = { openapi: '3.0.3', paths: { '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { $ref: '#/components/schemas/Id' }, name: { type: 'string' } } } } } }, responses: { 200: { description: 'ok' } } } } }, components: { schemas: { Id: { type: 'integer', readOnly: true } } } };
  assert.deepEqual(JSON.parse(sampleRequest(refs, 'post', '/x').body), { name: 'sample' });
});
