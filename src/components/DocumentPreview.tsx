import { useEffect, useRef, useState } from 'react';
import { ExportMenu } from './ExportMenu.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { MockDialog } from './MockDialog.tsx';
import { VersionHistory } from './VersionHistory.tsx';
import { useShallow } from 'zustand/react/shallow';
import { useDirty, useWorkbench } from '../state/workbench.ts';
import { useSession } from '../state/queries.ts';
import type { Exportable } from '../lib/export.ts';
import type { SpecNode } from '../../shared/types.ts';

declare global { interface Window { SwaggerUIBundle?: any } }

function SwaggerPreview({ spec, readOnly }: { spec: SpecNode | undefined; readOnly: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const root = container.current!;
    setError('');
    if (!spec) return;
    if (!window.SwaggerUIBundle) { setError('文件元件載入失敗，請重新整理頁面。'); return; }
    // Swagger owns this child only; React owns the wrapper and the rest of the UI.
    // A new instance per document also clears the previous API's authorization state.
    const mount = document.createElement('div');
    root.append(mount);
    let ui: { destroy?(): void } | undefined;
    try {
      const SwaggerUIBundle = window.SwaggerUIBundle;
      ui = SwaggerUIBundle({ spec, domNode: mount, presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout', validatorUrl: null,
        persistAuthorization: false, deepLinking: false, docExpansion: 'list', defaultModelsExpandDepth: 1,
        displayRequestDuration: true, showExtensions: true, filter: true,
        supportedSubmitMethods: readOnly ? [] : ['get','put','post','delete','options','head','patch','trace'], tryItOutEnabled: false });
    } catch { setError('文件元件載入失敗，請重新整理頁面。'); }
    return () => { ui?.destroy?.(); mount.remove(); };
  }, [spec, readOnly]);
  return <>{error && <div className="error" role="alert">{error}</div>}<div id="swagger-ui" ref={container} /></>;
}

// The editor preview shows owner tools; a read-only shared page shows only the document.
export function DocumentPreview({ preview, readOnly = false }: { preview: (Exportable & { spec: SpecNode }) | null; readOnly?: boolean }) {
  const { user } = useSession(), dirty = useDirty();
  const { selectedId, busy, currentVersion, validating, diagnostics } = useWorkbench(useShallow(state => ({ selectedId: state.selectedId, busy: state.busy, currentVersion: state.currentVersion, validating: state.validating, diagnostics: state.diagnostics })));
  const ownedDocument = !readOnly && user ? selectedId : null;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [mockOpen, setMockOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const spec = preview?.spec;
  return <section className="document-panel" aria-label="Swagger API 文件">
    <div className="document-toolbar"><div><span className="document-label">文件預覽</span><span id="filename" className="filename">{preview?.fileName || ''}</span></div>
      {spec && <div className="document-actions"><ExportMenu preview={preview} />{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setVersionsOpen(true)}>版本歷史 · v{currentVersion}</button>}{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setShareOpen(true)}>分享權限</button>}{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setMockOpen(true)}>Mock API</button>}<span id="spec-version" className="version-chip">{spec.swagger ? 'Swagger 2.0' : `OpenAPI ${spec.openapi}`}</span></div>}
    </div>
    {versionsOpen && ownedDocument && <VersionHistory key={ownedDocument} documentId={ownedDocument} onClose={() => setVersionsOpen(false)} />}
    {mockOpen && ownedDocument && <MockDialog key={ownedDocument} documentId={ownedDocument} onClose={() => setMockOpen(false)} />}
    {shareOpen && ownedDocument && <ShareDialog key={ownedDocument} documentId={ownedDocument} onClose={() => setShareOpen(false)} />}
    {!readOnly && (validating || diagnostics.some(d => d.severity !== 'warning')) && <div className="preview-stale" role="status">{validating ? '正在更新預覽…' : '編輯內容有錯誤，下方為最後一次有效預覽。'}</div>}
    {!readOnly && dirty && selectedId && <div className="preview-draft-note">預覽包含尚未儲存的變更。分享區仍顯示已發布版本。</div>}
    <SwaggerPreview spec={spec} readOnly={readOnly} />
    <footer className="document-footer">以 <a href="https://swagger.io/tools/swagger-ui/" target="_blank" rel="noopener noreferrer">Swagger UI</a> 呈現 · {readOnly ? '分享文件為唯讀；外部參照可能需要網路連線。' : 'API 測試需目標伺服器允許 CORS；本機檔案請使用完整的伺服器網址。'}</footer>
  </section>;
}
