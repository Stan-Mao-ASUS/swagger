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

// wrangler deploys dist/server/index.js as-is (no_bundle); reject stale or stray build output.
if (JSON.stringify(await files('dist')) !== JSON.stringify(['server/index.js'])) throw new Error('Unexpected build files. Run npm run build immediately before deploying.');
if (!(await readFile('dist/server/index.js')).length) throw new Error('Worker build is empty.');
console.log('Build contents verified.');
