import type { SpecNode } from '../../shared/types.ts';
export { MAX_BYTES, parseDefinition } from '../../shared/openapi.ts';

export function formatError(error: unknown): string {
  const { mark, reason, message } = error as { mark?: { line: number; column: number }; reason?: string; message: string };
  return mark ? `YAML 格式錯誤（第 ${mark.line + 1} 行，第 ${mark.column + 1} 欄）\n${reason}` : message;
}

export function endpointCount(spec: SpecNode): number {
  return Object.values<any>(spec.paths || {}).reduce((sum: number, path) => sum + Object.keys(path || {}).filter(key => /^(get|put|post|delete|options|head|patch|trace)$/.test(key)).length, 0);
}
