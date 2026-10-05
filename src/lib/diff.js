import { diffLines } from 'diff';

const METHODS = /^(get|put|post|delete|options|head|patch|trace)$/;
const operationsOf = path => Object.keys(path || {}).filter(key => METHODS.test(key));

// Schema-level summary: added/removed paths and operations are what teams care about;
// removals are breaking changes for consumers.
export function summarizeSpecChanges(oldSpec, newSpec) {
  const changes = [];
  const oldPaths = oldSpec.paths || {}; const newPaths = newSpec.paths || {};
  if (oldSpec.info?.version !== newSpec.info?.version) changes.push({ type: 'changed', label: `info.version:${oldSpec.info?.version} → ${newSpec.info?.version}` });
  for (const path of Object.keys(newPaths)) {
    if (!Object.hasOwn(oldPaths, path)) { changes.push({ type: 'added', label: `${path}（整條新路徑）` }); continue; }
    const before = operationsOf(oldPaths[path]);
    for (const op of operationsOf(newPaths[path])) if (!before.includes(op)) changes.push({ type: 'added', label: `${op.toUpperCase()} ${path}` });
  }
  for (const path of Object.keys(oldPaths)) {
    if (!Object.hasOwn(newPaths, path)) { changes.push({ type: 'removed', label: `${path}（整條路徑移除）` }); continue; }
    const after = operationsOf(newPaths[path]);
    for (const op of operationsOf(oldPaths[path])) if (!after.includes(op)) changes.push({ type: 'removed', label: `${op.toUpperCase()} ${path}` });
  }
  return { changes, hasBreaking: changes.some(change => change.type === 'removed') };
}

// Flat line diff with long unchanged runs collapsed into expandable markers.
export function buildDiffRows(oldSource, newSource, context = 3) {
  const raw = [];
  if (oldSource.length + newSource.length > 800000 || oldSource.split('\n').length + newSource.split('\n').length > 12000) throw new Error('文件較大，請下載兩個版本後使用本機工具比較。');
  const parts = diffLines(oldSource, newSource, { timeout: 600, maxEditLength: 4000 });
  if (!parts) throw new Error('差異較多，請下載兩個版本後使用本機工具比較。');
  for (const part of parts) {
    const type = part.added ? 'added' : part.removed ? 'removed' : 'same';
    for (const line of part.value.replace(/\n$/, '').split('\n')) raw.push({ type, text: line });
  }
  const segments = []; let i = 0;
  while (i < raw.length) {
    if (raw[i].type !== 'same') { segments.push(raw[i]); i++; continue; }
    let j = i;
    while (j < raw.length && raw[j].type === 'same') j++;
    const run = raw.slice(i, j);
    if (run.length <= context * 2 + 1) segments.push(...run);
    else segments.push(...run.slice(0, context), { type: 'collapsed', count: run.length - context * 2, lines: run.slice(context, run.length - context) }, ...run.slice(run.length - context));
    i = j;
  }
  return segments;
}
