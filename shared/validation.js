import { swagger2, openapi30, openapi31, jsonSchema2020 } from '../.sites-runtime/validators.js';
const escape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const methods = new Set(['get','post','put','patch','delete','options','head','trace']);
export function resolveLocal(spec, ref) {
  if (ref === '#') return spec;
  if (!ref.startsWith('#/')) return undefined;
  try {
    const parts = decodeURIComponent(ref.slice(2)).split('/').map(s => s.replaceAll('~1','/').replaceAll('~0','~'));
    let node = spec;
    for (const part of parts) { if (!node || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined; node = node[part]; }
    return node;
  } catch { return undefined; }
}
export function validateSpec(spec) {
  const diagnostics = [], seen = new Set();
  const add = (path, message, severity = 'error') => {
    const key = `${path}:${message}`;
    if (seen.has(key)) return;
    if (diagnostics.length >= 100) {
      const warning = diagnostics.findIndex(d => d.severity === 'warning');
      if (severity !== 'error' || warning < 0) return;
      diagnostics.splice(warning, 1);
    }
    seen.add(key); diagnostics.push({ path, message, severity });
  };
  const validator = spec.swagger === '2.0' ? swagger2 : String(spec.openapi).startsWith('3.1.') ? openapi31 : openapi30;
  if (!validator(spec)) {
    for (const e of validator.errors || []) {
      if (['oneOf','anyOf','if'].includes(e.keyword)) continue;
      // Reference alternatives otherwise generate misleading "must have $ref" for every invalid inline object.
      if (e.keyword === 'required' && e.params.missingProperty === '$ref') continue;
      const path = e.instancePath + (e.keyword === 'additionalProperties' ? '/' + escape(e.params.additionalProperty) : '');
      add(path, e.keyword === 'required' ? `缺少必要欄位：${e.params.missingProperty}` : `${e.message}${e.params.allowedValues ? '：' + e.params.allowedValues.join(', ') : ''}`);
    }
    if (!diagnostics.length) add('', '文件不符合 OpenAPI 結構描述。');
  }
  const refs = [], anchors = new Set(), schemas = [];
  function visit(node, path = '', schema = false, resource = false) {
    if (!node || typeof node !== 'object') return;
    if (schema && typeof node.$id === 'string') resource = true;
    if (schema && typeof node.$anchor === 'string') anchors.add(node.$anchor);
    if (typeof node.$ref === 'string') refs.push({ ref: node.$ref, path: path + '/$ref', resource });
    if (String(spec.openapi).startsWith('3.1.') && (path.endsWith('/schema') || /^\/components\/schemas\/[^/]+$/.test(path))) schemas.push({ node, path });
    const map = /\/(properties|patternProperties|schemas|definitions|\$defs|examples)$/.test(path);
    for (const [key, value] of Object.entries(node)) {
      if (!map && (['example','default','enum','const','value'].includes(key) || key.startsWith('x-'))) continue;
      visit(value, path + '/' + escape(key), schema || key === 'schema' || path === '/components/schemas', resource);
    }
  }
  visit(spec);
  for (const { node, path } of schemas) {
    if (!jsonSchema2020(node)) for (const e of jsonSchema2020.errors || []) add(path + e.instancePath, `JSON Schema：${e.message}`);
    if (node.$schema && !['https://json-schema.org/draft/2020-12/schema', 'https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.1/dialect/2024-11-10'].includes(node.$schema)) add(path + '/$schema', '自訂 JSON Schema dialect 尚未載入；目前以 2020-12 檢查。', 'warning');
  }
  for (const { ref, path, resource } of refs) {
    if (!ref.startsWith('#') || resource) { add(path, '外部或獨立 $id 參照尚未驗證；請確認目標定義。', 'warning'); continue; }
    if (ref.startsWith('#') && !ref.startsWith('#/') && ref !== '#') {
      let name; try { name = decodeURIComponent(ref.slice(1)); } catch { name = ''; }
      if (!anchors.has(name)) add(path, `找不到參照：${ref}`);
    } else if (resolveLocal(spec, ref) === undefined) add(path, `找不到參照：${ref}`);
  }
  const deref = value => {
    const visited = new Set();
    while (value?.$ref) { if (visited.has(value.$ref)) return null; visited.add(value.$ref); value = resolveLocal(spec, value.$ref); }
    return value;
  };
  const operationIds = new Map(), pathTemplates = new Set();
  const activeItems = new Set();
  function pathItem(item, path, template) {
    const resolved = deref(item); if (!resolved || typeof resolved !== 'object' || activeItems.has(resolved)) return;
    activeItems.add(resolved);
    for (const [method, operation] of Object.entries(resolved)) {
      if (!methods.has(method) || !operation || typeof operation !== 'object') continue;
      const opPath = path + '/' + method;
      if (operation.operationId) {
        if (operationIds.has(operation.operationId)) add(opPath + '/operationId', `operationId 重複：${operation.operationId}`);
        else operationIds.set(operation.operationId, opPath);
      }
      if (template) {
        const parameters = [...(Array.isArray(resolved.parameters) ? resolved.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
        const merged = new Map(); let unresolved = false;
        for (const value of parameters) { const p = deref(value); if (!p) { unresolved = true; continue; } merged.set(`${p.in}:${p.name}`, p); }
        const names = new Set(Array.from(template.matchAll(/\{([^{}]+)\}/g), m => m[1]));
        for (const name of names) if (!unresolved && !merged.has(`path:${name}`)) add(opPath + '/parameters', `路徑參數 {${name}} 未宣告。`);
        for (const p of merged.values()) if (p.in === 'path') {
          if (!names.has(p.name)) add(opPath + '/parameters', `參數 ${p.name} 不在路徑模板中。`);
          if (p.required !== true) add(opPath + '/parameters', `路徑參數 ${p.name} 必須設定 required: true。`);
        }
      }
      const security = operation.security ?? spec.security;
      for (const requirement of Array.isArray(security) ? security : []) for (const name of Object.keys(requirement || {})) if (!Object.hasOwn(spec.components?.securitySchemes || spec.securityDefinitions || {}, name)) add(opPath + '/security', `未定義 security scheme：${name}`);
      for (const [name, callback] of Object.entries(operation.callbacks || {})) for (const [expression, nested] of Object.entries(callback || {})) if (expression !== '$ref') pathItem(nested, opPath + '/callbacks/' + escape(name) + '/' + escape(expression), null);
    }
    activeItems.delete(resolved);
  }
  for (const [path, item] of Object.entries(spec.paths || {})) {
    if (!path.startsWith('/')) continue;
    const template = path.replace(/\{[^{}]+\}/g, '{}');
    if (pathTemplates.has(template)) add('/paths/' + escape(path), '路徑模板與其他端點重複，僅參數名稱不同。');
    pathTemplates.add(template); pathItem(item, '/paths/' + escape(path), path);
  }
  for (const [name,item] of Object.entries(spec.webhooks || {})) pathItem(item, '/webhooks/' + escape(name), null);
  return diagnostics;
}
