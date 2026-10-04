import { load, JSON_SCHEMA } from 'js-yaml';

export const MAX_BYTES = 5 * 1024 * 1024;

export function parseDefinition(source) {
  if (!source.trim()) throw new Error('請先選擇檔案或貼上 YAML / JSON 內容。');
  if (new Blob([source]).size > MAX_BYTES) throw new Error('檔案過大，請使用 5 MB 以內的文件。');
  const parsed = load(source, { schema: JSON_SCHEMA });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('API 定義必須是 YAML 或 JSON 物件。');
  if (parsed.swagger !== '2.0' && !/^3\.(0|1)\.\d+$/.test(String(parsed.openapi || ''))) throw new Error('請提供 swagger: "2.0" 或 openapi: 3.0.x / 3.1.x 的文件。');
  if (typeof parsed.info?.title !== 'string' || !parsed.info.title.trim() || parsed.info.title.length > 500 || typeof parsed.info.version !== 'string') throw new Error('文件需要 info.title（最多 500 字）與 info.version，且兩者都必須是字串。');
  if ((!parsed.paths || typeof parsed.paths !== 'object' || Array.isArray(parsed.paths)) && !(String(parsed.openapi).startsWith('3.1.') && (parsed.webhooks || parsed.components))) throw new Error('文件需要 paths 物件，例如 paths: {}。');
  checkExpansion(parsed);
  return JSON.parse(JSON.stringify(parsed));
}

// YAML aliases may describe a tiny source that expands into an enormous JSON tree.
// Bound the expanded traversal before JSON.stringify and Swagger UI receive it.
function checkExpansion(value) {
  const ancestors = new WeakSet(); let nodes = 0; let characters = 0;
  function visit(node, depth) {
    if (++nodes > 100000 || depth > 100) throw new Error('文件結構過深或展開內容過大，請改用 OpenAPI 的 $ref。');
    if (typeof node === 'string') characters += node.length;
    if (characters > MAX_BYTES) throw new Error('文件展開內容過大，請改用 OpenAPI 的 $ref。');
    if (!node || typeof node !== 'object') return;
    if (ancestors.has(node)) throw new Error('無法處理循環 YAML alias，請改用 OpenAPI 的 $ref。');
    ancestors.add(node);
    for (const [key, child] of Object.entries(node)) { characters += key.length; visit(child, depth + 1); }
    ancestors.delete(node);
  }
  visit(value, 0);
}
