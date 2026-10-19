import { resolve, stable, METHODS } from './spec-tools.js';
export class MockError extends Error { constructor(message, status = 422) { super(message); this.status = status; } }
const own = (o, k) => o && Object.hasOwn(o, k);
export const jsonMedia = media => media === 'application/json' || /^application\/[^;]+\+json$/.test(media);
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
  if (type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties || {}).slice(0, 100).filter(([, s]) => { let p; try { p = resolve(spec, s); } catch { p = s; } return !(state.request ? p?.readOnly : p?.writeOnly); }).map(([k, s]) => [k, sampleSchema(spec, s, state, depth + 1)]));
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
function findOperation(spec, method, path) {
  const segments = path.split('/').map(s => decodeURIComponent(s));
  const candidates = Object.entries(spec.paths || {}).filter(([p]) => {
    const a = p.split('/');
    return a.length === segments.length && a.every((s, i) => /^\{[^{}]+\}$/.test(s) ? segments[i].length > 0 : s === segments[i]);
  }).sort(([a], [b]) => (a.match(/\{/g)?.length || 0) - (b.match(/\{/g)?.length || 0));
  if (!candidates.length) throw new MockError('找不到此 Mock 路徑。', 404);
  const [template, raw] = candidates[0], item = resolve(spec, raw);
  const op = item?.[method.toLowerCase()] || (method === 'HEAD' ? item?.get : null);
  if (!op || !METHODS.includes(method.toLowerCase())) throw new MockError('此路徑未定義該 HTTP 方法。', 405);
  const values = Object.fromEntries(template.split('/').flatMap((s, i) => /^\{[^{}]+\}$/.test(s) ? [[s.slice(1, -1), segments[i]]] : []));
  return { item, op, values };
}
export function parameters(spec, item, op) {
  const merged = new Map();
  for (const value of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
    let p; try { p = resolve(spec, value); } catch { continue; }
    if (p?.name && p.in) merged.set(`${p.in}:${p.name}`, p);
  }
  return [...merged.values()];
}
const mediaType = value => String(value).split(';')[0].trim().toLowerCase();
export function requestBody(spec, op, params) {
  const body = params.find(p => p.in === 'body');
  if (body) {
    const consumes = Array.isArray(op.consumes) ? op.consumes : Array.isArray(spec.consumes) ? spec.consumes : ['application/json'];
    return { required: body.required === true, content: Object.fromEntries(consumes.map(media => [mediaType(media), body.schema])) };
  }
  if (!op.requestBody) return null;
  const definition = resolve(spec, op.requestBody) || {};
  return { required: definition.required === true, content: Object.fromEntries(Object.entries(definition.content || {}).map(([media, value]) => [mediaType(media), value?.schema])) };
}
export function mockResponse(spec, method, path, statusChoice, exampleChoice) {
  try {
    const { op } = findOperation(spec, method, path);
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

// Bounded structural checks. Formats and patterns are not evaluated: spec-supplied regexes could stall the Worker.
function checkValue(spec, schema, value, at, report, state, depth = 0) {
  if (++state.nodes > 5000 || depth > 12) return;
  if (schema === false) { report(at, '不允許任何值。'); return; }
  try { schema = resolve(spec, schema); } catch { return; }
  if (!schema || typeof schema !== 'object') return;
  for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) checkValue(spec, part, value, at, report, state, depth + 1);
  for (const key of ['oneOf', 'anyOf']) if (Array.isArray(schema[key]) && schema[key].length && !schema[key].some(option => {
    let failed = false; checkValue(spec, option, value, at, () => { failed = true; }, state, depth + 1); return !failed;
  })) report(at, `不符合 ${key} 中任何一個 Schema。`);
  if (own(schema, 'const') && stable(schema.const) !== stable(value)) report(at, `必須等於 ${JSON.stringify(schema.const)}。`);
  if (Array.isArray(schema.enum) && !schema.enum.some(option => stable(option) === stable(value))) report(at, `必須是 ${schema.enum.slice(0, 10).map(v => JSON.stringify(v)).join('、')} 其中之一。`);
  const types = Array.isArray(schema.type) ? [...schema.type] : schema.type ? [schema.type] : [];
  if (types.length && schema.nullable === true) types.push('null');
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (types.length && !types.some(t => t === actual || (t === 'number' && actual === 'integer'))) { report(at, `型別應為 ${types.join(' 或 ')}。`); return; }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0)) report(at, `長度至少 ${schema.minLength}。`);
    if (schema.maxLength !== undefined && length > schema.maxLength) report(at, `長度最多 ${schema.maxLength}。`);
  }
  if (typeof value === 'number') {
    const exclusiveMin = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : schema.exclusiveMinimum === true ? schema.minimum : undefined;
    const exclusiveMax = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : schema.exclusiveMaximum === true ? schema.maximum : undefined;
    if (exclusiveMin !== undefined ? value <= exclusiveMin : schema.minimum !== undefined && value < schema.minimum) report(at, `必須${exclusiveMin !== undefined ? '大於' : '大於或等於'} ${exclusiveMin ?? schema.minimum}。`);
    if (exclusiveMax !== undefined ? value >= exclusiveMax : schema.maximum !== undefined && value > schema.maximum) report(at, `必須${exclusiveMax !== undefined ? '小於' : '小於或等於'} ${exclusiveMax ?? schema.maximum}。`);
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0)) report(at, `至少需要 ${schema.minItems} 個項目。`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) report(at, `最多 ${schema.maxItems} 個項目。`);
    if (schema.items) value.slice(0, 100).forEach((item, i) => checkValue(spec, schema.items, item, `${at}[${i}]`, report, state, depth + 1));
  }
  if (actual === 'object') {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      let property; try { property = resolve(spec, properties[name]); } catch { property = null; }
      if (!own(value, name) && !property?.readOnly) report(`${at}.${name}`, '缺少必要欄位。');
    }
    for (const [name, item] of Object.entries(value).slice(0, 200)) {
      if (own(properties, name)) checkValue(spec, properties[name], item, `${at}.${name}`, report, state, depth + 1);
      else if (schema.additionalProperties === false) report(`${at}.${name}`, '不允許額外欄位。');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') checkValue(spec, schema.additionalProperties, item, `${at}.${name}`, report, state, depth + 1);
    }
  }
}
function coerce(spec, schema, raw) {
  let target; try { target = resolve(spec, schema) || {}; } catch { return raw; }
  const type = Array.isArray(target.type) ? target.type.find(t => t !== 'null') : target.type;
  if (type === 'integer' && /^-?\d+$/.test(raw)) return Number(raw);
  if (type === 'number' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  if (type === 'boolean' && ['true', 'false'].includes(raw)) return raw === 'true';
  return raw;
}
export function validateMockRequest(spec, method, path, { query = new URLSearchParams(), headers = new Headers(), body = '' } = {}) {
  try {
    const { item, op, values } = findOperation(spec, method, path);
    const params = parameters(spec, item, op), issues = [], state = { nodes: 0 };
    const report = (at, message) => { if (issues.length < 20) issues.push({ at, message }); };
    for (const p of params) {
      if (!['path', 'query', 'header'].includes(p.in)) continue;
      const raw = p.in === 'path' ? [values[p.name]].filter(v => v !== undefined) : p.in === 'query' ? query.getAll(p.name) : [headers.get(p.name)].filter(v => v !== null);
      const at = `${p.in}.${p.name}`;
      let target; try { target = resolve(spec, p.schema || p) || {}; } catch { continue; }
      // Object and content-encoded parameters can be serialized across several keys (deepObject, exploded form).
      if (p.content || target.type === 'object' || (Array.isArray(target.type) && target.type.includes('object')) || (!target.type && target.properties)) continue;
      if (!raw.length) { if (p.required) report(at, '缺少必要參數。'); continue; }
      const isArray = target.type === 'array' || (Array.isArray(target.type) && target.type.includes('array'));
      const value = isArray ? (raw.length === 1 ? raw[0].split(',') : raw).map(v => coerce(spec, target.items, v)) : coerce(spec, target, raw[0]);
      checkValue(spec, target, value, at, report, state);
    }
    const definition = requestBody(spec, op, params);
    if (definition) {
      const media = mediaType(headers.get('content-type') || ''), medias = Object.keys(definition.content);
      const accepted = !media || !medias.length || medias.some(m => m === media || m === '*/*' || (m.endsWith('/*') && media.startsWith(m.slice(0, -1))));
      const jsonKey = medias.find(jsonMedia);
      if (!body.trim()) { if (definition.required) report('body', '缺少必要的 Request Body。'); }
      else if (!accepted) report('body', `不支援的 Content-Type：${media}`);
      else if (jsonKey && definition.content[jsonKey] && (!media || jsonMedia(media))) {
        let value, parsed = true; try { value = JSON.parse(body); } catch { parsed = false; }
        if (!parsed) report('body', 'Request Body 不是有效的 JSON。');
        else checkValue(spec, definition.content[jsonKey], value, 'body', report, state);
      }
    }
    return issues;
  } catch (error) { if (error instanceof MockError) throw error; throw new MockError(error.message); }
}
export function mockControls(params) {
  const number = (name, min, max, fallback) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) throw new MockError(`${name} 必須介於 ${min} 到 ${max}。`, 400);
    return value;
  };
  const validate = params.get('__validate');
  if (validate !== null && !['on', 'off'].includes(validate)) throw new MockError('__validate 只接受 on 或 off。', 400);
  const failStatus = number('__failStatus', 400, 599, 500);
  if (!Number.isInteger(failStatus)) throw new MockError('__failStatus 必須是整數狀態碼。', 400);
  return { status: params.get('__status'), example: params.get('__example'), validate: validate !== 'off', delay: Math.round(number('__delay', 0, 5000, 0)), failRate: number('__fail', 0, 1, 0), failStatus };
}
export function sampleRequest(spec, method, template) {
  let item, params = [];
  try { item = resolve(spec, spec.paths?.[template]); params = parameters(spec, item, item[method]); } catch { return { path: template.replace(/\{[^{}]+\}/g, '1'), body: '' }; }
  const sample = schema => { try { return sampleSchema(spec, schema, { nodes: 0, request: true }); } catch { return undefined; } };
  const path = template.split('/').map(segment => {
    const name = /^\{([^{}]+)\}$/.exec(segment)?.[1];
    if (!name) return encodeURIComponent(segment);
    const p = params.find(q => q.in === 'path' && q.name === name), value = p ? sample(p.schema || p) : undefined;
    return encodeURIComponent(['string', 'number', 'boolean'].includes(typeof value) && String(value) ? String(value) : '1');
  }).join('/');
  let definition; try { definition = requestBody(spec, item[method], params); } catch { definition = null; }
  const jsonKey = definition && Object.keys(definition.content).find(jsonMedia), value = jsonKey && definition.content[jsonKey] ? sample(definition.content[jsonKey]) : undefined;
  return { path, body: value === undefined ? '' : JSON.stringify(value, null, 2) };
}
