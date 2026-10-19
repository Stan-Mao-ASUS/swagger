import { METHODS } from '../shared/spec-tools.js';
// Each entry is a control-character kind marker plus a value, one per line. Queries reject control
// characters, so SQL substring search can only match values, never markers or line boundaries.
const KINDS = { path: '\x01', operationId: '\x02', tag: '\x03', schema: '\x04', summary: '\x05' };
const NAMES = Object.fromEntries(Object.entries(KINDS).map(([name, marker]) => [marker, name]));
const LIMIT = 64000;
export function searchText(spec) {
  const entries = new Set();
  const add = (kind, value) => { if (typeof value === 'string' && value.trim()) entries.add(KINDS[kind] + value.replace(/[\x00-\x1f\s]+/g, ' ').trim().slice(0, 200)); };
  for (const [path, item] of Object.entries(spec.paths || {})) {
    add('path', path);
    if (!item || typeof item !== 'object') continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      add('operationId', op.operationId); add('summary', op.summary);
      for (const tag of Array.isArray(op.tags) ? op.tags : []) add('tag', tag);
    }
  }
  for (const tag of Array.isArray(spec.tags) ? spec.tags : []) add('tag', tag?.name);
  for (const name of Object.keys(spec.components?.schemas || spec.definitions || {})) add('schema', name);
  let text = '';
  for (const entry of entries) { if (text.length + entry.length + 1 > LIMIT) break; text += entry + '\n'; }
  return text;
}
export function searchMatches(text, query) {
  const needle = query.toLowerCase(), matches = [];
  for (const line of (text || '').split('\n')) {
    if (line.slice(1).toLowerCase().includes(needle)) matches.push({ kind: NAMES[line[0]], value: line.slice(1) });
    if (matches.length === 3) break;
  }
  return matches;
}
