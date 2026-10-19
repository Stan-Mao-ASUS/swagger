import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const vars = parseEnv(await readFile('.env', 'utf8').catch(() => ''));
const mf = new Miniflare({
  modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27',
  host: '127.0.0.1', port: 4173, bindings: { ...vars, SITE_ORIGIN: 'http://localhost:4173' },
  d1Databases: ['DB'], r2Buckets: ['BUCKET'], d1Persist: '.sites-runtime/d1', r2Persist: '.sites-runtime/r2',
});
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)').run();
for (const name of (await readdir('drizzle')).filter(n => n.endsWith('.sql')).sort()) {
  if (await db.prepare('SELECT name FROM local_migrations WHERE name = ?').bind(name).first()) continue;
  const sql = await readFile('drizzle/' + name, 'utf8');
  await db.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  await db.prepare('INSERT INTO local_migrations (name) VALUES (?)').bind(name).run();
}
console.log('Local: http://localhost:4173');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
