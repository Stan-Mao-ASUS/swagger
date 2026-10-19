import { build } from 'esbuild';
import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
await import('./compile-validators.ts');
const assets: Record<string, string> = {};
async function walk(dir: string, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) await walk(path.join(dir, item.name), name);
    else assets['/' + name] = await readFile(path.join(dir, item.name), 'utf8');
  }
}
await mkdir('.sites-runtime', { recursive: true });
// Build the JSX frontend independently; never include Worker code or secrets in it.
const client = await build({ entryPoints: ['src/main.tsx'], outfile: 'app.js', bundle: true, format: 'iife', platform: 'browser',
  target: 'es2022', jsx: 'automatic', minify: true, write: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
const validationWorker = await build({ entryPoints: ['src/validation-worker.ts'], outfile: 'validation-worker.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false });
await walk('public');
assets['/validation-worker.js'] = validationWorker.outputFiles[0].text;
assets['/app.js'] = client.outputFiles.find(file => file.path.endsWith('app.js'))!.text;
await writeFile('.sites-runtime/assets.js', `export default ${JSON.stringify(assets)};`);
await writeFile('.sites-runtime/assets.d.ts', 'declare const assets: Record<string, string>;\nexport default assets;\n');
await rm('dist', { recursive: true, force: true });
await build({ entryPoints: ['worker/index.ts'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, conditions: ['worker', 'browser'], logLevel: 'info' });
await import('./verify-build.ts');
