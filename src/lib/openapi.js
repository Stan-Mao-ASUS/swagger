export { MAX_BYTES, parseDefinition } from '../../shared/openapi.js';

export function formatError(error) {
  return error.mark ? `YAML 格式錯誤（第 ${error.mark.line + 1} 行，第 ${error.mark.column + 1} 欄）\n${error.reason}` : error.message;
}

export function endpointCount(spec) {
  return Object.values(spec.paths || {}).reduce((sum, path) => sum + Object.keys(path || {}).filter(key => /^(get|put|post|delete|options|head|patch|trace)$/.test(key)).length, 0);
}
