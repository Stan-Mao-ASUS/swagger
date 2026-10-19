import { test } from 'node:test';
import { metadataPatch } from '../src/lib/document-metadata.js';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { D1Adapter } from '@auth/d1-adapter';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const origin = 'https://workbench.example.test';
const yaml = 'openapi: 3.0.3\ninfo:\n  title: Private test API\n  version: 1.0.0\npaths: {}\n';
test('durable documents, Auth.js database sessions, ownership and CSRF', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yaml-workbench-test-'));
  const options = { modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], r2Buckets: ['BUCKET'], d1Persist: path.join(dir, 'd1'), r2Persist: path.join(dir, 'r2'), bindings: { AUTH_GOOGLE_ID: 'test-only.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'test-only-not-real', AUTH_SECRET: 'test-only-secret-never-use-in-production-123456789', SITE_ORIGIN: origin } };
  let mf = new Miniflare(options);
  t.after(async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  let db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(x => x.endsWith('.sql')).sort()) {
    await db.batch((await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  let adapter = D1Adapter(db);
  const alice = await adapter.createUser({ name: 'Test Alice', email: 'alice@example.test', emailVerified: new Date(), image: null });
  const bob = await adapter.createUser({ name: 'Test Bob', email: 'bob@example.test', emailVerified: new Date(), image: null });
  await adapter.linkAccount({ userId: alice.id, type: 'oidc', provider: 'google', providerAccountId: 'test-google-alice' });
  assert.equal((await adapter.getUserByAccount({ provider: 'google', providerAccountId: 'test-google-alice' })).id, alice.id);
  const tokenA = crypto.randomUUID(), tokenB = crypto.randomUUID();
  for (const [sessionToken, userId] of [[tokenA, alice.id], [tokenB, bob.id]]) await adapter.createSession({ sessionToken, userId, expires: new Date(Date.now() + 86400000) });
  const request = (route, token, method = 'GET', body, extra = {}) => mf.dispatchFetch(origin + route, { method, headers: { ...(token ? { cookie: '__Secure-authjs.session-token=' + token } : {}), origin, 'content-type': 'text/plain', 'x-file-name': 'private.yaml', 'x-source-type': 'paste', ...extra }, body });
  await t.test('anonymous and spoofed identity are rejected', async () => {
    assert.equal((await request('/api/documents', null)).status, 401);
    assert.equal((await request('/api/documents', null, 'POST', yaml, { 'oai-authenticated-user-id': alice.id, 'x-user-id': alice.id })).status, 401);
    assert.equal((await request('/api/documents', 'invalid')).status, 401);
  });
  await t.test('real adapter session resolves identity', async () => {
    const response = await request('/api/me', tokenA); assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, alice.id);
  });
  const ids = [];
  await t.test('each upload / paste / import creates a separate durable record', async () => {
    for (const type of ['upload','paste','import']) {
      const response = await request('/api/documents', tokenA, 'POST', yaml, { 'x-source-type': type });
      assert.equal(response.status, 201); const { document } = await response.json(); ids.push(document.id);
      assert.equal(document.title, 'Private test API'); assert.equal(document.fileName, 'private.yaml'); assert.equal(document.sourceType, type);
      assert.ok(document.createdAt); assert.equal(document.createdAt, document.updatedAt);
    }
    assert.equal(new Set(ids).size, 3);
    assert.equal((await (await request('/api/documents', tokenA)).json()).documents.length, 3);
  });
  await t.test('another account cannot list, read or delete Alice documents', async () => {
    assert.deepEqual((await (await request('/api/documents?userId=' + alice.id, tokenB)).json()).documents, []);
    assert.equal((await request('/api/documents/' + ids[0], tokenB)).status, 404);
    assert.equal((await request('/api/documents/' + ids[0], tokenB, 'DELETE')).status, 404);
    assert.equal((await request('/api/documents/' + ids[0], tokenA)).status, 200);
  });
  await t.test('cross-site writes and invalid YAML are rejected', async () => {
    assert.equal((await request('/api/documents', tokenA, 'POST', yaml, { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/documents/' + ids[0], tokenA, 'DELETE', undefined, { origin: '' })).status, 403);
    assert.equal((await request('/api/documents', tokenA, 'POST', 'not: openapi')).status, 400);
    assert.equal((await request('/api/documents', tokenA, 'POST', yaml.replace('paths: {}', 'paths:\n  /pets/{id}:\n    get:\n      responses:\n        200:\n          description: ok'))).status, 400);
    assert.equal((await request('/api/documents', tokenA, 'POST', yaml, { 'x-source-type': 'invalid' })).status, 400);
    assert.equal((await request('/api/documents', tokenA, 'POST', 'x'.repeat(5 * 1024 * 1024 + 1))).status, 413);
  });
  let categoryId;
  await t.test('category ownership, metadata validation and immutable source', async () => {
    assert.equal((await request('/api/categories', null)).status, 401);
    assert.equal((await request('/api/preferences', null)).status, 401);
    const created = await request('/api/categories', tokenA, 'POST', JSON.stringify({ name: '會員系統' }));
    assert.equal(created.status, 201); categoryId = (await created.json()).category.id;
    assert.equal((await request('/api/categories', tokenA, 'POST', JSON.stringify({ name: '會員系統' }))).status, 409);
    assert.deepEqual((await (await request('/api/categories?userId=' + alice.id, tokenB)).json()).categories, []);
    for (const method of ['PATCH', 'DELETE']) assert.equal((await request('/api/categories/' + categoryId, tokenB, method, method === 'PATCH' ? JSON.stringify({ name: 'stolen' }) : undefined)).status, 404);
    const patch = { displayName: '會員 API v2', categoryId };
    const before = (await (await request('/api/documents/' + ids[1], tokenA)).json()).document;
    assert.equal((await request('/api/documents/' + ids[1], tokenB, 'PATCH', JSON.stringify(patch))).status, 404);
    const response = await request('/api/documents/' + ids[1], tokenA, 'PATCH', JSON.stringify(patch));
    assert.equal(response.status, 200); const after = (await response.json()).document;
    assert.equal(after.displayName, patch.displayName); assert.equal(after.categoryId, categoryId);
    assert.equal(after.title, before.title); assert.equal(after.fileName, before.fileName); assert.equal(after.createdAt, before.createdAt); assert.ok(after.updatedAt >= before.updatedAt);
    assert.equal((await (await request('/api/documents/' + ids[1], tokenA)).json()).document.source, yaml);
    const bobCategory = (await (await request('/api/categories', tokenB, 'POST', JSON.stringify({ name: 'Bob private' }))).json()).category.id;
    assert.equal((await request('/api/documents/' + ids[1], tokenA, 'PATCH', JSON.stringify({ categoryId: bobCategory }))).status, 404);
    for (const body of [{ displayName: ' ' }, { userId: bob.id }, { createdAt: '2020-01-01' }, { displayName: 'x'.repeat(201) }]) assert.equal((await request('/api/documents/' + ids[1], tokenA, 'PATCH', JSON.stringify(body))).status, 400);
    assert.equal((await request('/api/documents/' + ids[1], tokenA, 'PATCH', JSON.stringify(patch), { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/categories/' + categoryId, tokenA, 'PATCH', JSON.stringify({ name: '核心 API' }))).status, 200);
  });
  await t.test('server search, category, date and sorting remain owner scoped', async () => {
    const list = async (query, token = tokenA) => (await (await request('/api/documents?' + query, token)).json()).documents;
    assert.deepEqual((await list('q=' + encodeURIComponent('會員'))).map(d => d.id), [ids[1]]);
    assert.equal((await list('q=private.yaml')).length, 3);
    assert.equal((await list('category=' + categoryId)).length, 1);
    assert.equal((await list('category=uncategorized')).length, 2);
    assert.equal((await list('category=' + categoryId + '&userId=' + alice.id, tokenB)).length, 0);
    assert.equal((await list('from=2000-01-01T00:00:00.000Z&to=2001-01-01T00:00:00.000Z')).length, 0);
    assert.equal((await list('from=2000-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z')).length, 3);
    assert.equal((await list('sort=updated'))[0].id, ids[1]);
    assert.equal((await list('sort=name'))[0].displayName, 'Private test API');
    assert.equal((await request('/api/documents?sort=invalid', tokenA)).status, 400);
    assert.equal((await request('/api/documents?from=invalid', tokenA)).status, 400);
  });
  await t.test('long legacy title can be classified without renaming, and malformed input is rejected', async () => {
    const source = yaml.replace('Private test API', '長'.repeat(500));
    const created = await request('/api/documents', tokenA, 'POST', source);
    assert.equal(created.status, 201); const original = (await created.json()).document;
    const response = await request('/api/documents/' + original.id, tokenA, 'PATCH', JSON.stringify(metadataPatch(original, original.displayName, categoryId)));
    assert.equal(response.status, 200);
    const updated = (await response.json()).document;
    assert.equal(updated.categoryId, categoryId); assert.equal(updated.displayName, original.title);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal((await request('/api/documents/' + original.id, tokenA, 'DELETE')).status, 200);
    const before = (await (await request('/api/documents', tokenA)).json()).documents.length;
    const cycle = yaml + 'x-cycle: &loop { self: *loop }\n';
    assert.equal((await request('/api/documents', tokenA, 'POST', cycle)).status, 400);
    assert.equal((await request('/api/documents', tokenA, 'POST', new Uint8Array([0xff]))).status, 400);
    assert.equal((await (await request('/api/documents', tokenA)).json()).documents.length, before);
    assert.equal((await request('/api/documents?from=2026-02-30T00:00:00.000Z', tokenA)).status, 400);
    assert.equal((await request('/api/documents?from=2026-10-05T00:00:00.000Z&to=2026-10-04T00:00:00.000Z', tokenA)).status, 400);
  });
  await t.test('theme is validated and isolated per account', async () => {
    assert.equal((await (await request('/api/preferences', tokenA)).json()).theme, 'system');
    assert.equal((await request('/api/preferences', tokenA, 'PATCH', JSON.stringify({ theme: 'dark' }))).status, 200);
    assert.equal((await (await request('/api/preferences', tokenB)).json()).theme, 'system');
    assert.equal((await request('/api/preferences', tokenA, 'PATCH', JSON.stringify({ theme: 'purple' }))).status, 400);
    assert.equal((await request('/api/preferences', tokenB, 'PATCH', JSON.stringify({ theme: 'light', userId: alice.id }))).status, 400);
    assert.equal((await request('/api/preferences', tokenA, 'PATCH', JSON.stringify({ theme: 'light' }), { origin: '' })).status, 403);
  });
  await t.test('private versions, legacy snapshots, restore and optimistic concurrency', async () => {
    const route = '/api/documents/' + ids[0];
    // Simulate a pre-feature document: original object exists, no history row yet.
    await db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(ids[0]).run();
    const updated = yaml.replace('Private test API', 'Updated API');
    assert.equal((await request(route + '/content', tokenB, 'PUT', updated, { 'x-expected-version': '1' })).status, 404);
    for (const suffix of ['/versions', '/versions/1']) assert.equal((await request(route + suffix, tokenB)).status, 404);
    assert.equal((await request(route + '/restore', tokenB, 'POST', JSON.stringify({ version: 1, expectedVersion: 1 }))).status, 404);
    assert.equal((await request(route + '/content', tokenA, 'PUT', updated)).status, 400);
    const write = await request(route + '/content', tokenA, 'PUT', updated, { 'x-expected-version': '1', 'x-version-note': encodeURIComponent('更新標題') });
    assert.equal(write.status, 201); assert.equal((await write.json()).document.currentVersion, 2);
    assert.equal((await (await request(route + '/versions/1', tokenA)).json()).source, yaml);
    assert.equal((await (await request(route + '/versions/2', tokenA)).json()).source, updated);
    const history = await (await request(route + '/versions', tokenA)).json();
    assert.deepEqual(history.versions.map(v => v.version), [2, 1]); assert.equal(history.versions[0].note, '更新標題');
    assert.equal((await request(route + '/content', tokenA, 'PUT', yaml, { 'x-expected-version': '1' })).status, 409);
    const writes = await Promise.all(['Winner A', 'Winner B'].map(title => request(route + '/content', tokenA, 'PUT', yaml.replace('Private test API', title), { 'x-expected-version': '2' })));
    assert.deepEqual(writes.map(r => r.status).sort(), [201, 409]);
    const winner = (await (await request(route, tokenA)).json()).document;
    assert.equal(winner.currentVersion, 3); assert.match(winner.source, /Winner [AB]/);
    assert.equal((await (await request(route + '/versions/3', tokenA)).json()).source, winner.source);
    const bucket = await mf.getR2Bucket('BUCKET');
    const versionObjects = (await bucket.list({ prefix: encodeURIComponent(alice.id) + '/' + ids[0] + '/' })).objects;
    assert.equal(versionObjects.length, 2, 'losing concurrent write leaves no orphan and cannot delete winner');
    const restore = await request(route + '/restore', tokenA, 'POST', JSON.stringify({ version: 1, expectedVersion: 3 }));
    assert.equal(restore.status, 201); assert.equal((await restore.json()).document.currentVersion, 4);
    assert.equal((await (await request(route, tokenA)).json()).document.source, yaml);
    assert.equal((await (await request(route + '/versions/2', tokenA)).json()).source, updated);
    assert.equal((await (await request(route + '/versions/4', tokenA)).json()).note, '還原自 v1');
    assert.equal((await request(route + '/content', tokenA, 'PUT', 'bad yaml', { 'x-expected-version': '4' })).status, 400);
    assert.equal((await request(route + '/versions/999', tokenA)).status, 404);
    assert.equal((await request(route + '/restore', tokenA, 'POST', JSON.stringify({ version: 1, expectedVersion: 3 }))).status, 409);
    assert.equal((await request(route + '/restore', tokenA, 'POST', JSON.stringify({ version: 1, expectedVersion: 4 }), { origin: 'https://attacker.example' })).status, 403);
  });
  let sharedId;
  await t.test('sharing requires explicit owner publication; only a fixed version becomes public', async () => {
    const route = '/api/documents/' + ids[2] + '/publication';
    assert.deepEqual((await (await request('/api/shared', null)).json()).publications, []);
    assert.equal((await request(route, null)).status, 401);
    assert.equal((await request(route, tokenB)).status, 404);
    const payload = { version: 1, title: '公開測試 API', summary: '只分享這個版本', confirmPublic: true };
    assert.equal((await request(route, tokenB, 'PUT', JSON.stringify(payload))).status, 404);
    assert.equal((await request(route, tokenA, 'PUT', JSON.stringify({ ...payload, confirmPublic: false }))).status, 400);
    assert.equal((await request(route, tokenA, 'PUT', JSON.stringify({ ...payload, userId: bob.id }))).status, 400);
    assert.equal((await request(route, tokenA, 'PUT', JSON.stringify({ ...payload, version: 999 }))).status, 404);
    assert.equal((await request(route, tokenA, 'PUT', JSON.stringify(payload), { origin: 'https://attacker.example' })).status, 403);
    // Existing pre-version-feature documents can be published without changing their original bytes.
    await db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(ids[2]).run();
    const published = await request(route, tokenA, 'PUT', JSON.stringify(payload));
    assert.equal(published.status, 200); sharedId = (await published.json()).publication.id;
    const publicData = (await (await request('/api/shared/' + sharedId, null)).json()).publication;
    assert.equal(publicData.source, yaml); assert.equal(publicData.title, payload.title); assert.equal(publicData.version, 1);
    assert.deepEqual(Object.keys(publicData).sort(), ['id','version','title','summary','createdAt','updatedAt','fileName','source','visibility','expiresAt'].sort());
    for (const token of [null, tokenB]) {
      assert.equal((await (await request('/api/shared?q=' + encodeURIComponent('公開測試'), token)).json()).publications.length, 1);
      assert.equal((await request('/api/shared/' + sharedId, token, 'DELETE')).status, 405);
      assert.equal((await request('/api/documents/' + ids[2] + '/versions/1', token)).status, token ? 404 : 401);
    }
    const newSource = yaml.replace('Private test API', 'New PRIVATE draft');
    assert.equal((await request('/api/documents/' + ids[2] + '/content', tokenA, 'PUT', newSource, { 'x-expected-version': '1', 'x-version-note': 'private-note' })).status, 201);
    assert.equal((await (await request('/api/shared/' + sharedId, null)).json()).publication.source, yaml);
    await request('/api/documents/' + ids[2], tokenA, 'PATCH', JSON.stringify({ displayName: 'Private name' }));
    assert.equal((await (await request('/api/shared/' + sharedId, null)).json()).publication.title, payload.title);
    const update = await request(route, tokenA, 'PUT', JSON.stringify({ ...payload, version: 2 }));
    assert.equal((await update.json()).publication.id, sharedId);
    assert.equal((await (await request('/api/shared/' + sharedId, null)).json()).publication.source, newSource);
    assert.equal((await request('/api/shared/' + ids[2], null)).status, 404);
    assert.equal((await request('/api/shared/' + sharedId + '/versions/1', null)).status, 404);
  });
  await t.test('revocation invalidates old links; deleting or tombstoning hides a publication', async () => {
    const route = '/api/documents/' + ids[2] + '/publication';
    assert.equal((await request(route, tokenB, 'DELETE')).status, 404);
    assert.equal((await request(route, tokenA, 'DELETE')).status, 200);
    assert.equal((await request('/api/shared/' + sharedId, null)).status, 404);
    assert.deepEqual((await (await request('/api/shared', null)).json()).publications, []);
    const again = await request(route, tokenA, 'PUT', JSON.stringify({ version: 1, title: '重新發布', confirmPublic: true }));
    const nextId = (await again.json()).publication.id; assert.notEqual(nextId, sharedId);
    assert.equal((await request('/api/shared/' + sharedId, null)).status, 404);
    await db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').bind(new Date().toISOString(), ids[2]).run();
    assert.equal((await request('/api/shared/' + nextId, null)).status, 404);
    assert.deepEqual((await (await request('/api/shared', null)).json()).publications, []);
    await db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ?').bind(ids[2]).run();
    await request(route, tokenA, 'DELETE');
    const deletionTarget = await request('/api/documents/' + ids[0] + '/publication', tokenA, 'PUT', JSON.stringify({ version: 1, title: '待刪除測試', confirmPublic: true }));
    sharedId = (await deletionTarget.json()).publication.id;
  });
  await t.test('unlisted links, expiry, audience changes and rotation are enforced on the server', async () => {
    const base = '/api/documents/' + ids[2] + '/publication';
    const publish = async extra => {
      const response = await request(base, tokenA, 'PUT', JSON.stringify({ version: 1, title: 'Scoped share', summary: 'secret gallery word', confirmPublic: true, ...extra }));
      assert.equal(response.status, 200); return (await response.json()).publication;
    };
    const first = await publish({ visibility: 'public' });
    const hidden = await publish({ visibility: 'unlisted', expiresAt: new Date(Date.now() + 86400000).toISOString() });
    assert.notEqual(first.id, hidden.id);
    assert.equal((await request('/api/shared/' + first.id, null)).status, 404);
    assert.equal((await request('/api/shared/' + hidden.id, null)).status, 200);
    for (const query of ['', '?q=Scoped', '?q=secret']) assert.ok(!(await (await request('/api/shared' + query, null)).json()).publications.some(p => p.id === hidden.id));
    assert.equal((await request(base, tokenB, 'PUT', JSON.stringify({ version: 1, title: 'steal', confirmPublic: true, visibility: 'public' }))).status, 404);
    const rotated = await publish({ visibility: 'unlisted', rotateLink: true });
    assert.notEqual(rotated.id, hidden.id);
    assert.equal((await request('/api/shared/' + hidden.id, null)).status, 404);
    await db.prepare('UPDATE publications SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', rotated.id).run();
    assert.equal((await request('/api/shared/' + rotated.id, null)).status, 404);
    const renewed = await publish({ visibility: 'unlisted' });
    assert.notEqual(renewed.id, rotated.id);
    for (const expiresAt of ['bad', '2000-01-01T00:00:00.000Z', '2027-02-30T00:00:00.000Z']) assert.equal((await request(base, tokenA, 'PUT', JSON.stringify({ version: 1, title: 'bad', confirmPublic: true, expiresAt }))).status, 400);
    assert.equal((await request(base, tokenA, 'DELETE')).status, 200);
    assert.equal((await request('/api/shared/' + renewed.id, null)).status, 404);
  });
  await t.test('cloud drafts accept unfinished YAML, enforce ownership and reject stale writes', async () => {
    const route = '/api/drafts/' + ids[0];
    const put = (text, revision, token = tokenA) => request(route, token, 'PUT', text, { 'x-draft-revision': String(revision), 'x-base-version': '1' });
    assert.equal((await request(route, null)).status, 401);
    assert.equal((await put('stolen', 0, tokenB)).status, 404);
    assert.equal((await request(route, tokenB, 'DELETE', undefined, { 'x-draft-revision': '0' })).status, 404);
    const before = (await (await request('/api/documents/' + ids[0], tokenA)).json()).document;
    assert.equal((await put('unfinished: [', 0)).status, 200);
    assert.equal((await put('old tab', 0)).status, 409);
    let data = await (await request(route, tokenA)).json();
    assert.equal(data.draft.source, 'unfinished: ['); assert.equal(data.revision, 1);
    assert.equal((await (await request('/api/documents/' + ids[0], tokenA)).json()).document.currentVersion, before.currentVersion);
    const race = await Promise.all([put('race A', 1), put('race B', 1)]);
    assert.deepEqual(race.map(r => r.status).sort(), [200,409]);
    assert.equal((await request(route, tokenA, 'DELETE', undefined, { 'x-draft-revision': '1' })).status, 409);
    assert.equal((await request(route, tokenA, 'DELETE', undefined, { 'x-draft-revision': '2' })).status, 200);
    assert.equal((await put('stale resurrection', 0)).status, 409);
    assert.equal((await put('restart draft', 3)).status, 200);
    assert.equal((await request('/api/drafts/new', tokenA, 'PUT', 'new draft', { 'x-draft-revision': '0' })).status, 200);
    assert.equal((await (await request('/api/drafts/new', tokenB)).json()).draft, null);
    assert.equal((await request('/api/drafts/new', tokenA, 'PUT', 'x'.repeat(5 * 1024 * 1024 + 1), { 'x-draft-revision': '1' })).status, 413);
  });
  await t.test('refresh and process restart retain metadata and original YAML', async () => {
    assert.equal((await (await request('/api/documents/' + ids[1], tokenA)).json()).document.source, yaml);
    await mf.dispose(); mf = new Miniflare(options); db = await mf.getD1Database('DB'); adapter = D1Adapter(db);
    const response = await request('/api/documents', tokenA); assert.equal(response.status, 200);
    assert.equal((await response.json()).documents.length, 3);
    assert.equal((await (await request('/api/documents/' + ids[0] + '/versions', tokenA)).json()).versions.length, 4);
    assert.equal((await (await request('/api/shared/' + sharedId, null)).json()).publication.source, yaml);
    assert.equal((await (await request('/api/documents/' + ids[1], tokenA)).json()).document.source, yaml);
  });
  await t.test('cloud draft persists across process restart', async () => {
    assert.equal((await (await request('/api/drafts/' + ids[0], tokenA)).json()).draft.source, 'restart draft');
  });
  await t.test('a new session for the same account retains history', async () => {
    await adapter.deleteSession(tokenA);
    assert.equal((await request('/api/documents', tokenA)).status, 401);
    await adapter.createSession({ sessionToken: tokenA, userId: alice.id, expires: new Date(Date.now() + 86400000) });
    assert.equal((await (await request('/api/documents', tokenA)).json()).documents.length, 3);
  });
  await t.test('metadata and theme survive restart and new session; category removal preserves documents', async () => {
    const doc = (await (await request('/api/documents/' + ids[1], tokenA)).json()).document;
    assert.equal(doc.displayName, '會員 API v2'); assert.equal(doc.categoryId, categoryId);
    assert.equal((await (await request('/api/preferences', tokenA)).json()).theme, 'dark');
    assert.equal((await (await request('/api/categories', tokenA)).json()).categories[0].name, '核心 API');
    assert.equal((await request('/api/categories/' + categoryId, tokenA, 'DELETE')).status, 200);
    const retained = (await (await request('/api/documents/' + ids[1], tokenA)).json()).document;
    assert.equal(retained.categoryId, null); assert.equal(retained.source, yaml); assert.equal(retained.displayName, '會員 API v2');
    assert.equal((await (await request('/api/documents', tokenA)).json()).documents.length, 3);
  });
  await t.test('delete removes both metadata and object storage', async () => {
    const row = await db.prepare('SELECT object_key FROM documents WHERE id = ?').bind(ids[0]).first();
    const keys = (await db.prepare('SELECT object_key FROM document_versions WHERE document_id = ? UNION SELECT object_key FROM drafts WHERE document_id = ? AND object_key IS NOT NULL').bind(ids[0], ids[0]).all()).results;
    assert.equal((await request('/api/documents/' + ids[0], tokenA, 'DELETE')).status, 200);
    assert.equal((await request('/api/documents/' + ids[0], tokenA)).status, 404);
    assert.equal(await db.prepare('SELECT id FROM documents WHERE id = ?').bind(ids[0]).first(), null);
    const bucket = await mf.getR2Bucket('BUCKET'); assert.equal(await bucket.get(row.object_key), null);
    for (const version of keys) assert.equal(await bucket.get(version.object_key), null);
    assert.equal((await db.prepare('SELECT * FROM document_versions WHERE document_id = ?').bind(ids[0]).all()).results.length, 0);
    assert.equal((await request('/api/documents/' + ids[0] + '/versions/1', tokenA)).status, 404);
    assert.equal((await request('/api/drafts/' + ids[0], tokenA)).status, 404);
    assert.equal((await db.prepare('SELECT * FROM drafts WHERE document_id = ?').bind(ids[0]).all()).results.length, 0);
    assert.equal((await request('/api/shared/' + sharedId, null)).status, 404);
    assert.equal(await db.prepare('SELECT id FROM publications WHERE document_id = ?').bind(ids[0]).first(), null);
  });
  await t.test('Auth.js sign-out checks CSRF and revokes the database session', async () => {
    const csrfResponse = await request('/api/auth/csrf', tokenB); const { csrfToken } = await csrfResponse.json();
    assert.ok(csrfToken);
    const cookies = csrfResponse.headers.getSetCookie().map(c => c.split(';')[0]);
    const response = await request('/api/auth/signout', tokenB, 'POST', new URLSearchParams({ csrfToken }), { cookie: ['__Secure-authjs.session-token=' + tokenB, ...cookies].join('; '), 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' });
    assert.equal(response.status, 200);
    assert.equal((await request('/api/documents', tokenB)).status, 401);
  });
  await t.test('unconfigured Google fails closed', async () => {
    const disabled = new Miniflare({ ...options, d1Persist: false, r2Persist: false, bindings: {} });
    try {
      assert.equal((await disabled.dispatchFetch(origin + '/api/auth/signin')).status, 503);
      const data = await (await disabled.dispatchFetch(origin + '/api/me')).json();
      assert.equal(data.googleConfigured, false); assert.equal(data.user, null);
    } finally { await disabled.dispose(); }
  });
});
