import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpecNode } from '../shared/types.ts';
import { convertSource, completionFor } from '../src/lib/editor.ts';
import { analyzeSource } from '../src/lib/analyze-source.ts';
import { lintSpec, STYLE_RULES } from '../src/lib/lint.ts';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
const source = '# keep original\nopenapi: 3.0.3\ninfo:\n  title: Editor test\n  version: "1.0"\npaths: {}\n';
test('editor conversion retains API meaning in both directions', () => {
  const json = convertSource(source, 'json');
  assert.deepEqual(analyzeSource(convertSource(json, 'yaml')).spec, analyzeSource(source).spec);
  assert.equal(analyzeSource(json).diagnostics.length, 0);
});
test('syntax errors expose a useful line and column and no preview', () => {
  const invalid = source + 'broken: [\n';
  const result = analyzeSource(invalid);
  assert.equal(result.spec, null);
  assert.ok(result.diagnostics[0].line >= 7);
  assert.ok(result.diagnostics[0].column >= 1);
  assert.throws(() => convertSource(invalid, 'json'));
});
test('essential field validation and alias limits remain enabled during live editing', () => {
  assert.equal(analyzeSource('openapi: 3.0.3\npaths: {}').spec, null);
  assert.equal(analyzeSource(source + 'x-loop: &loop [*loop]').spec, null);
});
test('completion suggests YAML keys but not values or comments', () => {
  const complete = (doc: string) => completionFor(new CompletionContext(EditorState.create({ doc }), doc.length, true));
  assert.ok(complete('  res')?.options.some(x => x.label === 'responses'));
  assert.equal(complete('title: res'), null);
  assert.equal(complete('# res'), null);
  assert.equal(complete('  "res'), null);
});
import { validateSpec } from '../shared/validation.ts';
const valid = (): SpecNode => ({ openapi: '3.0.3', info: { title: 'Validation', version: '1' }, paths: { '/pets/{id}': { get: { operationId: 'getPet', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } } } });
test('OpenAPI schema errors and semantic issues carry source positions', () => {
  const spec = valid(); spec.paths['/pets/{id}'].get.responses = {};
  assert.ok(validateSpec(spec).some(d => d.path.includes('responses')));
  const doc = valid(); doc.paths['/other'] = { get: { operationId: 'getPet', responses: { '200': { description: 'ok' } } } };
  const result = analyzeSource(JSON.stringify(doc, null, 2));
  assert.equal(result.spec, null);
  assert.ok(result.diagnostics.some(d => d.message.includes('operationId') && d.line > 1));
});
test('references, path parameters, duplicate templates and security names are checked', () => {
  const spec = valid();
  spec.paths['/pets/{id}'].get.parameters = [{ name: 'other', in: 'path', required: false, schema: { type: 'string' } }];
  spec.paths['/pets/{id}'].get.security = [{ missing: [] }];
  spec.paths['/pets/{name}'] = { get: { responses: { '200': { $ref: '#/components/responses/Missing' } } } };
  const messages = validateSpec(spec).map(d => d.message).join('\n');
  for (const text of ['未宣告','不在路徑','required: true','找不到參照','路徑模板','security scheme']) assert.ok(messages.includes(text), text);
});
test('ordinary recursive local refs, escaped pointers and example payloads remain valid', () => {
  const spec = valid(); spec.components = { schemas: { 'A/B': { type: 'object', properties: { next: { $ref: '#/components/schemas/A~1B' } }, example: { $ref: 'not-a-real-reference' } } } };
  assert.deepEqual(validateSpec(spec), []);
  spec.components.schemas['A/B'].properties.next.$ref = 'https://example.test/schema.json';
  const issues = validateSpec(spec); assert.equal(issues.length, 1); assert.equal(issues[0].severity, 'warning');
});
test('Swagger 2 and OpenAPI 3.1 schemas are validated, including 2020-12 schema objects', () => {
  assert.deepEqual(validateSpec({ swagger: '2.0', info: { title: 'API', version: '1' }, paths: {} }), []);
  const spec: SpecNode = { openapi: '3.1.1', info: { title: 'API', version: '1' }, components: { schemas: { Pet: { type: ['string','null'] } } } };
  assert.deepEqual(validateSpec(spec), []);
  spec.components.schemas.Pet.type = 'invalid-type';
  assert.ok(validateSpec(spec).some(d => d.path.includes('Pet/type')));
});
test('a large set of external-reference warnings cannot hide later semantic errors', () => {
  const spec = valid();
  spec.components = { schemas: Object.fromEntries(Array.from({ length: 110 }, (_,i) => ['S'+i, { $ref: 'https://example.test/'+i }])) };
  spec.paths['/pets/{id}'].get.parameters = [];
  assert.ok(validateSpec(spec).some(d => d.severity === 'error' && d.message.includes('未宣告')));
});
test('style rules suggest without blocking, carry source positions and stay separate from validation', () => {
  const source = 'openapi: 3.0.3\ninfo:\n  title: Style\n  version: 1.0.0\ntags:\n  - name: pets\npaths:\n  /Pets/:\n    get:\n      operationId: List_Pets\n      tags: [pets, unknown]\n      responses:\n        "404":\n          description: missing\n';
  const result = analyzeSource(source);
  assert.ok(result.spec, 'style issues never hide the preview');
  assert.equal(result.diagnostics.length, 0);
  const rules = new Set(result.style.map(issue => issue.rule));
  for (const rule of ['info-description', 'operation-id-camel-case', 'operation-summary', 'tag-declared', 'success-response', 'path-kebab-case', 'path-trailing-slash']) assert.ok(rules.has(rule), rule);
  assert.ok(!rules.has('operation-id') && !rules.has('operation-tags'));
  assert.ok(result.style.every(issue => issue.severity === 'info' && STYLE_RULES.some(rule => rule.id === issue.rule)));
  assert.equal(result.style.find(issue => issue.rule === 'operation-id-camel-case')?.line, 10);
  assert.equal(result.style.find(issue => issue.rule === 'tag-declared')?.line, 11);
  const many: SpecNode = { openapi: '3.0.3', info: { title: 'x', version: '1', description: 'd' }, paths: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`/p${i}`, { get: { responses: { 200: { description: 'ok' } } } }])) };
  assert.equal(lintSpec(many).filter(issue => issue.rule === 'operation-id').length, 25);
});
test('disabled style rules are skipped by the analyzer', () => {
  const source = 'openapi: 3.0.3\ninfo:\n  title: Off\n  version: 1.0.0\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: ok\n';
  const all = new Set(analyzeSource(source).style.map(issue => issue.rule));
  assert.ok(all.has('operation-id') && all.has('operation-summary'));
  const some = new Set(analyzeSource(source, ['operation-id']).style.map(issue => issue.rule));
  assert.ok(!some.has('operation-id') && some.has('operation-summary'));
  assert.deepEqual(analyzeSource(source, STYLE_RULES.map(rule => rule.id)).style, []);
});
