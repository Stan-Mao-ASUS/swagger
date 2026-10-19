import { typescriptDefinitions } from './typescript.ts';
import type { SpecNode } from '../../shared/types.ts';
export type ExportFormat = 'source' | 'json' | 'html' | 'typescript';
export interface Exportable { spec?: SpecNode; source?: string; fileName?: string }
export interface ExportedFile { name: string; type: string; content: string }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
const pretty = (value: unknown) => escape(JSON.stringify(value, null, 2));
const methods = /^(get|put|post|delete|options|head|patch|trace)$/;
export function offlineHtml(spec: SpecNode): string {
  const title = escape(spec.info.title);
  const operations = Object.entries<any>(spec.paths || {}).flatMap(([path, item]) => Object.entries<any>(item || {}).filter(([method]) => methods.test(method)).map(([method, operation]) => ({ path, method, operation, common: item.parameters })));
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title} — API 文件</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#141416;color:#e4e4e7;font:16px/1.7 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.4}h2{font-size:22px}a{color:#c3d4ef}p{white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#a1a1aa}nav{display:grid;gap:8px;margin:28px 0}article,details{border:1px solid #343438;border-radius:8px;margin:16px 0;background:#1b1b1e}article{padding:22px}details{padding:12px 16px}summary{cursor:pointer;overflow-wrap:anywhere}code{overflow-wrap:anywhere}pre{font:14px/1.65 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#161619;padding:16px;border-radius:6px}b.method{display:inline-block;font-size:14px;background:#303038;padding:3px 9px;border-radius:4px;margin-right:10px}article:target{border-color:#a1a1aa}footer{color:#a1a1aa;margin-top:32px}@media print{:root{color-scheme:light}body,article,details,pre{background:white;color:black}nav{display:none}}
</style></head><body><main><h1>${title}</h1><p class="meta">${escape(spec.openapi ? `OpenAPI ${spec.openapi}` : 'Swagger 2.0')} · API ${escape(spec.info.version)} · ${operations.length} 個端點</p><p>${escape(spec.info.description)}</p><p class="meta">離線唯讀文件。外部參照保留原網址，未下載外部內容；API 請求不會執行。</p>
<nav aria-label="API 端點">${operations.map(({ path, method, operation }, i) => `<a href="#endpoint-${i}">${escape(method.toUpperCase())} ${escape(path)} — ${escape(operation?.summary)}</a>`).join('')}</nav>
${operations.map(({ path, method, operation, common }, i) => `<article id="endpoint-${i}"><h2><b class="method">${escape(method.toUpperCase())}</b><code>${escape(path)}</code></h2><p>${escape(operation?.summary)}</p><p>${escape(operation?.description)}</p>${common ? `<details><summary>共用參數</summary><pre>${pretty(common)}</pre></details>` : ''}<details open><summary>參數、請求與回應</summary><pre>${pretty(operation)}</pre></details></article>`).join('')}
<details><summary>資料模型與定義</summary><pre>${pretty(spec.components || spec.definitions || {})}</pre></details><details><summary>完整 OpenAPI JSON（含所有設定與參照）</summary><pre>${pretty(spec)}</pre></details><footer>由 YAML Workbench 匯出 · 可直接在瀏覽器開啟，無須登入或連線。</footer></main></body></html>`;
}
const safeName = (fileName?: string) => (fileName || 'api.yaml').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').slice(0, 200);
export const baseName = (fileName?: string) => safeName(fileName).replace(/\.(ya?ml|json)$/i, '') || 'api';
export function exportFile(preview: Exportable, format: ExportFormat | string): ExportedFile {
  const original = safeName(preview.fileName), base = baseName(preview.fileName);
  if (format === 'source') return { name: original, type: 'text/plain;charset=utf-8', content: preview.source ?? '' };
  const { spec } = preview;
  if (!spec) throw new Error('不支援的匯出格式。');
  if (format === 'json') return { name: `${base}.json`, type: 'application/json;charset=utf-8', content: JSON.stringify(spec, null, 2) + '\n' };
  if (format === 'html') return { name: `${base}.html`, type: 'text/html;charset=utf-8', content: offlineHtml(spec) };
  if (format === 'typescript') return { name: `${base}.d.ts`, type: 'text/plain;charset=utf-8', content: typescriptDefinitions(spec) };
  throw new Error('不支援的匯出格式。');
}
