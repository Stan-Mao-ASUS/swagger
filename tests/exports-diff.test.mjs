import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFile, offlineHtml } from '../src/lib/export.js';
import { buildDiffRows, summarizeSpecChanges } from '../src/lib/diff.js';
import { parseDefinition } from '../shared/openapi.js';
test('downloads preserve original comments and JSON data; filenames cannot inject paths', () => {
  const source = '# 原始備註\nopenapi: 3.0.3\ninfo: {title: 測試, version: 1.0.0}\npaths: {}\n';
  const preview = { source, spec: parseDefinition(source), fileName: '../private.yaml' };
  assert.equal(exportFile(preview, 'source').content, source);
  assert.deepEqual(JSON.parse(exportFile(preview, 'json').content), preview.spec);
  assert.ok(!exportFile(preview, 'source').name.includes('/'));
  assert.match(exportFile(preview, 'html').name, /\.html$/);
});
test('offline HTML is standalone, escapes arbitrary spec data and retains refs and models', () => {
  const spec = { openapi: '3.1.0', info: { title: '<script>alert(1)</script>', version: '1', description: '<img src="https://evil.test/x" onerror="alert(1)">' }, paths: { '/pets': { get: { summary: '列出', responses: { 200: { description: 'ok', $ref: 'https://example.test/ref.json' } } } } }, components: { schemas: { Pet: { type: 'object' } } } };
  const html = offlineHtml(spec);
  assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('<link')); assert.doesNotMatch(html, /<[^>]+\ssrc=/i);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('https://example.test/ref.json')); assert.ok(html.includes('Pet')); assert.ok(html.includes('GET')); assert.ok(html.includes('/pets'));
  assert.match(html, /Content-Security-Policy/);
  assert.equal((html.match(/<article /g) || []).length, 1);
});
test('version diff marks additions and removals, collapses unchanged runs, bounds expensive input', () => {
  const rows = buildDiffRows('a\nb\nc\n', 'a\nchanged\nc\n');
  assert.ok(rows.some(r => r.type === 'removed' && r.text === 'b'));
  assert.ok(rows.some(r => r.type === 'added' && r.text === 'changed'));
  assert.ok(buildDiffRows('x\n'.repeat(30), 'x\n'.repeat(30)).some(r => r.type === 'collapsed'));
  assert.throws(() => buildDiffRows('x'.repeat(800001), ''), /文件較大/);
  const summary = summarizeSpecChanges({ paths: { '/pets': { get: {} } } }, { paths: { '/pets': { post: {} } } });
  assert.deepEqual(summary.changes.map(c => c.type), ['added', 'removed']);
});
