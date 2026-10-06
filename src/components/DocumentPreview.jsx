import { useEffect, useRef, useState } from 'react';
import { ExportMenu } from './ExportMenu.jsx';
import { ShareDialog } from './ShareDialog.jsx';
import { VersionHistory } from './VersionHistory.jsx';

function SwaggerPreview({ spec, readOnly }) {
  const container = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const root = container.current;
    setError('');
    if (!spec) return;
    if (!window.SwaggerUIBundle) { setError('文件元件載入失敗，請重新整理頁面。'); return; }
    // Swagger owns this child only; React owns the wrapper and the rest of the UI.
    // A new instance per document also clears the previous API's authorization state.
    const mount = document.createElement('div');
    root.append(mount);
    let ui;
    try {
      const SwaggerUIBundle = window.SwaggerUIBundle;
      ui = SwaggerUIBundle({ spec, domNode: mount, presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout', validatorUrl: null,
        persistAuthorization: false, deepLinking: false, docExpansion: 'list', defaultModelsExpandDepth: 1,
        displayRequestDuration: true, showExtensions: true,
        supportedSubmitMethods: readOnly ? [] : ['get','put','post','delete','options','head','patch','trace'], tryItOutEnabled: false });
    } catch { setError('文件元件載入失敗，請重新整理頁面。'); }
    return () => { ui?.destroy?.(); mount.remove(); };
  }, [spec, readOnly]);
  return <>{error && <div className="error" role="alert">{error}</div>}<div id="swagger-ui" ref={container} /></>;
}

export function DocumentPreview({ preview, workbench, readOnly = false }) {
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const spec = preview?.spec;
  return <section className="document-panel" aria-label="Swagger API 文件">
    <div className="document-toolbar"><div><span className="document-label">文件預覽</span><span id="filename" className="filename">{preview?.fileName || ''}</span></div>
      {spec && <div className="document-actions"><ExportMenu preview={preview} />{workbench?.selectedId && workbench.session.user && <button className="text-button" disabled={workbench.busy} onClick={() => setVersionsOpen(true)}>版本歷史 · v{workbench.currentVersion}</button>}{workbench?.selectedId && workbench.session.user && <button className="text-button" disabled={workbench.busy} onClick={() => setShareOpen(true)}>發布到分享區</button>}<span id="spec-version" className="version-chip">{spec.swagger ? 'Swagger 2.0' : `OpenAPI ${spec.openapi}`}</span></div>}
    </div>
    {versionsOpen && workbench?.selectedId && workbench.session.user && <VersionHistory key={workbench.selectedId} workbench={workbench} onClose={() => setVersionsOpen(false)} />}
    {shareOpen && workbench?.selectedId && workbench.session.user && <ShareDialog key={workbench.selectedId} workbench={workbench} onClose={() => setShareOpen(false)} />}
    <SwaggerPreview spec={spec} readOnly={readOnly} />
    <footer className="document-footer">以 <a href="https://swagger.io/tools/swagger-ui/" target="_blank" rel="noopener noreferrer">Swagger UI</a> 呈現 · {readOnly ? '分享文件為唯讀；外部參照可能需要網路連線。' : 'API 測試需目標伺服器允許 CORS；本機檔案請使用完整的伺服器網址。'}</footer>
  </section>;
}
