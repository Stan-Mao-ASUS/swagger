import { build } from 'esbuild';
import { readdir, readFile, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const assets = {};
async function walk(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) await walk(path.join(dir, item.name), name);
    else assets['/' + name] = await readFile(path.join(dir, item.name), 'utf8');
  }
}
await walk('public');
await mkdir('.sites-runtime', { recursive: true });
await writeFile('.sites-runtime/assets.js', `export default ${JSON.stringify(assets)};`);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, conditions: ['worker', 'browser'], logLevel: 'info' });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
