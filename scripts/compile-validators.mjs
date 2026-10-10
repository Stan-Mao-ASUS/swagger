import Ajv2020 from 'ajv/dist/2020.js';
import Ajv04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
// Compile trusted OpenAPI schemas at build time. Workers never run eval/new Function.
await mkdir('.sites-runtime/validation', { recursive: true });
for (const [name, version, Ajv] of [['swagger2','2.0',Ajv04],['openapi30','3.0',Ajv04],['openapi31','3.1',Ajv2020]]) {
  const schema = JSON.parse(await readFile(`node_modules/@seriousme/openapi-schema-validator/schemas/v${version}/schema.json`, 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true, code: { source: true }, unicodeRegExp: false });
  addFormats(ajv); ajv.addFormat('media-range', true);
  const validate = ajv.compile(schema);
  await writeFile(`.sites-runtime/validation/${name}.cjs`, standalone(ajv, validate));
}
const metaAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false, code: { source: true } });
await writeFile('.sites-runtime/validation/jsonSchema2020.cjs', standalone(metaAjv, metaAjv.getSchema('https://json-schema.org/draft/2020-12/schema')));
await build({ stdin: { contents: "export {default as jsonSchema2020} from './jsonSchema2020.cjs';export {default as swagger2} from './swagger2.cjs';export {default as openapi30} from './openapi30.cjs';export {default as openapi31} from './openapi31.cjs';", resolveDir: process.cwd() + '/.sites-runtime/validation' }, outfile: '.sites-runtime/validators.js', bundle: true, format: 'esm', platform: 'browser', minify: true });
