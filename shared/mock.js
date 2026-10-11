import { resolve, METHODS } from './spec-tools.js';
export class MockError extends Error { constructor(message, status = 422) { super(message); this.status = status; } }
const own = (o, k) => o && Object.hasOwn(o, k);
// Bounded illustrative samples, not a JSON Schema solver. No external resources or executable templates.
export function sampleSchema(spec, schema, state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > 1000 || depth > 12) throw new MockError('Schema 太深或包含循環；請提供明確 example。');
  if (schema === false) throw new MockError('此 Schema 不允許任何值。');
  schema = resolve(spec, schema) || {};
  for (const key of ['example', 'const', 'default']) if (own(schema, key)) return schema[key];
  if (schema.examples?.length) return schema.examples[0];
  if (schema.enum?.length) return schema.enum[0];
  if (schema.oneOf?.length || schema.anyOf?.length) return sampleSchema(spec, (schema.oneOf || schema.anyOf)[0], state, depth + 1);
  if (schema.allOf?.length) {
    const parts = schema.allOf.map(s => sampleSchema(spec, s, state, depth + 1));
    if (parts.every(p => p && typeof p === 'object' && !Array.isArray(p))) return Object.assign(Object.create(null), ...parts);
    throw new MockError('複合 Schema 需要明確 example。');
  }
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') || 'null' : schema.type;
  if (type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties || {}).slice(0, 100).filter(([, s]) => !s?.writeOnly).map(([k, s]) => [k, sampleSchema(spec, s, state, depth + 1)]));
  if (type === 'array' || schema.items) {
    const count = Math.min(5, Math.max(0, schema.minItems ?? Math.min(1, schema.maxItems ?? 1)));
    return Array.from({ length: count }, () => sampleSchema(spec, schema.items || {}, state, depth + 1));
  }
  if (type === 'integer' || type === 'number') return schema.minimum ?? (typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : schema.maximum !== undefined ? Math.min(0, schema.maximum) : 0);
  if (type === 'boolean') return true;
  if (type === 'null') return null;
  if (schema.format === 'date') return '2026-01-01';
  if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
  if (schema.format === 'email') return 'user@example.test';
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (schema.format === 'uri') return 'https://example.test';
  return 'sample'.padEnd(Math.min(200, schema.minLength || 0), 'x').slice(0, schema.maxLength ?? 200);
}
export function mockResponse(spec, method, path, statusChoice, exampleChoice) {
  try {
    const candidates = Object.entries(spec.paths || {}).filter(([p]) => {
      const a = p.split('/'), b = path.split('/').map(s => decodeURIComponent(s));
      return a.length === b.length && a.every((s, i) => /^\{[^{}]+\}$/.test(s) ? b[i].length > 0 : s === b[i]);
    }).sort(([a], [b]) => (a.match(/\{/g)?.length || 0) - (b.match(/\{/g)?.length || 0));
    if (!candidates.length) throw new MockError('找不到此 Mock 路徑。', 404);
    const item = resolve(spec, candidates[0][1]);
    const op = item?.[method.toLowerCase()] || (method === 'HEAD' ? item?.get : null);
    if (!op || !METHODS.includes(method.toLowerCase())) throw new MockError('此路徑未定義該 HTTP 方法。', 405);
    const responses = op.responses || {};
    let key = statusChoice || Object.keys(responses).filter(k => /^2\d\d$/.test(k)).sort()[0] || Object.keys(responses).filter(k => /^[2-5]\d\d$/.test(k)).sort()[0] || (responses['2XX'] ? '200' : responses.default ? '200' : '');
    if (!/^[2-5]\d\d$/.test(key)) throw new MockError('請指定 200–599 的回應狀態碼。', 400);
    const raw = responses[key] || responses[key[0] + 'XX'] || responses.default;
    if (!raw) throw new MockError('規格未定義此回應狀態碼。', 400);
    const response = resolve(spec, raw), status = Number(key);
    if ([204, 205, 304].includes(status)) return { status, body: null, contentType: 'application/json', source: 'empty' };
    const content = response.content || {};
    const media = Object.keys(content).find(k => k === 'application/json') || Object.keys(content).find(k => /^application\/[^;]+\+json$/.test(k)) || (content['text/plain'] ? 'text/plain' : null);
    if (Object.keys(content).length && !media) throw new MockError('目前支援 JSON 與 text/plain；其他媒體格式請另設測試服務。');
    const definition = content[media] || response;
    let body, source = 'schema';
    if (exampleChoice) {
      const example = definition.examples?.[exampleChoice];
      if (!example) throw new MockError('找不到指定的 example。', 400);
      const resolved = resolve(spec, example);
      if (!own(resolved, 'value')) throw new MockError('外部 example 不會自動下載。');
      body = resolved.value; source = 'example';
    } else if (own(definition, 'example')) { body = definition.example; source = 'example'; }
    else if (!spec.swagger && definition.examples && Object.keys(definition.examples).length) {
      const example = resolve(spec, Object.values(definition.examples)[0]);
      if (!own(example, 'value')) throw new MockError('外部 example 不會自動下載。');
      body = example.value; source = 'example';
    } else if (spec.swagger && response.examples && Object.keys(response.examples).length) {
      body = response.examples['application/json'] ?? Object.values(response.examples)[0]; source = 'example';
    } else if (definition.schema) body = sampleSchema(spec, definition.schema);
    else return { status, body: null, contentType: 'application/json', source: 'empty' };
    const contentType = media === 'text/plain' ? 'text/plain' : 'application/json';
    body = contentType === 'text/plain' && typeof body === 'string' ? body : JSON.stringify(body);
    if (new TextEncoder().encode(body).length > 256 * 1024) throw new MockError('Mock 回應超過 256 KB，請縮小 example。');
    return { status, body, contentType, source };
  } catch (error) { if (error instanceof MockError) throw error; throw new MockError(error.message); }
}
