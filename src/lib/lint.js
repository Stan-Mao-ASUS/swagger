import { METHODS } from '../../shared/spec-tools.js';
import { resolveLocal } from '../../shared/validation.js';
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const PER_RULE = 25;
// Style suggestions never block saving or preview; validation.js owns correctness.
const rules = [
  { id: 'info-description', label: 'info 要有 description', spec: (spec, report) => { if (!spec.info?.description?.trim?.()) report('/info', 'info 缺少 description，讀者無法得知 API 用途。'); } },
  { id: 'operation-id', label: '每個操作都要有 operationId', operation: ({ op, at, label }, report) => { if (!op.operationId) report(at, `${label} 缺少 operationId，產生 client 程式碼時會難以命名。`); } },
  { id: 'operation-id-camel-case', label: 'operationId 使用 camelCase', operation: ({ op, at }, report) => { if (typeof op.operationId === 'string' && !/^[a-z][a-zA-Z0-9]*$/.test(op.operationId)) report(at + '/operationId', `operationId「${op.operationId}」建議使用 camelCase，例如 listPets。`); } },
  { id: 'operation-summary', label: '每個操作都要有 summary', operation: ({ op, at, label }, report) => { if (!op.summary?.trim?.()) report(at, `${label} 缺少 summary。`); } },
  { id: 'operation-tags', label: '每個操作都要有 tags', operation: ({ op, at, label }, report) => { if (!Array.isArray(op.tags) || !op.tags.length) report(at, `${label} 沒有 tags，文件中會歸在 default。`); } },
  { id: 'tag-declared', label: '使用的 tag 要在頂層 tags 宣告', operation: ({ op, at, declared }, report) => { (Array.isArray(op.tags) ? op.tags : []).forEach((tag, i) => { if (!declared.has(tag)) report(`${at}/tags/${i}`, `tag「${tag}」未在頂層 tags 宣告，無法提供說明。`); }); } },
  { id: 'success-response', label: '每個操作都要有成功回應', operation: ({ op, at, label }, report) => { if (!Object.keys(op.responses || {}).some(code => /^[23]/.test(code) || code === 'default')) report(at + '/responses', `${label} 沒有 2xx／3xx 或 default 回應。`); } },
  { id: 'path-kebab-case', label: '路徑使用小寫 kebab-case', path: (path, report) => { const bad = path.split('/').find(s => s && !/^\{[^{}]+\}$/.test(s) && !/^[a-z0-9][a-z0-9._~-]*$/.test(s)); if (bad) report('/paths/' + pointer(path), `路徑片段「${bad}」建議使用小寫 kebab-case。`); } },
  { id: 'path-trailing-slash', label: '路徑不以 / 結尾', path: (path, report) => { if (path.length > 1 && path.endsWith('/')) report('/paths/' + pointer(path), `路徑「${path}」不應以 / 結尾。`); } },
];
export const STYLE_RULES = rules.map(({ id, label }) => ({ id, label }));
export function lintSpec(spec, off = []) {
  const declared = new Set((Array.isArray(spec.tags) ? spec.tags : []).map(tag => tag?.name)), operations = [], paths = [];
  for (const [path, raw] of Object.entries(spec.paths || {})) {
    if (!path.startsWith('/')) continue;
    paths.push(path);
    const item = raw?.$ref ? resolveLocal(spec, raw.$ref) : raw;
    if (!item || typeof item !== 'object') continue;
    for (const method of METHODS) if (item[method] && typeof item[method] === 'object') operations.push({ op: item[method], at: `/paths/${pointer(path)}/${method}`, label: `${method.toUpperCase()} ${path}`, declared });
  }
  const issues = [];
  for (const rule of rules) {
    if (off.includes(rule.id)) continue;
    let count = 0;
    const report = (path, message) => { if (count++ < PER_RULE) issues.push({ rule: rule.id, path, message, severity: 'info' }); };
    rule.spec?.(spec, report);
    if (rule.operation) for (const operation of operations) rule.operation(operation, report);
    if (rule.path) for (const path of paths) rule.path(path, report);
  }
  return issues;
}
