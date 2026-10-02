import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { D1Adapter } from '@auth/d1-adapter';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const origin = 'https://swagger-yaml-workbench-stan.tonytonitone6.chatgpt.site';
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
    assert.equal((await request('/api/documents', tokenA, 'POST', yaml, { 'x-source-type': 'invalid' })).status, 400);
    assert.equal((await request('/api/documents', tokenA, 'POST', 'x'.repeat(5 * 1024 * 1024 + 1))).status, 413);
  });
  await t.test('refresh and process restart retain metadata and original YAML', async () => {
    assert.equal((await (await request('/api/documents/' + ids[1], tokenA)).json()).document.source, yaml);
    await mf.dispose(); mf = new Miniflare(options); db = await mf.getD1Database('DB'); adapter = D1Adapter(db);
    const response = await request('/api/documents', tokenA); assert.equal(response.status, 200);
    assert.equal((await response.json()).documents.length, 3);
    assert.equal((await (await request('/api/documents/' + ids[1], tokenA)).json()).document.source, yaml);
  });
  await t.test('a new session for the same account retains history', async () => {
    await adapter.deleteSession(tokenA);
    assert.equal((await request('/api/documents', tokenA)).status, 401);
    await adapter.createSession({ sessionToken: tokenA, userId: alice.id, expires: new Date(Date.now() + 86400000) });
    assert.equal((await (await request('/api/documents', tokenA)).json()).documents.length, 3);
  });
  await t.test('delete removes both metadata and object storage', async () => {
    const row = await db.prepare('SELECT object_key FROM documents WHERE id = ?').bind(ids[0]).first();
    assert.equal((await request('/api/documents/' + ids[0], tokenA, 'DELETE')).status, 200);
    assert.equal((await request('/api/documents/' + ids[0], tokenA)).status, 404);
    assert.equal(await db.prepare('SELECT id FROM documents WHERE id = ?').bind(ids[0]).first(), null);
    const bucket = await mf.getR2Bucket('BUCKET'); assert.equal(await bucket.get(row.object_key), null);
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
