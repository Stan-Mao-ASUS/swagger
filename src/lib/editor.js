import { dump } from 'js-yaml';
import { parseDefinition } from './openapi.js';

// Syntax and essential document checks; Swagger UI handles reference rendering.
export function analyzeSource(source) {
  try { return { spec: parseDefinition(source), diagnostics: [] }; }
  catch (error) {
    return { spec: null, diagnostics: [{ message: error.reason || error.message, line: error.mark ? error.mark.line + 1 : 1, column: error.mark ? error.mark.column + 1 : 1 }] };
  }
}
export function convertSource(source, format) {
  const spec = parseDefinition(source);
  return format === 'json' ? JSON.stringify(spec, null, 2) + '\n' : dump(spec, { indent: 2, lineWidth: -1, noRefs: true });
}
export const completionKeys = ['openapi','swagger','info','title','description','version','servers','url','paths','get','post','put','patch','delete','operationId','summary','tags','parameters','name','in','required','schema','type','properties','items','requestBody','content','application/json','responses','components','schemas','securitySchemes','security','$ref','example','enum'];
export function completionFor(context) {
  const word = context.matchBefore(/[\w$\/-]*/);
  if (!word || (!context.explicit && word.from === word.to)) return null;
  const before = context.state.doc.sliceString(context.state.doc.lineAt(word.from).from, word.from);
  // YAML keys only, never suggest fields in a value, comment, or quoted JSON string.
  if (!/^\s*(?:-\s*)?$/.test(before)) return null;
  return { from: word.from, options: completionKeys.map(label => ({ label, type: 'property', apply: label + ': ' })) };
}
