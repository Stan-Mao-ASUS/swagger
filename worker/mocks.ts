import { json, HttpError, readJson, initialVersion, boundedText } from './documents.ts';
import { parseDefinition } from '../shared/openapi.ts';
import { mockResponse, mockControls, validateMockRequest } from '../shared/mock.ts';
import type { User } from '../shared/types.ts';
const fields = 'id, version, expires_at AS expiresAt, updated_at AS updatedAt';
export async function manageMock(request: Request, env: Env, user: User, id: string): Promise<Response> {
  const db = env.DB;
  const document = await db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, user.id).first();
  if (!document) throw new HttpError(404, '找不到這份文件。');
  const read = () => db.prepare(`SELECT ${fields} FROM mocks WHERE document_id = ?`).bind(id).first();
  if (request.method === 'GET') return json({ mock: await read() });
  if (request.method === 'DELETE') { await db.prepare('DELETE FROM mocks WHERE document_id = ?').bind(id).run(); return json({ revoked: true }); }
  if (request.method !== 'PUT') throw new HttpError(405, '不支援此操作。');
  const body = await readJson(request);
  if (Object.keys(body).some(k => !['version', 'confirmPublic', 'expiresInDays'].includes(k)) || body.confirmPublic !== true || !Number.isSafeInteger(body.version) || body.version < 1 || ![1, 7, 30].includes(body.expiresInDays)) throw new HttpError(400, '請選擇版本、有效期限並確認 Mock 內容可公開存取。');
  const now = new Date().toISOString(), expires = new Date(Date.now() + body.expiresInDays * 86400000).toISOString();
  const result = await db.batch([initialVersion(db, id, user.id), db.prepare(`INSERT INTO mocks (id, document_id, version, expires_at, updated_at)
    SELECT ?, d.id, v.version, ?, ? FROM documents d JOIN document_versions v ON v.document_id = d.id
    WHERE d.id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND v.version = ?
    ON CONFLICT(document_id) DO UPDATE SET id = excluded.id, version = excluded.version, expires_at = excluded.expires_at, updated_at = excluded.updated_at`).bind(crypto.randomUUID(), expires, now, id, user.id, body.version)]);
  if (!result[1].meta.changes) throw new HttpError(404, '找不到此版本。');
  return json({ mock: await read() });
}
// Capability URL grants access only to generated responses from the explicitly selected snapshot.
// Request payloads/cookies are validated in memory only: never forwarded, saved, or used as identity. No upstream calls.
export async function serveMock(request: Request, env: Env): Promise<Response> {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization', 'access-control-expose-headers': 'X-Mock-Source, X-Mock-Version', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' };
  const respond = (status: number, body: string | null, extra: Record<string, string> = {}) => new Response(request.method === 'HEAD' ? null : body, { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', ...extra } });
  let delay = 0;
  async function handle() {
    const url = new URL(request.url), match = url.pathname.match(/^\/mock\/([a-f0-9-]{36})(\/.*)?$/);
    if (!match) throw new HttpError(404, '找不到此 Mock。');
    const row = await env.DB.prepare(`SELECT m.version, v.object_key FROM mocks m JOIN documents d ON d.id = m.document_id AND d.deleted_at IS NULL JOIN document_versions v ON v.document_id = d.id AND v.version = m.version WHERE m.id = ? AND m.expires_at > ?`).bind(match[1], new Date().toISOString()).first<{ version: number; object_key: string }>();
    if (!row) throw new HttpError(404, 'Mock 不存在、已到期或已撤銷。');
    if (request.method === 'OPTIONS' && request.headers.has('access-control-request-method')) return new Response(null, { status: 204, headers });
    const controls = mockControls(url.searchParams); delay = controls.delay;
    const object = await env.BUCKET.get(row.object_key);
    if (!object) throw new HttpError(503, 'Mock 內容暫時無法讀取。');
    const spec = parseDefinition(await object.text()), path = match[2] || '/', version = { 'x-mock-version': String(row.version) };
    if (controls.validate) {
      let body = '';
      if (request.body && !['GET', 'HEAD'].includes(request.method)) {
        try { body = await boundedText(request, 256 * 1024); } catch (error) { throw error instanceof HttpError && error.status === 413 ? new HttpError(413, 'Mock 請求內容超過 256 KB。') : error; }
      }
      const issues = validateMockRequest(spec, request.method, path, { query: url.searchParams, headers: request.headers, body });
      if (issues.length) return respond(400, JSON.stringify({ error: 'Mock 請求不符合規格。', issues }), { 'x-mock-source': 'validation', ...version });
    }
    if (controls.failRate && Math.random() < controls.failRate) return respond(controls.failStatus, JSON.stringify({ error: 'Mock 模擬的錯誤回應。' }), { 'x-mock-source': 'fault', ...version });
    const result = mockResponse(spec, request.method, path, controls.status, controls.example);
    return respond(result.status, result.body, { 'content-type': result.contentType + '; charset=utf-8', 'x-mock-source': result.source, ...version });
  }
  const response = await handle().catch((error: { status?: number; message: string }) => respond(error.status || 503, JSON.stringify({ error: error.status ? error.message : 'Mock 暫時無法使用。' })));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return response;
}
