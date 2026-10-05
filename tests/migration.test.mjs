import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
test('additive library migration preserves existing document metadata and nullable defaults', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', d1Databases: ['DB'], compatibilityDate: '2025-09-27' });
  try {
    const db = await mf.getD1Database('DB');
    const files = (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort();
    const apply = async file => db.batch((await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    await apply(files[0]);
    await db.prepare("INSERT INTO users (id, email) VALUES ('legacy-owner', 'legacy@example.test')").run();
    await db.prepare("INSERT INTO documents (id,user_id,title,file_name,source_type,object_key,created_at,updated_at) VALUES ('legacy-doc','legacy-owner','原本的 API','original.yaml','upload','legacy-key','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();
    const before = await db.prepare("SELECT * FROM documents WHERE id = 'legacy-doc'").first();
    for (const file of files.slice(1)) await apply(file);
    const { display_name, category_id, current_version, ...after } = await db.prepare("SELECT * FROM documents WHERE id = 'legacy-doc'").first();
    assert.deepEqual(after, before); assert.equal(current_version, 1); assert.equal(display_name, null); assert.equal(category_id, null);
    await db.prepare("INSERT INTO categories (id,user_id,name) VALUES ('category','legacy-owner','Legacy')").run();
    await db.prepare("UPDATE documents SET category_id = 'category' WHERE id = 'legacy-doc'").run();
    await db.prepare("DELETE FROM categories WHERE id = 'category'").run();
    assert.equal((await db.prepare("SELECT category_id FROM documents WHERE id = 'legacy-doc'").first()).category_id, null);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});
