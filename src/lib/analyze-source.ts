import { parseDocument, LineCounter } from 'yaml';
import { parseDefinition } from './openapi.ts';
import { validateSpec } from '../../shared/validation.ts';
import { lintSpec } from './lint.ts';
import type { Diagnostic, Issue, SpecNode } from '../../shared/types.ts';
export interface Analysis { spec: SpecNode | null; diagnostics: Diagnostic[]; style: Diagnostic[] }
export function analyzeSource(source: string, styleOff: string[] = []): Analysis {
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
    const diagnostics = issues.map(locate);
    return { spec: diagnostics.some(d => d.severity === 'error') ? null : spec, diagnostics, style: suggestions.map(locate) };
  } catch (thrown) {
    const error = thrown as { reason?: string; message: string; mark?: { line: number; column: number } };
    return { spec: null, style: [], diagnostics: [{ path: '', severity: 'error', message: error.reason || error.message, line: error.mark ? error.mark.line + 1 : 1, column: error.mark ? error.mark.column + 1 : 1 }] };
  }
}
export interface ValidationRequest { id: number; source: string; styleOff: string[] }
export interface ValidationResponse { id: number; result: Analysis }
