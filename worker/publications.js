import { json, HttpError, readJson, validName, initialVersion } from './documents.js';
const fields = 'p.id, p.visibility, p.expires_at AS expiresAt, p.version, p.title, p.summary, p.created_at AS createdAt, p.updated_at AS updatedAt';
const liveJoin = 'FROM publications p JOIN documents d ON d.id = p.document_id AND d.deleted_at IS NULL JOIN document_versions v ON v.document_id = d.id AND v.version = p.version';
function requireStorage(env) {
  if (!env.DB || !env.BUCKET) throw new HttpError(503, '分享區暫時無法使用，請稍後再試。');
}
export async function sharedDocuments(request, env) {
  requireStorage(env);
  if (request.method !== 'GET') return json({ error: '分享區僅供讀取。' }, 405);
  const url = new URL(request.url), id = url.pathname.slice('/api/shared'.length).replace(/^\//, '');
  if (id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, '此分享不存在或已撤下。');
    const row = await env.DB.prepare(`SELECT ${fields}, v.file_name AS fileName, v.object_key ${liveJoin} WHERE p.id = ? AND (p.expires_at IS NULL OR p.expires_at > ?)`).bind(id, new Date().toISOString()).first();
    if (!row) throw new HttpError(404, '此分享不存在或已撤下。');
    const object = await env.BUCKET.get(row.object_key);
    if (!object) throw new HttpError(503, '分享內容暫時無法讀取。');
    const { object_key, ...publication } = row;
    // Explicit public fields only: no document ID, owner, email, category or private version note.
    return json({ publication: { ...publication, source: await object.text() } });
  }
  const offset = Number(url.searchParams.get('offset') || 0), q = (url.searchParams.get('q') || '').trim();
  if (!Number.isSafeInteger(offset) || offset < 0 || q.length > 200) throw new HttpError(400, '搜尋條件不正確。');
  const { results } = await env.DB.prepare(`SELECT ${fields} ${liveJoin} WHERE p.visibility = 'public' AND (p.expires_at IS NULL OR p.expires_at > ?) AND (instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.summary), lower(?)) > 0) ORDER BY p.updated_at DESC, p.id DESC LIMIT 25 OFFSET ?`).bind(new Date().toISOString(), q, q, offset).all();
  return json({ publications: results.slice(0, 24), nextOffset: results.length > 24 ? offset + 24 : null });
}
export async function managePublication(request, env, user, id) {
  requireStorage(env);
  const db = env.DB;
  const document = await db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, user.id).first();
  if (!document) throw new HttpError(404, '找不到這份文件。');
  const read = () => db.prepare(`SELECT ${fields} FROM publications p WHERE p.document_id = ?`).bind(id).first();
  if (request.method === 'GET') return json({ publication: await read() });
  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM publications WHERE document_id = ? AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND user_id = ?)').bind(id, id, user.id).run();
    return json({ revoked: true });
  }
  if (request.method !== 'PUT') return json({ error: '不支援此操作。' }, 405);
  const body = await readJson(request);
  if (Object.keys(body).some(key => !['version', 'title', 'summary', 'confirmPublic', 'visibility', 'expiresAt', 'rotateLink'].includes(key)) || body.confirmPublic !== true || !Number.isSafeInteger(body.version) || body.version < 1) throw new HttpError(400, '請選擇版本並確認公開內容。');
  const visibility = body.visibility ?? 'public';
  if (!['public', 'unlisted'].includes(visibility) || (body.rotateLink !== undefined && typeof body.rotateLink !== 'boolean')) throw new HttpError(400, '分享權限不正確。');
  const expiresAt = body.expiresAt ?? null;
  if (expiresAt !== null && (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || new Date(expiresAt).toISOString() !== expiresAt || Date.parse(expiresAt) <= Date.now())) throw new HttpError(400, '到期時間必須是未來的有效時間。');
  const title = validName(body.title, 200), summary = body.summary ?? '';
  if (typeof summary !== 'string' || summary.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(summary)) throw new HttpError(400, '分享說明最多 500 字。');
  const now = new Date().toISOString();
  const results = await db.batch([
    initialVersion(db, id, user.id),
    // Select a specific immutable owned version in the write itself. Never publish the mutable current object.
    db.prepare(`INSERT INTO publications (id, document_id, version, title, summary, created_at, updated_at, visibility, expires_at)
      SELECT ?, d.id, v.version, ?, ?, ?, ?, ?, ? FROM documents d JOIN document_versions v ON v.document_id = d.id
      WHERE d.id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND v.version = ?
      ON CONFLICT(document_id) DO UPDATE SET id = CASE WHEN publications.visibility != excluded.visibility OR publications.expires_at <= excluded.updated_at OR ? = 1 THEN excluded.id ELSE publications.id END, visibility = excluded.visibility, expires_at = excluded.expires_at, version = excluded.version, title = excluded.title, summary = excluded.summary, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), title, summary.trim(), now, now, visibility, expiresAt, id, user.id, body.version, body.rotateLink ? 1 : 0),
  ]);
  if (!results[1].meta.changes) throw new HttpError(404, '找不到文件或版本，請重新開啟後再試。');
  return json({ publication: await read() }, 200);
}
