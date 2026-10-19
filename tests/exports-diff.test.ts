import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpecNode } from '../shared/types.ts';
import { exportFile, offlineHtml } from '../src/lib/export.ts';
import { buildDiffRows, summarizeSpecChanges } from '../src/lib/diff.ts';
import { changelogMarkdown } from '../src/lib/changelog.ts';
import { parseDefinition } from '../shared/openapi.ts';
import { transformSync } from 'esbuild';
test('downloads preserve original comments and JSON data; filenames cannot inject paths', () => {
  const source = '# 原始備註\nopenapi: 3.0.3\ninfo: {title: 測試, version: 1.0.0}\npaths: {}\n';
  const preview = { source, spec: parseDefinition(source), fileName: '../private.yaml' };
  assert.equal(exportFile(preview, 'source').content, source);
  assert.deepEqual(JSON.parse(exportFile(preview, 'json').content), preview.spec);
  assert.ok(!exportFile(preview, 'source').name.includes('/'));
  assert.match(exportFile(preview, 'html').name, /\.html$/);
});
test('offline HTML is standalone, escapes arbitrary spec data and retains refs and models', () => {
  const spec: SpecNode = { openapi: '3.1.0', info: { title: '<script>alert(1)</script>', version: '1', description: '<img src="https://evil.test/x" onerror="alert(1)">' }, paths: { '/pets': { get: { summary: '列出', responses: { 200: { description: 'ok', $ref: 'https://example.test/ref.json' } } } } }, components: { schemas: { Pet: { type: 'object' } } } };
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
test('Markdown changelog groups changes by risk and cannot inject markup from spec labels', () => {
  const before: SpecNode = { openapi: '3.0.3', info: { title: 'Pets', version: '1' }, paths: { '/pets': { get: { responses: { 200: { description: 'ok' } } } }, '/old': { get: { responses: { 200: { description: 'ok' } } } } } };
  const after = structuredClone(before); delete after.paths['/old']; after.paths['/<img src=x>'] = { post: { responses: { 201: { description: 'ok' } } } }; after.info.version = '2';
  const markdown = changelogMarkdown({ title: 'Pets *API*', from: 1, to: 2, summary: summarizeSpecChanges(before, after) });
  assert.match(markdown, /^# Pets \\\*API\\\* 變更紀錄/);
  assert.match(markdown, /v1 → v2 · 3 項變更/);
  assert.ok(markdown.indexOf('## 可能不相容（1）') < markdown.indexOf('## 一般變更（2）'));
  assert.match(markdown, /- \*\*移除\*\* GET \/old/);
  assert.ok(markdown.includes('\\<img') && !/(^|[^\\])<img/.test(markdown));
  assert.match(changelogMarkdown({ title: 'x', from: 1, to: 1, summary: summarizeSpecChanges(before, before) }), /未發現/);
});
test('TypeScript export renders named schemas, operations and Swagger 2 definitions as valid declarations', () => {
  const spec: SpecNode = { openapi: '3.1.0', info: { title: 'Pets */ evil', version: '1' }, paths: {
    '/pets/{id}': { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], get: { summary: 'Read */ pet', parameters: [{ in: 'query', name: 'fields-list', schema: { type: 'array', items: { enum: ['a', 'b'] } } }], responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } }, 204: { description: 'none' } } } },
    '/pets': { post: { requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/new-pet' } } } }, responses: { '2XX': { description: 'ok' } } } },
  }, components: { schemas: {
    Pet: { type: 'object', required: ['id'], properties: { id: { type: 'integer', readOnly: true }, name: { type: ['string', 'null'] }, next: { $ref: '#/components/schemas/Pet' }, 'x-y': { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] } }, additionalProperties: { type: 'string' } },
    'new-pet': { allOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'object', properties: { tag: { const: 'new' } } }] },
    newPet: { type: 'string', nullable: true },
  } } };
  const output = exportFile({ spec, fileName: 'pets.yaml' }, 'typescript');
  assert.equal(output.name, 'pets.d.ts');
  assert.doesNotThrow(() => transformSync(output.content, { loader: 'ts' }));
  assert.match(output.content, /export type Pet = \{/);
  assert.match(output.content, /readonly id: number;/);
  assert.match(output.content, /name\?: string \| null;/);
  assert.match(output.content, /next\?: Pet;/);
  assert.match(output.content, /"x-y"\?: string \| number\[\];/);
  assert.match(output.content, /export type NewPet = Pet & \{/);
  assert.match(output.content, /export type NewPet2 = string \| null;/);
  assert.match(output.content, /path: \{\n\s+id: number;/);
  assert.match(output.content, /"fields-list"\?: \("a" \| "b"\)\[\];/);
  assert.match(output.content, /requestBody: NewPet;/);
  assert.match(output.content, /204: void;/);
  assert.ok(output.content.includes('Read *\\/ pet') && !output.content.includes('Read */'));
  const legacy: SpecNode = { swagger: '2.0', info: { title: 'Legacy', version: '1' }, paths: { '/x': { post: { parameters: [{ in: 'body', name: 'body', required: true, schema: { $ref: '#/definitions/X' } }], responses: { 200: { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/X' } } } } } } }, definitions: { X: { type: 'object', properties: { a: { type: 'string' } } } } };
  const legacyOutput = exportFile({ spec: legacy }, 'typescript').content;
  assert.doesNotThrow(() => transformSync(legacyOutput, { loader: 'ts' }));
  assert.match(legacyOutput, /requestBody: X;/);
  assert.match(legacyOutput, /200: X\[\];/);
});
test('TypeScript export never shadows the Record type it emits', () => {
  const output = exportFile({ spec: { openapi: '3.0.3', info: { title: 'x', version: '1' }, paths: {}, components: { schemas: { Record: { type: 'object', properties: { a: { type: 'object' } } } } } } }, 'typescript').content;
  assert.match(output, /export type Record2 = \{\n  a\?: Record<string, unknown>;/);
  assert.doesNotMatch(output, /export type Record =/);
});
