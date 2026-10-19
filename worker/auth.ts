import { Auth } from '@auth/core';
import Google from '@auth/core/providers/google';
import { D1Adapter } from '@auth/d1-adapter';
import type { AuthConfig } from '@auth/core';
import type { User } from '../shared/types.ts';
export function origin(env: Env): string { return env.SITE_ORIGIN; }
export function authReady(env: Env): boolean { return !!(env.SITE_ORIGIN && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && env.AUTH_SECRET); }
function logAuthError(error: Error & { type?: string; cause?: any }, env: Env) {
  const cause = error.cause?.err || error.cause;
  // Never log callback URLs, codes, tokens, profiles or provider response bodies.
  const clean = (value: unknown) => {
    let message = String(value || '');
    for (const secret of [env.AUTH_GOOGLE_SECRET, env.AUTH_SECRET, env.AUTH_GOOGLE_ID]) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    return message.replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9_\-]{30,}/g, '[redacted]').slice(0, 400);
  };
  const providerError = cause?.cause?.error;
  const safeProviderError = ['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client', 'access_denied', 'server_error', 'temporarily_unavailable'].includes(providerError) ? providerError : '';
  console.error('Authentication failed:', error.type || error.name, clean(cause?.name), clean(cause?.message), clean(cause?.code), safeProviderError);
}
export function authConfig(env: Env): AuthConfig {
  return {
    basePath: '/api/auth', trustHost: true,
    secret: env.AUTH_SECRET,
    useSecureCookies: origin(env).startsWith('https:'),
    adapter: D1Adapter(env.DB),
    session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60 },
    providers: [Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET, checks: ['pkce', 'state', 'nonce'], authorization: { params: { prompt: 'select_account', scope: 'openid email profile' } } })],
    callbacks: {
      signIn: ({ account, profile }) => account?.provider === 'google' && profile?.email_verified === true,
      session: ({ session, user }) => ({ ...session, user: { id: user.id, name: user.name, email: user.email, image: user.image } }),
      redirect: () => origin(env) + '/',
    },
    logger: { error: (error: Error) => logAuthError(error, env), warn: (code: string) => console.warn('Authentication warning:', code), debug: () => {} },
  };
}
export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Pin all callback URLs to the configured origin; never trust forwarded host headers.
  const target = new URL(url.pathname + url.search, origin(env));
  const headers = new Headers(request.headers);
  headers.delete('x-forwarded-host'); headers.delete('x-forwarded-proto'); headers.set('host', target.host);
  const init = { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body, duplex: 'half' } as RequestInit;
  return Auth(new Request(target, init), authConfig(env));
}
export async function getUser(request: Request, env: Env): Promise<User | null> {
  if (!authReady(env)) return null;
  const response = await handleAuth(new Request(new URL('/api/auth/session', origin(env)), { headers: { cookie: request.headers.get('cookie') || '' } }), env);
  if (!response.ok) throw new Error('Session lookup unavailable');
  const session = await response.json<{ user?: User } | null>();
  return session?.user?.id ? session.user : null;
}
