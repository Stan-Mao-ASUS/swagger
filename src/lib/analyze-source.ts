import { parseDocument, LineCounter } from 'yaml';
import { parseDefinition } from './openapi.ts';
import { validateSpec } from '../../shared/validation.ts';
import { lintSpec } from './lint.ts';
import { METHODS } from '../../shared/spec-tools.ts';
import type { Diagnostic, Issue, SpecNode } from '../../shared/types.ts';
export type OutlineKind = 'path' | 'operation' | 'webhook' | 'schema';
export interface OutlineItem { kind: OutlineKind; label: string; detail: string; line: number; column: number }
export interface Analysis { spec: SpecNode | null; diagnostics: Diagnostic[]; style: Diagnostic[]; outline: OutlineItem[] }
const OUTLINE_LIMIT = 2000;
const pointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
function outlineEntries(spec: SpecNode) {
  const entries: { kind: OutlineKind; label: string; detail: string; path: string }[] = [];
  const items = (group: 'paths' | 'webhooks', kind: OutlineKind) => {
    for (const [name, item] of Object.entries<any>(spec[group] && typeof spec[group] === 'object' ? spec[group] : {})) {
      entries.push({ kind, label: name, detail: '', path: `/${group}/${pointer(name)}` });
      if (item && typeof item === 'object') for (const method of METHODS) if (item[method] && typeof item[method] === 'object') {
        const op = item[method];
        entries.push({ kind: 'operation', label: `${method.toUpperCase()} ${name}`, detail: [op.summary, op.operationId].filter(v => typeof v === 'string').join(' · '), path: `/${group}/${pointer(name)}/${method}` });
      }
    }
  };
  items('paths', 'path'); items('webhooks', 'webhook');
  const [group, schemas] = spec.components?.schemas ? ['/components/schemas', spec.components.schemas] : ['/definitions', spec.definitions];
  for (const name of Object.keys(schemas && typeof schemas === 'object' ? schemas : {})) entries.push({ kind: 'schema', label: name, detail: '', path: `${group}/${pointer(name)}` });
  return entries.slice(0, OUTLINE_LIMIT);
}
export function analyzeSource(source: string, styleOff: string[] = [], { outline = false } = {}): Analysis {
  try {
    const spec = parseDefinition(source);
    const issues = validateSpec(spec), suggestions = lintSpec(spec, styleOff);
    const lines = new LineCounter();
    let ast: ReturnType<typeof parseDocument> | undefined;
    const locate = (issue: Issue): Diagnostic => {
      ast ||= parseDocument(source, { lineCounter: lines, keepSourceTokens: true });
      const parts = issue.path ? issue.path.slice(1).split('/').map(s => s.replaceAll('~1','/').replaceAll('~0','~')) : [];
      let node: any;
      while (!node && parts.length) { node = ast.getIn(parts, true); if (!node) parts.pop(); }
      const position = lines.linePos(node?.range?.[0] ?? 0);
      return { ...issue, line: position.line, column: position.col };
    };
    // Outline entries point at the key that names them, not at the value below it.
    const locateKey = (path: string) => {
      ast ||= parseDocument(source, { lineCounter: lines, keepSourceTokens: true });
      const parts = path.slice(1).split('/').map(s => s.replaceAll('~1','/').replaceAll('~0','~')), key = parts.pop();
      const parent: any = ast.getIn(parts, true), pair = parent?.items?.find((item: any) => String(item.key?.value) === key);
      const position = lines.linePos(pair?.key?.range?.[0] ?? 0);
      return { line: position.line, column: position.col };
    };
    const diagnostics = issues.map(locate);
    const items = outline ? outlineEntries(spec).map(({ path, ...entry }) => ({ ...entry, ...locateKey(path) })) : [];
    return { spec: diagnostics.some(d => d.severity === 'error') ? null : spec, diagnostics, style: suggestions.map(locate), outline: items };
  } catch (thrown) {
    const error = thrown as { reason?: string; message: string; mark?: { line: number; column: number } };
    return { spec: null, style: [], outline: [], diagnostics: [{ path: '', severity: 'error', message: error.reason || error.message, line: error.mark ? error.mark.line + 1 : 1, column: error.mark ? error.mark.column + 1 : 1 }] };
  }
}
export interface ValidationRequest { id: number; source: string; styleOff: string[]; outline: boolean }
export interface ValidationResponse { id: number; result: Analysis }
