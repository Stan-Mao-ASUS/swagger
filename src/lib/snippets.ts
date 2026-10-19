import { METHODS, resolve } from '../../shared/spec-tools.ts';
import { parameters, sampleRequest, sampleSchema } from '../../shared/mock.ts';
import type { SpecNode } from '../../shared/types.ts';

export interface Operation { path: string; method: string; label: string }
export interface Snippets { url: string; curl: string; javascript: string; python: string }

export function operationsOf(spec: SpecNode): Operation[] {
  const ops: Operation[] = [];
  for (const [path, raw] of Object.entries<unknown>(spec.paths || {})) {
    let item: any; try { item = resolve(spec, raw); } catch { continue; }
    for (const method of METHODS) if (item?.[method] && typeof item[method] === 'object') ops.push({ path, method, label: method.toUpperCase() + ' ' + path });
  }
  return ops;
}

// Relative server URLs resolve against the page, as Swagger UI does for a document without its own URL.
function baseUrl(spec: SpecNode, origin: string): string {
  if (spec.swagger) return `${(Array.isArray(spec.schemes) && spec.schemes[0]) || new URL(origin).protocol.slice(0, -1)}://${spec.host || new URL(origin).host}${spec.basePath || ''}`.replace(/\/$/, '');
  const server = Array.isArray(spec.servers) ? spec.servers[0] : null;
  const url = String(server?.url || '/').replace(/\{([^{}]+)\}/g, (match, name) => server?.variables?.[name]?.default ?? match);
  try { return new URL(url, origin).href.replace(/\/$/, ''); } catch { return url.replace(/\/$/, ''); }
}

const sample = (spec: SpecNode, schema: unknown) => { try { return sampleSchema(spec, schema, { nodes: 0, request: true }); } catch { return undefined; } };
const scalar = (value: unknown) => value === undefined || value === null || typeof value === 'object' ? '1' : String(value);

function credentials(spec: SpecNode, op: SpecNode) {
  const headers: [string, string][] = [], query: [string, string][] = [];
  const requirement = (Array.isArray(op.security) ? op.security : Array.isArray(spec.security) ? spec.security : [])[0] || {};
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  for (const name of Object.keys(requirement)) {
    let scheme: any; try { scheme = resolve(spec, schemes[name]); } catch { continue; }
    if (!scheme) continue;
    if (scheme.type === 'apiKey' && scheme.in === 'header') headers.push([scheme.name, '<API_KEY>']);
    else if (scheme.type === 'apiKey' && scheme.in === 'query') query.push([scheme.name, '<API_KEY>']);
    else if (scheme.type === 'basic' || (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic')) headers.push(['Authorization', 'Basic <BASE64_USER_PASSWORD>']);
    else if (scheme.type === 'http' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') headers.push(['Authorization', 'Bearer <TOKEN>']);
  }
  return { headers, query };
}

const shell = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
function python(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  const inner = indent + '    ';
  if (Array.isArray(value)) return value.length ? `[\n${value.map(item => inner + python(item, inner)).join(',\n')},\n${indent}]` : '[]';
  const entries = Object.entries(value as object);
  return entries.length ? `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${python(item, inner)}`).join(',\n')},\n${indent}}` : '{}';
}

// Example requests built from the spec: required parameters and JSON bodies use sample values,
// and credentials are placeholders the user must replace.
export function requestSnippets(spec: SpecNode, { path, method }: Operation, origin: string): Snippets {
  const item = resolve(spec, spec.paths[path]), op = item[method], request = sampleRequest(spec, method, path);
  const query: [string, string][] = [], headers: [string, string][] = [];
  for (const p of parameters(spec, item, op)) {
    if (!p.required || !['query', 'header'].includes(p.in)) continue;
    (p.in === 'query' ? query : headers).push([p.name, scalar(sample(spec, p.schema || p))]);
  }
  const auth = credentials(spec, op);
  headers.push(...auth.headers); query.push(...auth.query);
  const body = request.body ? JSON.parse(request.body) : undefined;
  if (body !== undefined) headers.push(['Content-Type', 'application/json']);
  const search = new URLSearchParams(query).toString();
  const url = baseUrl(spec, origin) + request.path + (search ? '?' + search : '');
  const verb = method.toUpperCase();
  const curl = [`curl -X ${verb} ${shell(url)}`, ...headers.map(([name, value]) => `  -H ${shell(`${name}: ${value}`)}`), ...(body !== undefined ? [`  --data ${shell(JSON.stringify(body))}`] : [])].join(' \\\n');
  const headerObject = headers.length ? `\n  headers: {\n${headers.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`).join('\n')}\n  },` : '';
  const javascript = `const response = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(verb)},${headerObject}${body !== undefined ? `\n  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}),` : ''}\n});\nconsole.log(response.status, await response.text());\n`;
  const pythonArgs = [`    ${JSON.stringify(verb)},`, `    ${JSON.stringify(url)},`, ...(headers.length ? [`    headers=${python(Object.fromEntries(headers), '    ')},`] : []), ...(body !== undefined ? [`    json=${python(body, '    ')},`] : [])];
  return { url, curl: curl + '\n', javascript, python: `import requests\n\nresponse = requests.request(\n${pythonArgs.join('\n')}\n)\nprint(response.status_code, response.text)\n` };
}
