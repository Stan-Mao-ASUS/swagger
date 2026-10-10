import { json, HttpError, boundedText } from './documents.js';
export async function manageDraft(request, env, user) {
  if (!env.DB || !env.BUCKET) throw new HttpError(503, '草稿儲存暫時無法使用。');
  const key = new URL(request.url).pathname.slice('/api/drafts/'.length);
  if (key !== 'new' && !/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(404, '找不到草稿。');
  const db = env.DB, bucket = env.BUCKET;
  const document = key === 'new' ? null : await db.prepare('SELECT current_version FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(key, user.id).first();
  if (key !== 'new' && !document) throw new HttpError(404, '找不到文件。');
  const row = await db.prepare('SELECT * FROM drafts WHERE user_id = ? AND draft_key = ?').bind(user.id, key).first();
  if (request.method === 'GET') {
    if (!row?.object_key) return json({ draft: null, revision: row?.revision || 0 });
    const object = await bucket.get(row.object_key);
    if (!object) throw new HttpError(503, '草稿暫時無法讀取，請重試。');
    return json({ revision: row.revision, draft: { source: await object.text(), fileName: row.file_name, sourceType: row.source_type, baseVersion: row.base_version, updatedAt: row.updated_at } });
  }
  if (!['PUT','DELETE'].includes(request.method)) return json({ error: '不支援此操作。' }, 405);
  const header = request.headers.get('x-draft-revision');
  const revision = Number(header);
  if (header === null || !Number.isSafeInteger(revision) || revision < 0) throw new HttpError(400, '請提供草稿版本。');
  if (revision !== (row?.revision || 0)) throw new HttpError(409, '另一個分頁已更新草稿，請重新讀取後再處理。');
  let fileName = row?.file_name || 'draft.yaml', sourceType = row?.source_type || 'paste', baseVersion = row?.base_version ?? null;
  let objectKey = null;
  if (request.method === 'PUT') {
    try { fileName = decodeURIComponent(request.headers.get('x-file-name') || 'draft.yaml'); } catch { throw new HttpError(400, '檔案名稱不正確。'); }
    sourceType = request.headers.get('x-source-type');
    baseVersion = key === 'new' ? null : Number(request.headers.get('x-base-version'));
    if (!fileName.trim() || fileName.length > 255 || /[\x00-\x1f]/.test(fileName) || !['upload','paste','import'].includes(sourceType) || (key !== 'new' && (!Number.isSafeInteger(baseVersion) || baseVersion < 1 || baseVersion > document.current_version))) throw new HttpError(400, '草稿資料不正確。');
    // Drafts deliberately accept unfinished/invalid YAML, independently of formal versions.
    const source = await boundedText(request);
    objectKey = `${encodeURIComponent(user.id)}/drafts/${key}/${crypto.randomUUID()}`;
    await bucket.put(objectKey, source, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  }
  const now = new Date().toISOString();
  let result;
  try {
    result = await db.prepare(`INSERT INTO drafts (user_id, draft_key, document_id, revision, object_key, file_name, source_type, base_version, updated_at)
      SELECT ?, ?, ?, 1, ?, ?, ?, ?, ? WHERE (? = 'new' OR EXISTS (SELECT 1 FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL)) AND (? = 0 OR EXISTS (SELECT 1 FROM drafts WHERE user_id = ? AND draft_key = ?))
      ON CONFLICT(user_id, draft_key) DO UPDATE SET revision = drafts.revision + 1, object_key = excluded.object_key, file_name = excluded.file_name, source_type = excluded.source_type, base_version = excluded.base_version, updated_at = excluded.updated_at WHERE drafts.revision = ?`)
      .bind(user.id, key, key === 'new' ? null : key, objectKey, fileName, sourceType, baseVersion, now, key, key, user.id, revision, user.id, key, revision).run();
    if (!result.meta.changes) throw new HttpError(409, '草稿或文件已在另一個分頁變更，內容未覆蓋。');
  } catch (error) { if (objectKey) await bucket.delete(objectKey).catch(() => {}); throw error; }
  if (row?.object_key) await bucket.delete(row.object_key).catch(() => {});
  return json({ revision: revision + 1, updatedAt: now });
}
