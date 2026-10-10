import { useRef, useState } from 'react';
import { SourcePanel } from './SourcePanel.jsx';
import { DocumentPreview } from './DocumentPreview.jsx';
export function EditorWorkspace({ workbench, onLibrary }) {
  const [split, setSplit] = useState(46), [view, setView] = useState('split');
  const root = useRef(null);
  const adjust = event => {
    const bounds = root.current.getBoundingClientRect();
    setSplit(Math.max(28, Math.min(68, (event.clientX - bounds.left) / bounds.width * 100)));
  };
  return <div className="editor-workspace">
    <div className="workspace-strip"><div><strong>API Editor</strong><span>Swagger 2.0 / OpenAPI 3.0、3.1</span></div><div className="view-options" aria-label="工作台版面">{[['edit','編輯'],['split','並排'],['preview','預覽']].map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div></div>
    <main ref={root} className={'workspace editor-layout view-' + view} style={{ '--editor-width': split + '%' }}>
      <SourcePanel workbench={workbench} onLibrary={onLibrary} />
      <div className="pane-divider" role="separator" aria-label="調整編輯區寬度" aria-orientation="vertical" aria-valuenow={Math.round(split)} aria-valuemin={28} aria-valuemax={68} tabIndex={0}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); adjust(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) adjust(event); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); setSplit(value => event.key === 'Home' ? 28 : event.key === 'End' ? 68 : Math.max(28, Math.min(68, value + (event.key === 'ArrowLeft' ? -2 : 2)))); } }} />
      <DocumentPreview preview={workbench.preview} workbench={workbench} />
    </main>
  </div>;
}
