import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSource, convertSource, completionFor } from '../src/lib/editor.js';
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
  const complete = doc => completionFor(new CompletionContext(EditorState.create({ doc }), doc.length, true));
  assert.ok(complete('  res').options.some(x => x.label === 'responses'));
  assert.equal(complete('title: res'), null);
  assert.equal(complete('# res'), null);
  assert.equal(complete('  "res'), null);
});
