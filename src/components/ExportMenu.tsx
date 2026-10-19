import { useState } from 'react';
import { downloadFile } from '../lib/download.ts';
import type { ExportFormat, Exportable } from '../lib/export.ts';
export function ExportMenu({ preview }: { preview: Exportable | null }) {
  const [error, setError] = useState('');
  return <div className="export-control"><select aria-label="下載目前預覽" value="" disabled={!preview} onChange={event => {
    try { downloadFile(preview!, event.target.value as ExportFormat); setError(''); } catch (error) { setError((error as Error).message); }
  }}><option value="" disabled>下載／匯出</option><option value="source">原始 YAML／JSON</option><option value="json">轉換為 JSON</option><option value="html">離線 HTML 文件</option><option value="typescript">TypeScript 型別（.d.ts）</option></select>{error && <span className="error" role="alert">{error}</span>}</div>;
}
