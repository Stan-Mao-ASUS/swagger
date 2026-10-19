import { HttpError, readLimited } from './documents.ts';
import { origin } from './auth.ts';
import type { User } from '../shared/types.ts';

const LIMIT = 5 * 1024 * 1024, TIMEOUT = 15000, MAX_REDIRECTS = 5;
const DROP_REQUEST = new Set(['cookie', 'origin', 'referer', 'host', 'x-proxy-url', 'content-length', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'forwarded', 'x-real-ip']);
const SAFE_ACROSS_ORIGINS = new Set(['accept', 'accept-language', 'content-type', 'user-agent']);
const DROP_RESPONSE = new Set(['www-authenticate', 'proxy-authenticate', 'set-cookie', 'set-cookie2', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'strict-transport-security', 'alt-svc']);
const forwardable = (name: string) => !DROP_REQUEST.has(name) && !/^(cf-|sec-|x-forwarded-)/.test(name);
const keptInResponse = (name: string) => !DROP_RESPONSE.has(name) && !name.startsWith('access-control-') && !name.startsWith('cf-');

function privateIPv4(host: string) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32)
    || (a === 192 && (b === 168 || (b === 0 && parts[2] === 0))) || (a === 198 && (b === 18 || b === 19));
}
// The URL parser has already normalized hosts, so decimal or hex IPv4 forms arrive as dotted quads.
// Workers cannot reach private networks by DNS name, so literal addresses and local names are what remain to block.
export function proxyTarget(raw: string, siteOrigin: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, '代理目標網址不正確。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new HttpError(400, '代理只支援不含帳密的 http／https 網址。');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const local = host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host) || (!host.includes('.') && !host.includes(':'));
  const ipv6 = host.includes(':') && !/^[23][0-9a-f]{3}:/.test(host);
  if (local || ipv6 || privateIPv4(host) || host === new URL(siteOrigin).hostname.toLowerCase()) throw new HttpError(403, '不允許代理到本機、私人網路或本站。');
  return url;
}

export async function proxyRequest(request: Request, env: Env, user: User): Promise<Response> {
  const raw = request.headers.get('x-proxy-url');
  if (!raw) throw new HttpError(400, '請提供代理目標網址。');
  if (!env.PROXY_LIMITER) throw new HttpError(503, '代理暫時無法使用。');
  if (!(await env.PROXY_LIMITER.limit({ key: user.id })).success) throw new HttpError(429, '代理請求過於頻繁，請稍後再試（每分鐘 30 次）。');
  let url = proxyTarget(raw, origin(env)), method = request.method;
  const headers = new Headers();
  for (const [name, value] of request.headers) if (forwardable(name)) headers.set(name, value);
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    if (Number(request.headers.get('content-length')) > LIMIT) throw new HttpError(413, '代理請求內容超過 5 MB。');
    body = (await readLimited(request.body, LIMIT)) ?? undefined;
    if (!body) throw new HttpError(413, '代理請求內容超過 5 MB。');
  }
  let response: Response;
  // Redirects are followed here so every hop is checked against the same target rules.
  for (let hop = 0; ; hop++) {
    try { response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) }); }
    catch (error) { throw new HttpError(502, (error as Error).name === 'TimeoutError' ? '代理目標逾時（15 秒）。' : '無法連線到代理目標。'); }
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    if (hop === MAX_REDIRECTS) throw new HttpError(502, '代理目標重新導向次數過多。');
    await response.body?.cancel();
    const next = proxyTarget(new URL(location, url).href, origin(env));
    // Like browsers, never carry credentials to another origin; only content negotiation headers survive.
    if (next.origin !== url.origin) for (const name of [...headers.keys()]) if (!SAFE_ACROSS_ORIGINS.has(name)) headers.delete(name);
    url = next;
    if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; headers.delete('content-type'); }
  }
  const empty = method === 'HEAD' || [101, 204, 205, 304].includes(response.status) || !response.body;
  const content = empty ? null : await readLimited(response.body!, LIMIT);
  if (!empty && !content) throw new HttpError(502, '代理回應超過 5 MB。');
  const out = new Headers();
  for (const [name, value] of response.headers) if (keptInResponse(name)) out.set(name, value);
  out.set('cache-control', 'private, no-store'); out.set('x-content-type-options', 'nosniff'); out.set('content-security-policy', "default-src 'none'; sandbox"); out.set('x-proxy-target', url.href);
  return new Response(content, { status: response.status === 101 ? 502 : response.status, headers: out });
}
