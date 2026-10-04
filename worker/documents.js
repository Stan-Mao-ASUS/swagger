import { MAX_BYTES, parseDefinition } from '../shared/openapi.js';
export { MAX_BYTES };
export function json(body, status = 200) { return Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }); }
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function boundedText(request, limit = MAX_BYTES) {
  const tooLarge = () => new HttpError(413, limit === MAX_BYTES ? '文件不能超過 5 MB。' : '設定內容過大。');
  if (Number(request.headers.get('content-length')) > limit) throw tooLarge();
  if (!request.body) throw new HttpError(400, '請提供 YAML / JSON 內容。');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw tooLarge(); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(result); }
  catch { throw new HttpError(400, '檔案編碼不正確，請使用 UTF-8。'); }
}
function validate(source) {
  try { return parseDefinition(source).info.title; }
  catch (error) { throw new HttpError(400, error.mark ? 'YAML 格式錯誤，請修正後再儲存。' : error.message); }
}
const columns = 'id, title, COALESCE(display_name, title) AS displayName, category_id AS categoryId, file_name AS fileName, source_type AS sourceType, created_at AS createdAt, updated_at AS updatedAt';
export async function documents(request, env, user) {
  const db = env.DB; const bucket = env.BUCKET;
  if (!db || !bucket) throw new HttpError(503, '文件儲存暫時無法使用，請稍後再試。');
  const url = new URL(request.url); const id = url.pathname.slice('/api/documents'.length).replace(/^\//, '');
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, '找不到這份文件。');
  if (request.method === 'GET' && !id) {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, '無效的頁碼。');
    const filters = ['user_id = ?', 'deleted_at IS NULL']; const values = [user.id];
    const query = (url.searchParams.get('q') || '').trim();
    if (query.length > 200) throw new HttpError(400, '搜尋文字過長。');
    if (query) { filters.push('(instr(lower(COALESCE(display_name, title)), lower(?)) > 0 OR instr(lower(file_name), lower(?)) > 0)'); values.push(query, query); }
    const category = url.searchParams.get('category');
    if (category === 'uncategorized') filters.push('category_id IS NULL');
    else if (category) { filters.push('category_id = ?'); values.push(category); }
    for (const [param, operator] of [['from', '>='], ['to', '<']]) {
      const date = url.searchParams.get(param);
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) throw new HttpError(400, '日期格式不正確。');
        filters.push('created_at ' + operator + ' ?'); values.push(date);
      }
    }
    if (url.searchParams.get('from') && url.searchParams.get('to') && url.searchParams.get('from') >= url.searchParams.get('to')) throw new HttpError(400, '開始日期必須早於結束日期。');
    const orders = { created: 'created_at DESC', updated: 'updated_at DESC', name: 'COALESCE(display_name, title) COLLATE NOCASE ASC' };
    const sort = url.searchParams.get('sort') || 'created';
    if (!Object.hasOwn(orders, sort)) throw new HttpError(400, '排序方式不正確。');
    const { results } = await db.prepare(`SELECT ${columns} FROM documents WHERE ${filters.join(' AND ')} ORDER BY ${orders[sort]}, id DESC LIMIT 51 OFFSET ?`).bind(...values, offset).all();
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
    return json({ document: { id, title, displayName: title, categoryId: null, fileName, sourceType, createdAt: now, updatedAt: now } }, 201);
  }
  if (id && request.method === 'PATCH') {
    const row = await db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, user.id).first();
    if (!row) throw new HttpError(404, '找不到這份文件。');
    const body = await readJson(request);
    if (!Object.keys(body).length || Object.keys(body).some(key => !['displayName', 'categoryId'].includes(key))) throw new HttpError(400, '無效的文件設定。');
    const sets = ['updated_at = ?']; const values = [new Date().toISOString()];
    if ('displayName' in body) { sets.push('display_name = ?'); values.push(validName(body.displayName, 200)); }
    if ('categoryId' in body) {
      if (body.categoryId !== null && typeof body.categoryId !== 'string') throw new HttpError(400, '無效的分類。');
      sets.push('category_id = ?'); values.push(body.categoryId);
    }
    // The category ownership check is part of the write, so a concurrent deletion cannot bypass it.
    const categoryId = body.categoryId ?? null;
    const result = await db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM categories WHERE id = ? AND user_id = ?))`).bind(...values, id, user.id, categoryId, categoryId, user.id).run();
    if (!result.meta.changes) throw new HttpError(404, '找不到文件或分類，請重新整理。');
    return json({ document: await db.prepare(`SELECT ${columns} FROM documents WHERE id = ? AND user_id = ?`).bind(id, user.id).first() });
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

export async function readJson(request) {
  const raw = await boundedText(request, 16384);
  let body; try { body = JSON.parse(raw); } catch { throw new HttpError(400, '設定格式不正確。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '設定格式不正確。');
  return body;
}
export function validName(value, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) throw new HttpError(400, `名稱請填寫 1–${max} 個字。`);
  return value.trim();
}
