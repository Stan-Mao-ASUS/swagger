import { METHODS } from '../../shared/spec-tools.js';
import { resolveLocal } from '../../shared/validation.js';
import { jsonMedia, parameters, requestBody } from '../../shared/mock.js';
const identifier = /^[A-Za-z_$][\w$]*$/;
const key = name => identifier.test(name) || /^(0|[1-9]\d{0,8})$/.test(name) ? name : JSON.stringify(name);
const literal = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ? JSON.stringify(value) : 'unknown';
const doc = (text, indent) => typeof text === 'string' && text.trim() ? `${indent}/** ${text.replace(/\s+/g, ' ').replace(/\*\//g, '*\\/').slice(0, 300)} */\n` : '';
const union = types => [...new Set(types)].join(' | ') || 'never';
const wrap = type => /[|&]/.test(type) ? `(${type})` : type;
const scalars = { string: 'string', integer: 'number', number: 'number', boolean: 'boolean', null: 'null' };

export function typescriptDefinitions(spec) {
  const schemas = spec.components?.schemas || spec.definitions || {}, prefix = spec.components ? '#/components/schemas/' : '#/definitions/';
  const names = new Map(), used = new Set(['paths', 'Record']);
  for (const name of Object.keys(schemas)) {
    let base = name.replace(/[^\w$]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^./, c => c.toUpperCase()) || 'Schema';
    if (/^\d/.test(base)) base = '_' + base;
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = base + n;
    used.add(candidate); names.set(prefix + name.replaceAll('~', '~0').replaceAll('/', '~1'), candidate);
  }
  let nodes = 0;
  function render(schema, indent = '', depth = 0, refs = new Set()) {
    if (++nodes > 200000) throw new Error('規格過於複雜，無法產生 TypeScript 型別。');
    if (schema === false) return 'never';
    if (!schema || typeof schema !== 'object' || depth > 12) return 'unknown';
    if (typeof schema.$ref === 'string') {
      if (names.has(schema.$ref)) return names.get(schema.$ref);
      const target = refs.has(schema.$ref) ? undefined : resolveLocal(spec, schema.$ref);
      return target === undefined ? 'unknown' : render(target, indent, depth + 1, new Set([...refs, schema.$ref]));
    }
    const next = value => render(value, indent, depth + 1, refs);
    let type;
    if (Object.hasOwn(schema, 'const')) type = literal(schema.const);
    else if (Array.isArray(schema.enum) && schema.enum.length) type = union(schema.enum.map(literal));
    else if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) type = union((schema.oneOf || schema.anyOf).map(s => wrap(next(s))));
    else if (Array.isArray(schema.allOf)) type = schema.allOf.map(s => wrap(next(s))).join(' & ') || 'unknown';
    else {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? (schema.properties || schema.additionalProperties ? 'object' : schema.items ? 'array' : undefined)];
      type = union(types.map(t => t === 'object' ? object(schema, indent, depth, refs) : t === 'array' ? `${wrap(next(schema.items))}[]` : scalars[t] || 'unknown'));
    }
    return schema.nullable === true && !type.split(' | ').includes('null') ? `${wrap(type)} | null` : type;
  }
  function object(schema, indent, depth, refs) {
    const inner = indent + '  ', required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const lines = Object.entries(schema.properties || {}).map(([name, value]) => `${doc(value?.description, inner)}${inner}${value?.readOnly ? 'readonly ' : ''}${key(name)}${required.has(name) ? '' : '?'}: ${render(value, inner, depth + 1, refs)};\n`);
    const extra = schema.additionalProperties;
    if (extra === true || (extra && typeof extra === 'object')) lines.push(`${inner}[key: string]: ${extra === true || !lines.length ? render(extra === true ? {} : extra, inner, depth + 1, refs) : 'unknown'};\n`);
    return lines.length ? `{\n${lines.join('')}${indent}}` : 'Record<string, unknown>';
  }
  const deref = value => { const seen = new Set(); while (value?.$ref && !seen.has(value.$ref)) { seen.add(value.$ref); value = resolveLocal(spec, value.$ref); } return value; };
  const pick = content => { const entries = Object.entries(content || {}); return (entries.find(([media]) => jsonMedia(media)) || entries[0])?.[1]; };
  function operation(item, method, indent) {
    const op = item[method];
    const inner = indent + '  ', groups = {}, members = [], params = parameters(spec, item, op);
    for (const p of params) if (p.in !== 'body') (groups[p.in] ||= []).push(p);
    const fields = Object.entries(groups).filter(([where]) => where !== 'formData').map(([where, list]) => `${inner}  ${where}${list.some(p => p.required) ? '' : '?'}: {\n${list.map(p => `${doc(p.description, inner + '    ')}${inner}    ${key(p.name)}${p.required ? '' : '?'}: ${render(p.schema || p, inner + '    ')};\n`).join('')}${inner}  };\n`);
    if (fields.length) members.push(`${inner}parameters: {\n${fields.join('')}${inner}};\n`);
    let body = null; try { body = requestBody(spec, op, params); } catch { /* External requestBody refs stay untyped. */ }
    if (body) body = { schema: pick(body.content), required: body.required };
    if (groups.formData) body = { schema: { type: 'object', required: groups.formData.filter(p => p.required).map(p => p.name), properties: Object.fromEntries(groups.formData.map(p => [p.name, p.type === 'file' ? {} : p])) }, required: groups.formData.some(p => p.required) };
    if (body) members.push(`${inner}requestBody${body.required ? '' : '?'}: ${render(body.schema, inner)};\n`);
    const responses = Object.entries(op.responses || {}).map(([code, raw]) => {
      const response = deref(raw) || {}, schema = response.content ? pick(response.content)?.schema : response.schema;
      return `${doc(response.description, inner + '  ')}${inner}  ${key(code)}: ${schema ? render(schema, inner + '  ') : response.content && Object.keys(response.content).length ? 'unknown' : 'void'};\n`;
    });
    members.push(`${inner}responses: {\n${responses.join('')}${inner}};\n`);
    return `${doc(op.summary, indent)}${indent}${method}: {\n${members.join('')}${indent}};\n`;
  }
  const output = [`// Generated by YAML Workbench from ${JSON.stringify(String(spec.info?.title ?? 'API'))} ${JSON.stringify(String(spec.info?.version ?? ''))}.`, '// Formats, patterns and other runtime constraints are not represented. Review before use.', ''];
  for (const [ref, name] of names) {
    const schema = resolveLocal(spec, ref);
    output.push(`${doc(schema?.description, '')}export type ${name} = ${render(schema)};`, '');
  }
  const paths = Object.entries(spec.paths || {}).map(([path, raw]) => {
    const item = deref(raw);
    if (!item || typeof item !== 'object') return '';
    const ops = METHODS.filter(m => item[m] && typeof item[m] === 'object').map(m => operation(item, m, '    '));
    return ops.length ? `  ${JSON.stringify(path)}: {\n${ops.join('')}  };\n` : '';
  }).join('');
  output.push(`export interface paths {\n${paths}}`, '');
  return output.join('\n');
}
