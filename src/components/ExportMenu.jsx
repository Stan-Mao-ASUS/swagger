import { useState } from 'react';
import { downloadFile } from '../lib/export.js';
export function ExportMenu({ preview }) {
  const [error, setError] = useState('');
  return <div className="export-control"><select aria-label="下載目前預覽" value="" disabled={!preview} onChange={event => {
    try { downloadFile(preview, event.target.value); setError(''); } catch (error) { setError(error.message); }
  }}><option value="" disabled>下載／匯出</option><option value="source">原始 YAML／JSON</option><option value="json">轉換為 JSON</option><option value="html">離線 HTML 文件</option></select>{error && <span className="error" role="alert">{error}</span>}</div>;
}
