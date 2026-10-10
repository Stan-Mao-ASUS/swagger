import { build } from 'esbuild';
import { readdir, readFile, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
await import('./compile-validators.mjs');
const assets = {};
async function walk(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) await walk(path.join(dir, item.name), name);
    else assets['/' + name] = await readFile(path.join(dir, item.name), 'utf8');
  }
}
await mkdir('.sites-runtime', { recursive: true });
// Build the JSX frontend independently; never include Worker code or secrets in it.
const client = await build({ entryPoints: ['src/main.jsx'], outfile: 'app.js', bundle: true, format: 'iife', platform: 'browser',
  target: 'es2022', jsx: 'automatic', minify: true, write: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
const validationWorker = await build({ entryPoints: ['src/validation-worker.js'], outfile: 'validation-worker.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false });
await walk('public');
assets['/validation-worker.js'] = validationWorker.outputFiles[0].text;
assets['/app.js'] = client.outputFiles.find(file => file.path.endsWith('app.js')).text;
await writeFile('.sites-runtime/assets.js', `export default ${JSON.stringify(assets)};`);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, conditions: ['worker', 'browser'], logLevel: 'info' });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await import('./verify-build.mjs');
