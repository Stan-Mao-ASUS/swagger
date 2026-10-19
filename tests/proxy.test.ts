import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, Response } from 'miniflare';
import { readdir, readFile } from 'node:fs/promises';
import { proxyTarget } from '../worker/proxy.ts';
import { testAdapter, type JsonResponse } from './helpers.ts';

const origin = 'https://workbench.example.test';

test('proxy targets exclude local, private, reserved and own-site addresses', () => {
  for (const url of ['https://api.example.test/v1', 'http://93.184.216.34:8080/x', 'https://[2606:4700::1]/']) assert.doesNotThrow(() => proxyTarget(url, origin), url);
  for (const url of ['http://localhost:8787/', 'http://localhost./', 'https://printer.local./', 'https://workbench.example.test./', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://10.1.2.3/', 'http://172.20.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://intranet/', 'https://printer.local/', 'https://workbench.example.test/api/documents'])
    assert.throws(() => proxyTarget(url, origin), (error: any) => error.status === 403, url);
  for (const url of ['ftp://example.test/', 'file:///etc/passwd', 'https://user:pass@example.test/', 'not a url']) assert.throws(() => proxyTarget(url, origin), (error: any) => error.status === 400, url);
});

test('proxy forwards Try it out requests for signed-in users without leaking the session', async t => {
  const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const mf = new Miniflare({ modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], r2Buckets: ['BUCKET'], ratelimits: { PROXY_LIMITER: { namespace_id: '1', simple: { limit: 11, period: 60 } } },
    bindings: { SITE_ORIGIN: origin, AUTH_GOOGLE_ID: 'test.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'test-only', AUTH_SECRET: 'test-only-secret-12345678901234567890123' },
    outboundService: async (request: { url: string; method: string; headers: Headers; text(): Promise<string> }) => {
      const url = new URL(request.url);
      seen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() });
      if (url.pathname === '/redirect-private') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      if (url.pathname === '/redirect-ok') return new Response(null, { status: 307, headers: { location: '/echo?after=redirect' } });
      if (url.pathname === '/redirect-away') return new Response('moved', { status: 302, headers: { location: 'https://other.example.test/landing' } });
      if (url.pathname === '/login') return new Response('no', { status: 401, headers: { 'www-authenticate': 'Basic realm="Sign in"' } });
      if (url.pathname === '/big') return new Response('x'.repeat(5 * 1024 * 1024 + 1));
      if (url.pathname === '/empty') return new Response(null, { status: 204 });
      return Response.json({ ok: true }, { status: 201, headers: { 'set-cookie': 'tracker=1', 'x-upstream': 'yes', 'access-control-allow-origin': '*' } });
    } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const f of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) await db.batch((await readFile('drizzle/' + f, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const adapter = testAdapter(db), user = await adapter.createUser({ name: 'p', email: 'p@example.test', emailVerified: new Date() }), token = crypto.randomUUID();
  await adapter.createSession({ sessionToken: token, userId: user.id, expires: new Date(Date.now() + 86400000) });
  const send = (target: string | null, init: { method?: string; body?: string; headers?: Record<string, string>; signedIn?: boolean } = {}) => mf.dispatchFetch(origin + '/api/proxy', { method: init.method || 'GET', body: init.body,
    headers: { origin, ...(init.signedIn === false ? {} : { cookie: '__Secure-authjs.session-token=' + token }), ...(target ? { 'x-proxy-url': target } : {}), ...init.headers } }) as Promise<JsonResponse>;

  assert.equal((await send('https://api.example.test/echo', { signedIn: false })).status, 401);
  assert.equal((await send(null)).status, 400);
  assert.equal((await send('http://127.0.0.1/admin')).status, 403);
  assert.equal(seen.length, 0, 'rejected targets are never contacted');

  const posted = await send('https://api.example.test/echo?q=1', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json', authorization: 'Bearer target-token', 'x-custom': 'kept' } });
  assert.equal(posted.status, 201); assert.deepEqual(await posted.json(), { ok: true });
  assert.equal(posted.headers.get('set-cookie'), null); assert.equal(posted.headers.get('access-control-allow-origin'), null);
  assert.equal(posted.headers.get('x-upstream'), 'yes'); assert.equal(posted.headers.get('cache-control'), 'private, no-store');
  const upstream = seen.at(-1)!;
  assert.equal(upstream.url, 'https://api.example.test/echo?q=1'); assert.equal(upstream.method, 'POST'); assert.equal(upstream.body, '{"a":1}');
  assert.equal(upstream.headers.authorization, 'Bearer target-token'); assert.equal(upstream.headers['x-custom'], 'kept');
  for (const name of ['cookie', 'origin', 'x-proxy-url']) assert.equal(upstream.headers[name], undefined, name + ' is not forwarded');

  const redirected = await send('https://api.example.test/redirect-ok', { method: 'PUT', body: 'kept' });
  assert.equal(redirected.status, 201); assert.equal(seen.at(-1)!.url, 'https://api.example.test/echo?after=redirect'); assert.equal(seen.at(-1)!.method, 'PUT');
  const before = seen.length;
  assert.equal((await send('https://api.example.test/redirect-private')).status, 403);
  assert.equal(seen.length, before + 1, 'the private redirect target is never contacted');
  assert.equal((await send('https://api.example.test/big')).status, 502);
  const empty = await send('https://api.example.test/empty'); assert.equal(empty.status, 204);
  await send('https://api.example.test/redirect-away', { headers: { authorization: 'Bearer secret', 'x-api-key': 'k', accept: 'application/json' } });
  const landed = seen.at(-1)!;
  assert.equal(landed.url, 'https://other.example.test/landing');
  assert.equal(landed.headers.authorization, undefined, 'credentials are not carried to another origin');
  assert.equal(landed.headers['x-api-key'], undefined); assert.equal(landed.headers.accept, 'application/json');
  const login = await send('https://api.example.test/login'); assert.equal(login.status, 401); assert.equal(login.headers.get('www-authenticate'), null);
  for (const target of ['http://localhost./', 'https://workbench.example.test./api/documents', 'https://workbench.example.test:8443/']) assert.equal((await send(target)).status, 403, target);
  assert.equal((await send('https://api.example.test/echo')).status, 429, 'the per-user rate limit applies');
  assert.equal((await send('https://api.example.test/echo', { method: 'POST', body: 'x', headers: { origin: 'https://evil.test' } })).status, 403);
});
