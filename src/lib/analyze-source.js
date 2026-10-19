import { parseDocument, LineCounter } from 'yaml';
import { parseDefinition } from './openapi.js';
import { validateSpec } from '../../shared/validation.js';
import { lintSpec } from './lint.js';
export function analyzeSource(source, styleOff = []) {
  try {
    const spec = parseDefinition(source);
    const issues = validateSpec(spec), suggestions = lintSpec(spec, styleOff);
    const lines = new LineCounter();
    let ast;
    const locate = issue => {
      ast ||= parseDocument(source, { lineCounter: lines, keepSourceTokens: true });
      const parts = issue.path ? issue.path.slice(1).split('/').map(s => s.replaceAll('~1','/').replaceAll('~0','~')) : [];
      let node;
      while (!node && parts.length) { node = ast.getIn(parts, true); if (!node) parts.pop(); }
      const position = lines.linePos(node?.range?.[0] ?? 0);
      return { ...issue, line: position.line, column: position.col };
    };
    const diagnostics = issues.map(locate);
    return { spec: diagnostics.some(d => d.severity === 'error') ? null : spec, diagnostics, style: suggestions.map(locate) };
  } catch (error) {
    return { spec: null, style: [], diagnostics: [{ severity: 'error', message: error.reason || error.message, line: error.mark ? error.mark.line + 1 : 1, column: error.mark ? error.mark.column + 1 : 1 }] };
  }
}
