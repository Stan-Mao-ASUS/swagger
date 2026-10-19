import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';
import { operationsOf, requestSnippets } from '../src/lib/snippets.ts';
import type { SpecNode } from '../shared/types.ts';

const spec: SpecNode = { openapi: '3.0.3', info: { title: 'Snippets', version: '1' },
  servers: [{ url: 'https://{region}.api.example.test/v1', variables: { region: { default: 'eu' } } }],
  security: [{ bearer: [] }],
  paths: {
    '/orders/{orderId}': { parameters: [{ in: 'path', name: 'orderId', required: true, schema: { type: 'integer', example: 7 } }], get: { parameters: [{ in: 'query', name: 'expand', required: true, schema: { type: 'string', enum: ['lines'] } }, { in: 'query', name: 'optional', schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } } },
    '/orders': { post: { security: [{ key: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string', example: "it's \"quoted\"" }, ok: { type: 'boolean' }, id: { type: 'integer', readOnly: true } } } } } }, responses: { 201: { description: 'created' } } } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } } } };

test('request snippets fill in server variables, required parameters, credentials and sample bodies', () => {
  const ops = operationsOf(spec);
  assert.deepEqual(ops.map(op => op.label), ['GET /orders/{orderId}', 'POST /orders']);
  const get = requestSnippets(spec, ops[0]!, 'https://workbench.test');
  assert.equal(get.url, 'https://eu.api.example.test/v1/orders/7?expand=lines');
  assert.match(get.curl, /-H 'Authorization: Bearer <TOKEN>'/);
  assert.ok(!get.curl.includes('optional'), 'only required parameters are filled in');
  const post = requestSnippets(spec, ops[1]!, 'https://workbench.test');
  assert.match(post.curl, /-H 'X-Api-Key: <API_KEY>'/);
  assert.ok(!post.javascript.includes('"id"'), 'readOnly fields are left out of request bodies');
  assert.match(post.python, /"ok": True/);
  for (const snippet of [get, post]) {
    assert.doesNotThrow(() => transformSync(snippet.javascript, { loader: 'js', format: 'esm' }));
    execFileSync('bash', ['-n', '-c', snippet.curl]);
  }
  let python = true; try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { python = false; }
  if (python) for (const snippet of [get, post]) execFileSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: snippet.python });
});

test('Swagger 2 snippets use host, basePath and schemes, and relative OpenAPI servers resolve against the page', () => {
  const legacy: SpecNode = { swagger: '2.0', info: { title: 'L', version: '1' }, host: 'legacy.example.test', basePath: '/api', schemes: ['http'], paths: { '/x': { get: { responses: { 200: { description: 'ok' } } } } } };
  assert.equal(requestSnippets(legacy, operationsOf(legacy)[0]!, 'https://workbench.test').url, 'http://legacy.example.test/api/x');
  const relative: SpecNode = { openapi: '3.1.0', info: { title: 'R', version: '1' }, servers: [{ url: '/v2' }], paths: { '/y': { delete: { responses: { 204: { description: 'gone' } } } } } };
  const snippet = requestSnippets(relative, operationsOf(relative)[0]!, 'https://workbench.test');
  assert.equal(snippet.url, 'https://workbench.test/v2/y');
  assert.match(snippet.curl, /^curl -X DELETE/);
});
