import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, Response } from 'miniflare';
import { readdir, readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { JsonResponse } from './helpers.ts';

const origin = 'https://workbench.example.test';
const clientId = 'test-only.apps.googleusercontent.com';

test('Google OAuth callback completes with a signed ID token and fails safely', async t => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let nonce: string | null = null, rejectToken = false;
  const mf = new Miniflare({
    modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27',
    d1Databases: ['DB'], r2Buckets: ['BUCKET'],
    bindings: { AUTH_GOOGLE_ID: clientId, AUTH_GOOGLE_SECRET: 'test-secret', AUTH_SECRET: 'test-only-secret-never-use-in-production-123456789', SITE_ORIGIN: origin },
    outboundService: async (request: { url: string }) => {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') return Response.json({
        issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      });
      if (url.pathname === '/token') {
        if (rejectToken) return Response.json({ error: 'invalid_client' }, { status: 401 });
        const id_token = await new SignJWT({ nonce, email: 'oauth@example.test', email_verified: true, name: 'OAuth Test' })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://accounts.google.com')
          .setAudience(clientId).setSubject('test-google-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
        return Response.json({ access_token: 'test-access', token_type: 'Bearer', expires_in: 3600, id_token });
      }
      if (url.pathname === '/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      if (url.pathname === '/v1/userinfo') return Response.json({ sub: 'test-google-subject', email: 'oauth@example.test', email_verified: true, name: 'OAuth Test' });
      throw new Error('Unexpected OAuth endpoint: ' + url.origin + url.pathname);
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(x => x.endsWith('.sql')).sort()) {
    await db.batch((await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  const cookies = new Map<string, string>();
  const request = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<JsonResponse> => {
    const response = await mf.dispatchFetch(origin + path, { ...init, redirect: 'manual', headers: {
      origin, cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '), ...init.headers,
    } });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response as JsonResponse;
  };
  async function start() {
    const { csrfToken } = await (await request('/api/auth/csrf')).json();
    const response = await request('/api/auth/signin/google', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken }).toString(),
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location')!);
    nonce = location.searchParams.get('nonce');
    return location.searchParams.get('state')!;
  }
  await t.test('verified Google identity creates a database session', async () => {
    const state = await start();
    const response = await request('/api/auth/callback/google?' + new URLSearchParams({ state, code: 'test-code' }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), origin + '/');
    const me = await (await request('/api/me')).json();
    assert.equal(me.user.email, 'oauth@example.test');
    assert.ok(me.user.id);
    assert.ok(await db.prepare('SELECT id FROM accounts WHERE provider = ?').bind('google').first());
  });
  await t.test('invalid state redirects without turning into a 503', async () => {
    const response = await request('/api/auth/callback/google?state=invalid&code=invalid');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') ?? '', /\/api\/auth\/error\?error=/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  });
  await t.test('provider rejects a token exchange without turning into a 503', async () => {
    rejectToken = true;
    const state = await start();
    const response = await request('/api/auth/callback/google?' + new URLSearchParams({ state, code: 'invalid-code' }));
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') ?? '', /\/api\/auth\/error\?error=/);
  });
});
