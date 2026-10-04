import assets from '../.sites-runtime/assets.js';
import { handleAuth, getUser, authReady, origin } from './auth.js';
import { librarySettings } from './library-settings.js';
import { documents, json, HttpError } from './documents.js';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(request.method) && (request.headers.get('origin') !== origin(env) || request.headers.get('sec-fetch-site') === 'cross-site')) throw new HttpError(403, '請從本站操作。');
        if (path === '/api/me' && request.method === 'GET') return json({ user: await getUser(request, env), googleConfigured: authReady(env) });
        if (path.startsWith('/api/auth/')) {
          if (!authReady(env)) return json({ error: 'Google 登入尚未設定完成。' }, 503);
          // Auth.js can return Response.redirect(), whose headers are immutable.
          const authResponse = await handleAuth(request, env);
          const response = new Response(authResponse.body, authResponse);
          response.headers.set('cache-control', 'private, no-store');
          return response;
        }
        if (path === '/api/preferences' || path === '/api/categories' || path.startsWith('/api/categories/') || path === '/api/documents' || path.startsWith('/api/documents/')) {
          const user = await getUser(request, env);
          if (!user) throw new HttpError(401, '請先使用 Google 登入。');
          return path.startsWith('/api/documents') ? await documents(request, env, user) : await librarySettings(request, env, user);
        }
        return json({ error: '找不到此 API。' }, 404);
      }
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const file = path === '/' ? '/index.html' : path;
      if (!(file in assets)) return new Response('Not found', { status: 404 });
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/plain';
      return new Response(request.method === 'HEAD' ? null : assets[file], { headers: { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed', path, error.name);
      return json({ error: error instanceof HttpError ? error.message : '服務暫時無法使用；內容未清除，請稍後再試。' }, error.status || 503);
    }
  }
};
