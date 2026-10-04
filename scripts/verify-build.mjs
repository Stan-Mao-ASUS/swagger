import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, name));
    else result.push(name);
  }
  return result.sort();
}

// Reject stale/sync-created copies, especially duplicate migrations, before packaging.
const migrations = await files('drizzle');
const expected = ['server/index.js', '.openai/hosting.json', ...migrations.map(file => '.openai/drizzle/' + file)].sort();
const actual = await files('dist');
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected build files. Run npm run build immediately before packaging.');
for (const [source, output] of [['.openai/hosting.json', 'dist/.openai/hosting.json'], ...migrations.map(file => ['drizzle/' + file, 'dist/.openai/drizzle/' + file])]) {
  if (!(await readFile(source)).equals(await readFile(output))) throw new Error('Build metadata differs from source: ' + source);
}
if (!(await readFile('dist/server/index.js')).length) throw new Error('Worker build is empty.');
console.log('Build contents verified.');
