import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDefinition } from '../src/lib/openapi.ts';
import { documents, boundedText, readJson } from '../worker/documents.ts';
import { metadataPatch } from '../src/lib/document-metadata.ts';
import { queryString, type LibraryFilters } from '../src/lib/library-query.ts';
const base = 'openapi: 3.0.3\ninfo: { title: Review API, version: "1" }\npaths: {}\n';

test('frontend and upload API reject cyclic and excessive aliases before storing anything', async () => {
  let writes = 0;
  const env = { DB: { prepare: () => { writes++; throw new Error('Unexpected SQL write'); } }, BUCKET: { put: async () => { writes++; } } } as unknown as Env;
  let expanded = base + 'x-level0: &level0 [a,a,a,a,a,a,a,a,a,a]\n';
  for (let i = 1; i < 7; i++) expanded += `x-level${i}: &level${i} [${Array(10).fill('*level' + (i - 1)).join(',')}]\n`;
  for (const source of [base + 'x-cycle: &loop { self: *loop }\n', expanded]) {
    assert.throws(() => parseDefinition(source), /循環|展開/);
    await assert.rejects(() => documents(new Request('https://example.test/api/documents', { method: 'POST', headers: { 'x-source-type': 'paste' }, body: source }), env, { id: 'test' }), (error: any) => error.status === 400 && /循環|展開/.test(error.message));
  }
  assert.equal(writes, 0);
});
test('ordinary aliases and recursive OpenAPI refs remain supported', () => {
  const spec = parseDefinition(base + 'x-original: &value { description: reusable }\nx-alias: *value\ncomponents:\n  schemas:\n    Node:\n      properties:\n        next: { $ref: "#/components/schemas/Node" }\n');
  assert.deepEqual(spec['x-alias'], spec['x-original']);
  assert.notEqual(spec['x-alias'], spec['x-original']);
  assert.equal(spec.components.schemas.Node.properties.next.$ref, '#/components/schemas/Node');
});
test('invalid UTF-8 is a client error and oversized settings are stopped while reading', async () => {
  await assert.rejects(() => boundedText(new Request('https://example.test', { method: 'POST', body: new Uint8Array([0xff]) })), (error: any) => error.status === 400);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readJson(new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)), (error: any) => error.status === 413);
  assert.equal(cancelled, true);
});
test('editing classification preserves a long legacy title without resubmitting it as a custom name', () => {
  const title = '長'.repeat(500); const item = { title, displayName: title };
  assert.deepEqual(metadataPatch(item, title, 'category'), { categoryId: 'category' });
  assert.deepEqual(metadataPatch(item, '新名稱', ''), { displayName: '新名稱', categoryId: null });
  assert.throws(() => metadataPatch(item, ' ', ''), /名稱/);
  assert.throws(() => metadataPatch(item, 'a'.repeat(201), ''), /名稱/);
});
test('date filters reject impossible or expanded years and include the entire selected end day', () => {
  const filters: LibraryFilters = { q: '', category: '', sort: 'created', from: '', to: '' };
  for (const from of ['2026-02-30', '10000-01-01', '2026-13-01']) assert.throws(() => queryString({ ...filters, from }, 0), /日期/);
  assert.throws(() => queryString({ ...filters, from: '2026-10-05', to: '2026-10-04' }, 0), /開始日期/);
  const params = new URLSearchParams(queryString({ ...filters, from: '2026-10-04', to: '2026-10-04' }, 0));
  assert.equal(params.get('from'), new Date('2026-10-04T00:00:00').toISOString());
  assert.equal(params.get('to'), new Date('2026-10-05T00:00:00').toISOString());
});

test('late private responses are discarded after parallel session expiry or logout', async () => {
  const { createSessionClient } = await import('../src/lib/session-client.ts');
  const { ApiError } = await import('../src/lib/api.ts');
  let resolveHistory: (value: unknown) => void = () => {}; let invalidations = 0;
  const client = createSessionClient(<T,>(path: string) => path === '/history'
    ? new Promise<T>(resolve => { resolveHistory = resolve as (value: unknown) => void; })
    : Promise.reject(new ApiError('Expired', 401)), () => invalidations++);
  const history = client.request('/history');
  await assert.rejects(() => client.request('/preferences'), (error: any) => error.status === 401);
  const expired = assert.rejects(history, (error: any) => error.status === 401);
  resolveHistory({ documents: ['private document'] }); await expired;
  assert.equal(invalidations, 1);
  const another = client.request('/history');
  client.invalidate();
  const signedOut = assert.rejects(another, (error: any) => error.status === 401);
  resolveHistory({ documents: ['private document'] }); await signedOut;
  assert.equal(invalidations, 2);
});
