import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { undo, redo } from '@codemirror/commands';
import { CodeEditor } from './CodeEditor.tsx';
import { downloadFile } from '../lib/download.ts';
import { Modal } from './Modal.tsx';
import { STYLE_RULES } from '../lib/lint.ts';
import { useDirty, useWorkbench } from '../state/workbench.ts';
import { useCloudDraft, useCloudDraftView } from '../state/cloud-draft.ts';
import { useSession } from '../state/queries.ts';
import type { Diagnostic } from '../../shared/types.ts';

export function SourcePanel({ onLibrary }: { onLibrary: () => void }) {
  const w = useWorkbench(useShallow(state => ({
    editor: state.editor, busy: state.busy, selectedId: state.selectedId, currentVersion: state.currentVersion, draftBaseVersion: state.draftBaseVersion,
    versionNote: state.versionNote, diagnostics: state.diagnostics, style: state.style, validating: state.validating, styleRulesOff: state.styleRulesOff, status: state.status, error: state.error,
  })));
  const actions = useWorkbench.getState(), draftActions = useCloudDraft.getState();
  const draft = useCloudDraftView(), dirty = useDirty(), { user } = useSession();
  const fileInput = useRef<HTMLInputElement>(null), editorRef = useRef<EditorView | null>(null);
  const [dragging, setDragging] = useState(false), [wrap, setWrap] = useState(false), [conversion, setConversion] = useState<'yaml' | 'json' | null>(null);
  const dragDepth = useRef(0);
  const errorCount = w.diagnostics.filter(d => d.severity !== 'warning').length;
  const marks = useMemo(() => [...w.diagnostics, ...w.style], [w.diagnostics, w.style]);
  const status = !dirty && w.status.startsWith('未儲存的變更') ? '目前內容與已儲存版本一致。' : w.status;
  const reportError = (error: Error) => actions.reportError(error.message);
  function jump(d: Diagnostic) {
    const view = editorRef.current; if (!view) return;
    const line = view.state.doc.line(Math.min(d.line, view.state.doc.lines));
    const position = Math.min(line.to, line.from + d.column - 1);
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) }); view.focus();
  }
  return <aside className={'source-panel editor-panel' + (dragging ? ' dragging' : '')} aria-label="API 定義編輯區"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragLeave={() => { if (--dragDepth.current <= 0) setDragging(false); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files.length !== 1) return actions.reportError('請一次拖曳一個檔案。'); actions.loadFile(event.dataTransfer.files[0]); }}>
    <div className="editor-filebar"><span className="editor-file-name" title={w.editor.fileName}>{w.editor.fileName}</span><span className="draft-label">{w.busy ? '處理中…' : dirty ? '未儲存' : `已儲存 v${w.currentVersion}`}</span></div>
    <div className="editor-tools" aria-label="編輯器工具列">
      <button disabled={w.busy} onClick={() => fileInput.current?.click()}>開啟檔案</button>
      <button disabled={w.busy} onClick={() => actions.importExample()}>範例</button>
      <button disabled={w.busy || !user} onClick={onLibrary}>我的文件</button>
      <span className="tool-divider" />
      <button onClick={() => downloadFile(w.editor, 'source')}>下載草稿</button>
      <button title="搜尋與取代（⌘ / Ctrl + F）" onClick={() => editorRef.current && openSearchPanel(editorRef.current)}>搜尋</button>
      <button title="復原（⌘ / Ctrl + Z）" disabled={w.busy} onClick={() => editorRef.current && undo(editorRef.current)}>復原</button>
      <button title="重做" disabled={w.busy} onClick={() => editorRef.current && redo(editorRef.current)}>重做</button>
      <button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>換行</button>
      <select aria-label="轉換格式" value="" disabled={w.busy} onChange={event => setConversion(event.target.value as 'yaml' | 'json')}><option value="" disabled>轉換格式</option><option value="yaml">YAML</option><option value="json">JSON</option></select>
      <input id="file" ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden disabled={w.busy} onChange={event => { actions.loadFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    <div className="draft-status" role="status">{user ? draft.status : '登入後即可自動保存雲端草稿。'}
      {user && !draft.ready && !draft.recovery && <button className="text-button" onClick={draftActions.retry}>重新讀取草稿</button>}
      {draft.recovery && <div className="draft-recovery"><strong>找到 {new Date(draft.recovery.updatedAt).toLocaleString('zh-TW')} 的草稿</strong><p>恢復後可繼續編輯，正式版本不會被改動。</p><button className="button primary" onClick={draftActions.recover}>恢復草稿</button><button className="text-button" onClick={() => draftActions.discard().catch(reportError)}>捨棄草稿</button></div>}
      {draft.conflict && <p>另一個分頁已變更草稿。請先下載草稿保留目前內容，再重新讀取。<button className="text-button" onClick={draftActions.retry}>重新讀取草稿</button></p>}
      {draft.status.startsWith('草稿未同步') && !draft.conflict && <button className="text-button" onClick={() => draftActions.flush().catch(reportError)}>重試保存</button>}
      {w.draftBaseVersion && w.draftBaseVersion !== w.currentVersion && <p>草稿基於 v{w.draftBaseVersion}，目前文件為 v{w.currentVersion}。請另存新文件以保留兩份內容。</p>}
    </div>
    <CodeEditor key={`${user?.id || 'guest'}:${w.selectedId || 'draft'}`} editorRef={editorRef} source={w.editor.source} busy={w.busy || !draft.ready} diagnostics={marks} wrap={wrap} onChange={actions.changeSource} onPaste={actions.pasteSource} onSave={() => actions.save()} />
    <div className="editor-diagnostics" aria-live="polite">
      <div className="validation-summary">{w.validating ? '檢查中…' : (errorCount ? `${errorCount} 個錯誤 · 預覽保留最後有效內容` : w.diagnostics.length ? `${w.diagnostics.length} 個提醒 · 外部定義尚未驗證` : 'OpenAPI 結構與語意檢查通過') + (w.style.length ? ` · ${w.style.length} 個風格建議` : '')}<span>{w.editor.source.split('\n').length} 行</span></div>
      <details className="style-rules"><summary>風格規則 · 已啟用 {STYLE_RULES.length - w.styleRulesOff.filter(id => STYLE_RULES.some(r => r.id === id)).length}／{STYLE_RULES.length}</summary><p>風格建議只是提醒，不會阻擋儲存或預覽。設定保存在這個瀏覽器。</p>
        {STYLE_RULES.map(rule => <label key={rule.id}><input type="checkbox" checked={!w.styleRulesOff.includes(rule.id)} onChange={() => actions.toggleStyleRule(rule.id)} />{rule.label}</label>)}</details>
      {marks.map((d, i) => <button key={i} className={'diagnostic-item ' + (d.severity || 'error')} onClick={() => jump(d)}>第 {d.line} 行，第 {d.column} 欄：{d.message}</button>)}
    </div>
    <div className="editor-savebar">
      {w.selectedId && user && <input aria-label="版本說明" value={w.versionNote} maxLength={200} disabled={w.busy} onChange={event => actions.setVersionNote(event.target.value)} placeholder="版本說明（選填）" />}
      <button id="render" className="button render-button" disabled={w.busy || !draft.ready || !!errorCount || w.validating} onClick={() => actions.save()}>{user ? w.selectedId ? '儲存新版本' : '儲存文件' : '預覽文件'}</button>
      {w.selectedId && user && <button className="text-button" disabled={w.busy || !draft.ready || !!errorCount || w.validating} onClick={() => actions.save(w.editor, true)}>另存新文件</button>}
    </div>
    <div className="editor-footnotes"><p id="editor-help">⌘ / Ctrl + Enter 儲存 · 拖入 YAML / JSON 開啟 · 最大 5 MB</p><div id="status" role="status">{status}</div>{!user && <p>登入後可保存文件；未登入的編輯不會同步至帳號。</p>}{w.error && <div id="error" className="error" role="alert">{w.error}</div>}</div>
    {dragging && <div className="editor-drop-overlay">放開以匯入文件</div>}
    {conversion && <Modal title="轉換文件格式" onClose={() => setConversion(null)}><p>轉為 {conversion.toUpperCase()} 會重新排版，移除 YAML 註解及 anchor。儲存前仍可用「復原」回到原始內容。</p><button className="button primary" onClick={() => { actions.convert(conversion); setConversion(null); }}>轉換為 {conversion.toUpperCase()}</button></Modal>}
  </aside>;
}
