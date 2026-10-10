import { parseDocument, LineCounter } from 'yaml';
import { parseDefinition } from './openapi.js';
import { validateSpec } from '../../shared/validation.js';
export function analyzeSource(source) {
  try {
    const spec = parseDefinition(source);
    const issues = validateSpec(spec);
    const lines = new LineCounter();
    const ast = issues.length ? parseDocument(source, { lineCounter: lines, keepSourceTokens: true }) : null;
    const diagnostics = issues.map(issue => {
      const parts = issue.path ? issue.path.slice(1).split('/').map(s => s.replaceAll('~1','/').replaceAll('~0','~')) : [];
      let node;
      while (!node && parts.length) { node = ast.getIn(parts, true); if (!node) parts.pop(); }
      const position = lines.linePos(node?.range?.[0] ?? 0);
      return { ...issue, line: position.line, column: position.col };
    });
    return { spec: diagnostics.some(d => d.severity === 'error') ? null : spec, diagnostics };
  } catch (error) {
    return { spec: null, diagnostics: [{ severity: 'error', message: error.reason || error.message, line: error.mark ? error.mark.line + 1 : 1, column: error.mark ? error.mark.column + 1 : 1 }] };
  }
}
