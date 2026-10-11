import { METHODS, resolve, stable } from '../../shared/spec-tools.js';
// Compare semantic objects, ignoring object-key order. Expand local refs with bounded recursion.
function expand(spec, value, refs = new Set(), state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > 30000 || depth > 40) throw new Error('規格較複雜，請使用原始碼差異檢查。');
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    if (refs.has(value.$ref)) return { $recursiveRef: value.$ref };
    const target = resolve(spec, value);
    return expand(spec, { ...target, ...Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$ref')) }, new Set([...refs, value.$ref]), state, depth + 1);
  }
  if (Array.isArray(value)) return value.map(v => expand(spec, v, refs, state, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['example', 'examples', 'default', 'enum', 'const'].includes(k) ? v : expand(spec, v, refs, state, depth + 1)]));
}
const same = (a, b) => stable(a) === stable(b);
export function summarizeSpecChanges(before, after) {
  const changes = [], warnings = new Set(); let truncated = false;
  function add(type, label, risk = 'info', category = 'endpoint', detail = '') {
    if (changes.length >= 500) { truncated = true; return; }
    changes.push({ type, label, risk, category, detail });
  }
  function safely(spec, v) { try { return expand(spec, v); } catch (e) { warnings.add(e.message); return v; } }
  function schemaDiff(a, b, label, direction, depth = 0) {
    if (same(a, b)) return;
    if (depth > 12) { add('changed', label + '：巢狀結構改變', 'review', 'schema'); return; }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { add('changed', label + '：Schema 改變', 'review', 'schema'); return; }
    if (!same(a.type, b.type)) add('changed', label + '：型別改變', 'breaking', 'schema', `${stable(a.type) || '未指定'} → ${stable(b.type) || '未指定'}`);
    if (!same(a.enum, b.enum)) {
      const narrowed = !!b.enum && (!a.enum || a.enum.some(v => !b.enum.some(x => same(x, v))));
      add('changed', label + '：enum 改變', direction === 'request' && narrowed ? 'breaking' : direction !== 'request' ? 'review' : 'info', 'schema');
    }
    const ar = a.required || [], br = b.required || [];
    if (!same([...ar].sort(), [...br].sort())) add('changed', label + '：必要欄位改變', direction === 'request' && br.some(k => !ar.includes(k)) ? 'breaking' : 'review', 'schema', `${ar.join(', ') || '無'} → ${br.join(', ') || '無'}`);
    for (const k of new Set([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})])) {
      const x = a.properties?.[k], y = b.properties?.[k];
      if (x === undefined) add('added', `${label}.${k}：新增欄位`, direction === 'request' && br.includes(k) ? 'breaking' : 'info', 'schema');
      else if (y === undefined) add('removed', `${label}.${k}：移除欄位`, direction === 'response' ? 'breaking' : 'review', 'schema');
      else schemaDiff(x, y, `${label}.${k}`, direction, depth + 1);
    }
    if (!same(a.items, b.items)) schemaDiff(a.items, b.items, label + '[]', direction, depth + 1);
    const skip = new Set(['type', 'enum', 'required', 'properties', 'items', 'description', 'title', 'example', 'examples']);
    const rest = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !skip.has(k)));
    if (!same(rest(a), rest(b))) add('changed', label + '：限制／組合／預設值改變', 'review', 'schema');
    if (!same(a.description, b.description)) add('changed', label + '：描述改變', 'info', 'schema');
  }
  function contentDiff(a = {}, b = {}, label, direction) {
    for (const media of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!Object.hasOwn(a, media)) add('added', `${label}：新增 ${media}`, 'info', 'body');
      else if (!Object.hasOwn(b, media)) add('removed', `${label}：移除 ${media}`, 'breaking', 'body');
      else {
        schemaDiff(a[media].schema, b[media].schema, `${label} ${media}`, direction);
        if (!same(a[media].example, b[media].example) || !same(a[media].examples, b[media].examples)) add('changed', `${label} ${media}：範例改變`, 'info', 'body');
        if (!same(a[media].encoding, b[media].encoding)) add('changed', `${label} ${media}：編碼改變`, 'review', 'body');
      }
    }
  }
  if (before.info?.version !== after.info?.version) add('changed', `info.version: ${before.info?.version} → ${after.info?.version}`, 'info', 'metadata');
  for (const k of ['servers', 'host', 'basePath', 'schemes', 'security']) if (!same(before[k], after[k])) add('changed', `${k}：全域連線／授權設定改變`, 'review', 'metadata');
  if (!same(before.components?.securitySchemes || before.securityDefinitions, after.components?.securitySchemes || after.securityDefinitions)) add('changed', '授權方式定義改變', 'review', 'metadata');
  const oldPaths = before.paths || {}, newPaths = after.paths || {};
  for (const path of new Set([...Object.keys(newPaths), ...Object.keys(oldPaths)])) {
    const a = safely(before, oldPaths[path]) || {}, b = safely(after, newPaths[path]) || {};
    for (const method of METHODS.filter(m => b[m] && !a[m])) add('added', `${method.toUpperCase()} ${path}`);
    for (const method of METHODS.filter(m => a[m] && !b[m])) add('removed', `${method.toUpperCase()} ${path}`, 'breaking');
    for (const method of METHODS.filter(m => a[m] && b[m])) {
      const x = a[method], y = b[method], label = `${method.toUpperCase()} ${path}`;
      const params = (item, op) => new Map([...(item.parameters || []), ...(op.parameters || [])].map(p => [`${p.in}:${p.name}`, p]));
      const ap = params(a, x), bp = params(b, y);
      for (const key of new Set([...ap.keys(), ...bp.keys()])) {
        const p = ap.get(key), q = bp.get(key), name = `${label} · ${key}`;
        if (!p) add('added', name + '：新增參數', q.required ? 'breaking' : 'info', 'parameter');
        else if (!q) add('removed', name + '：移除參數', 'review', 'parameter');
        else {
          if (!!p.required !== !!q.required) add('changed', name + (q.required ? '：改為必填' : '：改為選填'), q.required ? 'breaking' : 'info', 'parameter');
          schemaDiff(p.schema || p, q.schema || q, name, 'request');
          contentDiff(p.content, q.content, name, 'request');
          if (!same([p.style, p.explode, p.collectionFormat], [q.style, q.explode, q.collectionFormat])) add('changed', name + '：序列化方式改變', 'review', 'parameter');
        }
      }
      if (!same(x.requestBody, y.requestBody)) {
        if (!x.requestBody || !y.requestBody) add(y.requestBody ? 'added' : 'removed', label + '：Request Body 改變', y.requestBody?.required ? 'breaking' : 'review', 'body');
        else {
          if (!!x.requestBody.required !== !!y.requestBody.required) add('changed', label + '：Request Body 必填設定改變', y.requestBody.required ? 'breaking' : 'info', 'body');
          contentDiff(x.requestBody.content, y.requestBody.content, label + ' Request', 'request');
        }
      }
      for (const code of new Set([...Object.keys(x.responses || {}), ...Object.keys(y.responses || {})])) {
        const r = x.responses?.[code], s = y.responses?.[code], name = `${label} Response ${code}`;
        if (!r) add('added', name, 'info', 'response');
        else if (!s) add('removed', name, 'breaking', 'response');
        else { contentDiff(r.content, s.content, name, 'response'); schemaDiff(r.schema, s.schema, name, 'response'); if (!same(r.headers, s.headers)) add('changed', name + '：回應標頭改變', 'review', 'response'); }
      }
      for (const field of ['security', 'servers', 'consumes', 'produces', 'callbacks', 'deprecated']) if (!same(x[field], y[field])) add('changed', `${label}：${field} 改變`, 'review');
      for (const field of ['summary', 'description', 'operationId', 'tags']) if (!same(x[field], y[field])) add('changed', `${label}：${field} 改變`, 'info');
    }
  }
  const ad = before.components?.schemas || before.definitions || {}, bd = after.components?.schemas || after.definitions || {};
  for (const name of new Set([...Object.keys(ad), ...Object.keys(bd)])) {
    if (!Object.hasOwn(ad, name)) add('added', `Schema ${name}`, 'info', 'schema');
    else if (!Object.hasOwn(bd, name)) add('removed', `Schema ${name}`, 'review', 'schema');
    else schemaDiff(safely(before, ad[name]), safely(after, bd[name]), `Schema ${name}`, 'unknown');
  }
  if (!same(before.webhooks, after.webhooks)) add('changed', 'Webhooks 定義改變，請檢查原始差異', 'review');
  if (truncated) warnings.add('變更超過 500 項，摘要已截斷，請檢查原始差異。');
  return { changes, warnings: [...warnings], hasBreaking: changes.some(c => c.risk === 'breaking') };
}
