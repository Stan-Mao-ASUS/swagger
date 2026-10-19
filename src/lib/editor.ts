import { dump } from 'js-yaml';
import { parseDefinition } from './openapi.ts';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { METHODS } from '../../shared/spec-tools.ts';
import type { SpecNode } from '../../shared/types.ts';

const serialize = (spec: SpecNode, format: string) => format === 'json' ? JSON.stringify(spec, null, 2) + '\n' : dump(spec, { indent: 2, lineWidth: -1, noRefs: true });
export function convertSource(source: string, format: 'json' | 'yaml' | string): string {
  return serialize(parseDefinition(source), format);
}

const ROOT = ['openapi', 'swagger', 'info', 'jsonSchemaDialect', 'host', 'basePath', 'schemes', 'servers', 'consumes', 'produces', 'tags', 'paths', 'webhooks', 'components', 'definitions', 'parameters', 'responses', 'securityDefinitions', 'security', 'externalDocs'];
const INFO = ['title', 'summary', 'description', 'termsOfService', 'contact', 'license', 'version'];
const PATH_ITEM = ['$ref', 'summary', 'description', 'servers', 'parameters', ...METHODS];
const OPERATION = ['tags', 'summary', 'description', 'externalDocs', 'operationId', 'consumes', 'produces', 'parameters', 'requestBody', 'responses', 'callbacks', 'deprecated', 'security', 'servers'];
const COMPONENTS = ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks', 'pathItems'];
const isObject = (value: unknown): value is SpecNode => !!value && typeof value === 'object' && !Array.isArray(value);
// Known keys move to their conventional position; unknown keys (extensions included) keep their relative order after them.
function ordered(node: unknown, order: readonly string[], alphabetical = false): unknown {
  if (!isObject(node)) return node;
  const keys = Object.keys(node), rank = (key: string) => order.indexOf(key);
  const known = keys.filter(key => rank(key) >= 0).sort((a, b) => rank(a) - rank(b));
  const rest = keys.filter(key => rank(key) < 0);
  if (alphabetical) rest.sort((a, b) => a.localeCompare(b));
  return Object.fromEntries([...known, ...rest].map(key => [key, node[key]]));
}
const mapValues = (node: unknown, map: (value: unknown) => unknown) => isObject(node) ? Object.fromEntries(Object.entries(node).map(([key, value]) => [key, map(value)])) : node;
function pathItem(item: unknown) {
  const next = ordered(item, PATH_ITEM);
  if (isObject(next)) for (const method of METHODS) if (isObject(next[method])) next[method] = ordered(next[method], OPERATION);
  return next;
}
export interface FormatOptions { sortPaths: boolean; sortSchemas: boolean }
export function formatSource(source: string, { sortPaths, sortSchemas }: FormatOptions): string {
  const spec = ordered(parseDefinition(source), ROOT) as SpecNode;
  if (isObject(spec.info)) spec.info = ordered(spec.info, INFO);
  if (isObject(spec.paths)) spec.paths = mapValues(ordered(spec.paths, [], sortPaths), pathItem);
  if (isObject(spec.webhooks)) spec.webhooks = mapValues(spec.webhooks, pathItem);
  if (isObject(spec.components)) {
    spec.components = ordered(spec.components, COMPONENTS);
    if (sortSchemas && isObject(spec.components.schemas)) spec.components.schemas = ordered(spec.components.schemas, [], true);
  }
  if (sortSchemas && isObject(spec.definitions)) spec.definitions = ordered(spec.definitions, [], true);
  return serialize(spec, source.trimStart().startsWith('{') ? 'json' : 'yaml');
}
export const completionKeys = ['openapi','swagger','info','title','description','version','servers','url','paths','get','post','put','patch','delete','operationId','summary','tags','parameters','name','in','required','schema','type','properties','items','requestBody','content','application/json','responses','components','schemas','securitySchemes','security','$ref','example','enum'];
export function completionFor(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$\/-]*/);
  if (!word || (!context.explicit && word.from === word.to)) return null;
  const before = context.state.doc.sliceString(context.state.doc.lineAt(word.from).from, word.from);
  // YAML keys only, never suggest fields in a value, comment, or quoted JSON string.
  if (!/^\s*(?:-\s*)?$/.test(before)) return null;
  return { from: word.from, options: completionKeys.map(label => ({ label, type: 'property', apply: label + ': ' })) };
}
