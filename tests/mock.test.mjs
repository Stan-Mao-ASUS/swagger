import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockResponse, sampleSchema } from '../shared/mock.js';
import { summarizeSpecChanges } from '../src/lib/spec-diff.js';
import { Miniflare } from 'miniflare';
import { D1Adapter } from '@auth/d1-adapter';
import { readdir, readFile } from 'node:fs/promises';
const spec = { openapi: '3.0.3', info: { title: 'Mock QA', version: '1' }, paths: {
  '/pets/{id}': { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' }, examples: { normal: { value: { id: 42, name: 'Mochi' } }, empty: { value: null } } } } }, 404: { description: 'missing', content: { 'application/json': { example: { error: 'missing' } } } } } } },
  '/pets/count': { get: { responses: { 200: { description: 'count', content: { 'application/json': { schema: { type: 'integer', minimum: 2 } } } } } } },
  '/pets': { post: { responses: { 201: { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } }, delete: { responses: { 204: { description: 'empty' } } } },
}, components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Generated' }, privateValue: { type: 'string', writeOnly: true } } } } } };
test('mock prioritizes examples, selects statuses and named examples, matches static paths first', () => {
  assert.deepEqual(JSON.parse(mockResponse(spec, 'GET', '/pets/7').body), { id: 42, name: 'Mochi' });
  assert.equal(mockResponse(spec, 'GET', '/pets/7', '404').status, 404);
  assert.equal(mockResponse(spec, 'GET', '/pets/7', '200', 'empty').body, 'null');
  assert.equal(mockResponse(spec, 'GET', '/pets/count').body, '2');
  assert.deepEqual(JSON.parse(mockResponse(spec, 'POST', '/pets').body), { id: 0, name: 'Generated' });
  assert.equal(mockResponse(spec, 'DELETE', '/pets').body, null);
  assert.throws(() => mockResponse(spec, 'PATCH', '/pets/count'), e => e.status === 405);
  assert.throws(() => mockResponse(spec, 'GET', '/nope'), e => e.status === 404);
  assert.throws(() => mockResponse(spec, 'GET', '/pets/1', '500'), e => e.status === 400);
  assert.throws(() => mockResponse(spec, 'GET', '/pets/1', '', 'missing'), e => e.status === 400);
});
test('mock handles Swagger 2 examples and bounded schema samples without fetching refs', () => {
  const legacy = { swagger: '2.0', paths: { '/x': { get: { responses: { 200: { examples: { 'application/json': { legacy: true } } } } } } } };
  assert.equal(mockResponse(legacy, 'GET', '/x').body, '{"legacy":true}');
  assert.deepEqual(sampleSchema({}, { allOf: [{ type: 'object', properties: { x: { enum: ['a'] } } }, { type: 'object', properties: { y: { type: 'boolean' } } }] }), Object.assign(Object.create(null), { x: 'a', y: true }));
  assert.equal(sampleSchema({}, { type: 'array', minItems: 100, items: { type: 'string' } }).length, 5);
  assert.throws(() => sampleSchema({}, { $ref: 'https://private.test/schema' }), /參照/);
  const cyclic = { components: { schemas: { Loop: { properties: { next: { $ref: '#/components/schemas/Loop' } } } } } };
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
  const recursive = { paths: {}, components: { schemas: { A: { properties: { next: { $ref: '#/components/schemas/A' } } } } } };
  assert.deepEqual(summarizeSpecChanges(recursive, structuredClone(recursive)).changes, []);
});
test('mock config ownership, opt-in, immutable versions, CORS, expiry, rotation and deletion', async t => {
  const origin = 'https://swagger.stanmao.com';
  const mf = new Miniflare({ modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], r2Buckets: ['BUCKET'], bindings: { SITE_ORIGIN: origin, AUTH_GOOGLE_ID: 'test.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'test-only', AUTH_SECRET: 'test-only-secret-12345678901234567890123' } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const f of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) await db.batch((await readFile('drizzle/' + f, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const adapter = D1Adapter(db), tokens = [];
  for (const name of ['alice', 'bob']) { const u = await adapter.createUser({ name, email: name + '@example.test', emailVerified: new Date() }); const token = crypto.randomUUID(); tokens.push(token); await adapter.createSession({ sessionToken: token, userId: u.id, expires: new Date(Date.now() + 86400000) }); }
  const req = (p, token, method = 'GET', body, headers = {}) => mf.dispatchFetch(origin + p, { method, headers: { origin, ...(token ? { cookie: '__Secure-authjs.session-token=' + token } : {}), 'x-file-name': 'mock.json', 'x-source-type': 'paste', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
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
