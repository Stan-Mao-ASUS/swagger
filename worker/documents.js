import { load, JSON_SCHEMA } from 'js-yaml';
export const MAX_BYTES = 5 * 1024 * 1024;
export function json(body, status = 200) { return Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }); }
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function boundedText(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new HttpError(413, '文件不能超過 5 MB。');
  if (!request.body) throw new HttpError(400, '請提供 YAML / JSON 內容。');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(413, '文件不能超過 5 MB。'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(result);
}
function validate(source) {
  let spec;
  try { spec = load(source, { schema: JSON_SCHEMA }); } catch { throw new HttpError(400, 'YAML 格式錯誤，請修正後再儲存。'); }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new HttpError(400, 'API 定義必須是物件。');
  if (spec.swagger !== '2.0' && !/^3\.(0|1)\.\d+$/.test(String(spec.openapi || ''))) throw new HttpError(400, '請提供 Swagger 2.0 或 OpenAPI 3.0 / 3.1。');
  if (typeof spec.info?.title !== 'string' || !spec.info.title.trim() || spec.info.title.length > 500 || typeof spec.info?.version !== 'string') throw new HttpError(400, '文件需要 title（最多 500 字）與 version。');
  if ((!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) && !(String(spec.openapi).startsWith('3.1.') && (spec.webhooks || spec.components))) throw new HttpError(400, '文件需要 paths 物件。');
  return spec.info.title;
}
const columns = 'id, title, file_name AS fileName, source_type AS sourceType, created_at AS createdAt, updated_at AS updatedAt';
export async function documents(request, env, user) {
  const db = env.DB; const bucket = env.BUCKET;
  if (!db || !bucket) throw new HttpError(503, '文件儲存暫時無法使用，請稍後再試。');
  const url = new URL(request.url); const id = url.pathname.slice('/api/documents'.length).replace(/^\//, '');
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, '找不到這份文件。');
  if (request.method === 'GET' && !id) {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, '無效的頁碼。');
    const { results } = await db.prepare(`SELECT ${columns} FROM documents WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?`).bind(user.id, offset).all();
    return json({ documents: results.slice(0, 50), nextOffset: results.length > 50 ? offset + 50 : null });
  }
  if (request.method === 'POST' && !id) {
    const sourceType = request.headers.get('x-source-type');
    if (!['upload', 'paste', 'import'].includes(sourceType)) throw new HttpError(400, '無效的來源類型。');
    let fileName;
    try { fileName = decodeURIComponent(request.headers.get('x-file-name') || 'document.yaml'); } catch { throw new HttpError(400, '無效的檔案名稱。'); }
    if (!fileName.trim() || fileName.length > 255 || /[\x00-\x1f]/.test(fileName)) throw new HttpError(400, '檔案名稱不正確或過長。');
    const source = await boundedText(request); const title = validate(source);
    const id = crypto.randomUUID(); const key = `${encodeURIComponent(user.id)}/${id}.yaml`; const now = new Date().toISOString();
    await bucket.put(key, source, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    try {
      await db.prepare('INSERT INTO documents (id, user_id, title, file_name, source_type, object_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.id, title, fileName, sourceType, key, now, now).run();
    } catch (error) { await bucket.delete(key).catch(() => {}); throw error; }
    return json({ document: { id, title, fileName, sourceType, createdAt: now, updatedAt: now } }, 201);
  }
  if (id && ['GET', 'DELETE'].includes(request.method)) {
    // Ownership is in the SQL query, before any R2 read or deletion.
    const row = await db.prepare(`SELECT ${columns}, object_key, deleted_at FROM documents WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
    if (!row || (request.method === 'GET' && row.deleted_at)) throw new HttpError(404, '找不到這份文件。');
    if (request.method === 'DELETE') {
      await db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(new Date().toISOString(), new Date().toISOString(), id, user.id).run();
      await bucket.delete(row.object_key);
      await db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      return json({ deleted: true });
    }
    const object = await bucket.get(row.object_key);
    if (!object) throw new HttpError(503, '文件內容暫時無法讀取，請稍後再試。');
    const { object_key, deleted_at, ...metadata } = row;
    return json({ document: { ...metadata, source: await object.text() } });
  }
  return json({ error: '不支援此操作。' }, 405);
}
