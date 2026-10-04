import { json, HttpError, readJson, validName } from './documents.js';
export async function librarySettings(request, env, user) {
  const db = env.DB;
  if (!db) throw new HttpError(503, '設定暫時無法使用。');
  const path = new URL(request.url).pathname;
  if (path === '/api/preferences') {
    if (request.method === 'GET') return json({ theme: (await db.prepare('SELECT theme FROM preferences WHERE user_id = ?').bind(user.id).first())?.theme || 'system' });
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'theme') || !['system', 'light', 'dark'].includes(body.theme)) throw new HttpError(400, '無效的外觀設定。');
      await db.prepare('INSERT INTO preferences (user_id, theme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme').bind(user.id, body.theme).run();
      return json({ theme: body.theme });
    }
    return json({ error: '不支援此操作。' }, 405);
  }
  const id = path.slice('/api/categories'.length).replace(/^\//, '');
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, '找不到分類。');
  if (!id && request.method === 'GET') {
    const { results } = await db.prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE, id').bind(user.id).all();
    return json({ categories: results });
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request); const name = validName(body.name);
    if (Object.keys(body).some(key => key !== 'name')) throw new HttpError(400, '無效的分類設定。');
    const id = crypto.randomUUID();
    const result = await db.prepare('INSERT INTO categories (id, user_id, name) VALUES (?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING').bind(id, user.id, name).run();
    if (!result.meta.changes) throw new HttpError(409, '已有相同名稱的分類。');
    return json({ category: { id, name } }, 201);
  }
  if (id && ['PATCH', 'DELETE'].includes(request.method)) {
    const row = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!row) throw new HttpError(404, '找不到分類。');
    if (request.method === 'PATCH') {
      const body = await readJson(request); const name = validName(body.name);
      if (Object.keys(body).some(key => key !== 'name')) throw new HttpError(400, '無效的分類設定。');
      const result = await db.prepare('UPDATE categories SET name = ? WHERE id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM categories WHERE user_id = ? AND name = ? AND id != ?)').bind(name, id, user.id, user.id, name, id).run();
      if (!result.meta.changes) throw new HttpError(409, '分類已不存在或已有相同名稱。');
      return json({ category: { id, name } });
    }
    await db.batch([
      db.prepare('UPDATE documents SET category_id = NULL, updated_at = ? WHERE category_id = ? AND user_id = ?').bind(new Date().toISOString(), id, user.id),
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, user.id),
    ]);
    return json({ deleted: true });
  }
  return json({ error: '不支援此操作。' }, 405);
}
