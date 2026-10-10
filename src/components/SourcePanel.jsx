import { useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { undo, redo } from '@codemirror/commands';
import { CodeEditor } from './CodeEditor.jsx';
import { Modal } from './Modal.jsx';

export function SourcePanel({ workbench: w, onLibrary }) {
  const fileInput = useRef(null), editorRef = useRef(null);
  const [dragging, setDragging] = useState(false), [wrap, setWrap] = useState(false), [conversion, setConversion] = useState(null);
  const dragDepth = useRef(0);
  function jump(d) {
    const view = editorRef.current; if (!view) return;
    const line = view.state.doc.line(Math.min(d.line, view.state.doc.lines));
    const position = Math.min(line.to, line.from + d.column - 1);
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) }); view.focus();
  }
  return <aside className={'source-panel editor-panel' + (dragging ? ' dragging' : '')} aria-label="API 定義編輯區"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragLeave={() => { if (--dragDepth.current <= 0) setDragging(false); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files.length !== 1) return w.reportError('請一次拖曳一個檔案。'); w.loadFile(event.dataTransfer.files[0]); }}>
    <div className="editor-filebar"><span className="editor-file-name" title={w.editor.fileName}>{w.editor.fileName}</span><span className="draft-label">{w.busy ? '處理中…' : w.dirty ? '未儲存' : `已儲存 v${w.currentVersion}`}</span></div>
    <div className="editor-tools" aria-label="編輯器工具列">
      <button disabled={w.busy} onClick={() => fileInput.current?.click()}>開啟檔案</button>
      <button disabled={w.busy} onClick={w.importExample}>範例</button>
      <button disabled={w.busy || !w.session.user} onClick={onLibrary}>我的文件</button>
      <span className="tool-divider" />
      <button title="搜尋與取代（⌘ / Ctrl + F）" onClick={() => openSearchPanel(editorRef.current)}>搜尋</button>
      <button title="復原（⌘ / Ctrl + Z）" disabled={w.busy} onClick={() => undo(editorRef.current)}>復原</button>
      <button title="重做" disabled={w.busy} onClick={() => redo(editorRef.current)}>重做</button>
      <button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>換行</button>
      <select aria-label="轉換格式" value="" disabled={w.busy} onChange={event => setConversion(event.target.value)}><option value="" disabled>轉換格式</option><option value="yaml">YAML</option><option value="json">JSON</option></select>
      <input id="file" ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden disabled={w.busy} onChange={event => { w.loadFile(event.target.files[0]); event.target.value = ''; }} />
    </div>
    <CodeEditor key={`${w.session.user?.id || 'guest'}:${w.selectedId || 'draft'}`} editorRef={editorRef} source={w.editor.source} busy={w.busy} diagnostics={w.diagnostics} wrap={wrap} onChange={w.changeSource} onPaste={w.pasteSource} onSave={() => w.save()} />
    <div className="editor-diagnostics" aria-live="polite">
      <div className="validation-summary">{w.validating ? '檢查中…' : w.diagnostics.length ? '定義有錯誤 · 預覽保留最後有效內容' : '語法與必要欄位檢查通過'}<span>{w.editor.source.split('\n').length} 行</span></div>
      {w.diagnostics.map((d, i) => <button key={i} className="diagnostic-item" onClick={() => jump(d)}>第 {d.line} 行，第 {d.column} 欄：{d.message}</button>)}
    </div>
    <div className="editor-savebar">
      {w.selectedId && w.session.user && <input aria-label="版本說明" value={w.versionNote} maxLength={200} disabled={w.busy} onChange={event => w.setVersionNote(event.target.value)} placeholder="版本說明（選填）" />}
      <button id="render" className="button render-button" disabled={w.busy || !!w.diagnostics.length || w.validating} onClick={() => w.save()}>{w.session.user ? w.selectedId ? '儲存新版本' : '儲存文件' : '預覽文件'}</button>
      {w.selectedId && w.session.user && <button className="text-button" disabled={w.busy || !!w.diagnostics.length || w.validating} onClick={() => w.save(w.editor, true)}>另存新文件</button>}
    </div>
    <div className="editor-footnotes"><p id="editor-help">⌘ / Ctrl + Enter 儲存 · 拖入 YAML / JSON 開啟 · 最大 5 MB</p><div id="status" role="status">{w.status}</div>{!w.session.user && <p>登入後可保存文件；未登入的編輯不會同步至帳號。</p>}{w.error && <div id="error" className="error" role="alert">{w.error}</div>}</div>
    {dragging && <div className="editor-drop-overlay">放開以匯入文件</div>}
    {conversion && <Modal title="轉換文件格式" onClose={() => setConversion(null)}><p>轉為 {conversion.toUpperCase()} 會重新排版，移除 YAML 註解及 anchor。儲存前仍可用「復原」回到原始內容。</p><button className="button primary" onClick={() => { w.convert(conversion); setConversion(null); }}>轉換為 {conversion.toUpperCase()}</button></Modal>}
  </aside>;
}
