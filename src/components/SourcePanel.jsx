import { useRef, useState } from 'react';
import { DocumentHistory } from './DocumentHistory.jsx';

export function SourcePanel({ workbench: w, onLibrary }) {
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const authNote = w.session.loading ? '' : w.session.user ? '文件會安全保存至你的帳號。每次匯入都會新增一筆紀錄。' : w.session.configured ? '使用 Google 登入後，即可儲存文件及查看個人歷史。未登入仍可預覽。' : 'Google 登入尚待站主完成設定。目前僅可預覽，文件不會儲存。';
  function handlePaste(event) {
    if (w.busy) return;
    event.preventDefault();
    const input = event.currentTarget;
    const text = event.clipboardData.getData('text/plain');
    // Pass the next value explicitly so autosave never reads stale React state.
    w.pasteSource(input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd));
  }
  return <aside className="source-panel" aria-label="匯入 API 定義">
    <div className="panel-heading"><span className="eyebrow">API DEFINITION</span><h1>你的 API，清楚呈現。</h1><p>開啟 YAML 檔案，即可瀏覽互動文件。</p></div>
    <p id="auth-note" className="auth-note" role="status">{authNote}</p>
    <div id="dropzone" className={'dropzone' + (dragging ? ' dragging' : '')}
      onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragLeave={() => { if (--dragDepth.current <= 0) setDragging(false); }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault(); dragDepth.current = 0; setDragging(false);
        if (w.busy) return;
        if (event.dataTransfer.files.length !== 1) return w.reportError('請一次拖曳一個 API 定義檔案。');
        w.loadFile(event.dataTransfer.files[0]);
      }}>
      <span className="file-symbol" aria-hidden="true">{'{ }'}</span><strong>將檔案拖曳至此</strong>
      <span className="file-hint">.yaml、.yml 或 .json · 最大 5 MB</span>
      <button id="upload" className="button primary" type="button" disabled={w.busy} onClick={() => fileInput.current?.click()}>選擇檔案</button>
      <input id="file" ref={fileInput} type="file" accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml" hidden disabled={w.busy}
        onChange={event => { w.loadFile(event.target.files[0]); event.target.value = ''; }} />
    </div>
    <div className="editor-heading"><label htmlFor="source">或貼上 API 定義</label><button id="demo" type="button" className="text-button" disabled={w.busy} onClick={w.importExample}>載入範例</button></div>
    <textarea id="source" spellCheck={false} aria-describedby="editor-help" readOnly={w.busy} value={w.editor.source}
      placeholder={'openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\npaths: {}'}
      onChange={event => w.changeSource(event.target.value)} onPaste={handlePaste}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); w.save(); } }} />
    <p id="editor-help" className="shortcut">支援 Swagger 2.0 / OpenAPI 3.0、3.1<span>⌘ / Ctrl + Enter</span></p>
    {w.selectedId && w.session.user && <label className="version-note-input">版本說明（選填）<input value={w.versionNote} maxLength={200} disabled={w.busy} onChange={event => w.setVersionNote(event.target.value)} placeholder="例如：新增會員查詢端點" /></label>}
    <button id="render" className="button render-button" type="button" disabled={w.busy} onClick={() => w.save()}>{w.selectedId && w.session.user ? `儲存新版本（目前 v${w.currentVersion}）` : '儲存並更新文件'}</button>
    {w.selectedId && w.session.user && <button type="button" className="text-button save-copy" disabled={w.busy} onClick={() => w.save(w.editor, true)}>另存為新文件</button>}
    <div id="status" className="status" role="status" aria-live="polite">{w.status}</div>
    {w.error && <div id="error" className="error" role="alert">{w.error}</div>}
    <p className="local-note">登入後，上傳或貼上文件會保存到你的個人歷史。外部參照及「Try it out」會連線至文件指定的網址。</p>
    <DocumentHistory session={w.session} busy={w.busy} items={w.items} nextOffset={w.nextOffset} selectedId={w.selectedId} historyError={w.historyError}
      onLibrary={onLibrary} onRefresh={w.refreshHistory} onOpen={w.openDocument} onDelete={w.deleteDocument} />
  </aside>;
}
