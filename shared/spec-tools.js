export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
// Local JSON Pointer only. Never fetch referenced URLs or follow inherited properties.
export function resolve(spec, value, seen = new Set()) {
  if (!value || typeof value !== 'object' || !value.$ref) return value;
  const ref = value.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref)) throw new Error('無法解析外部、錨點或循環參照；請提供明確 example 或展開參照。');
  let target = spec;
  for (const key of decodeURIComponent(ref.slice(2)).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error('找不到參照：' + ref);
    target = target[key];
  }
  return resolve(spec, target, new Set([...seen, ref]));
}
export function stable(value) {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
