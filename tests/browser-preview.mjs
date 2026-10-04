// LOCAL QA ONLY. This file is never bundled or deployed. No authentication test routes exist in the Worker.
import http from 'node:http';
import { Miniflare } from 'miniflare';
import { D1Adapter } from '@auth/d1-adapter';
import { readdir, readFile } from 'node:fs/promises';
const origin = 'http://localhost:4173';
const mf = new Miniflare({ modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], r2Buckets: ['BUCKET'], d1Persist: '.sites-runtime/library-qa/d1', r2Persist: '.sites-runtime/library-qa/r2', bindings: { SITE_ORIGIN: origin, AUTH_GOOGLE_ID: 'local-qa-only.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'local-qa-only', AUTH_SECRET: 'local-qa-only-not-a-production-secret-1234567' } });
const db = await mf.getD1Database('DB');
if (!(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first())) {
  for (const file of (await readdir('drizzle')).filter(x => x.endsWith('.sql')).sort()) await db.batch((await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
}
const adapter = D1Adapter(db); const tokens = {};
for (const name of ['Alice','Bob']) {
  const email = name.toLowerCase() + '@example.test';
  const user = await adapter.getUserByEmail(email) || await adapter.createUser({ name: '本機測試 ' + name, email, emailVerified: new Date(), image: null });
  tokens[name.toLowerCase()] = crypto.randomUUID();
  await adapter.createSession({ sessionToken: tokens[name.toLowerCase()], userId: user.id, expires: new Date(Date.now() + 86400000) });
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/__qa') { res.setHeader('content-type','text/html; charset=utf-8'); res.end('<h1>本機測試帳號</h1><p>僅測試 Auth.js session 與文件功能，這不是 Google OAuth 驗證。</p><a href="/__qa/alice">Alice</a> <a href="/__qa/bob">Bob</a>'); return; }
    const account = req.url?.match(/^\/__qa\/(alice|bob)$/)?.[1];
    if (account) { res.writeHead(302, { 'set-cookie': `authjs.session-token=${tokens[account]}; Path=/; HttpOnly; SameSite=Lax`, location: '/' }); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await mf.dispatchFetch(origin + req.url, { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    res.statusCode = response.status; for (const [key,value] of response.headers) if (key !== 'set-cookie') res.setHeader(key,value);
    if (response.headers.getSetCookie().length) res.setHeader('set-cookie',response.headers.getSetCookie());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500);res.end('Local test failed'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://localhost:4173 — QA account selector: http://localhost:4173/__qa'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { server.close(); await mf.dispose(); process.exit(0); });
