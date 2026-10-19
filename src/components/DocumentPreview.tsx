import { useEffect, useRef, useState } from 'react';
import { ExportMenu } from './ExportMenu.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { MockDialog } from './MockDialog.tsx';
import { VersionHistory } from './VersionHistory.tsx';
import { RequestSnippets } from './RequestSnippets.tsx';
import { useShallow } from 'zustand/react/shallow';
import { useDirty, useWorkbench } from '../state/workbench.ts';
import { useSession } from '../state/queries.ts';
import type { Exportable } from '../lib/export.ts';
import type { SpecNode } from '../../shared/types.ts';

declare global { interface Window { SwaggerUIBundle?: any } }

interface SwaggerRequest { url: string; headers: Record<string, string>; loadSpec?: boolean }
function SwaggerPreview({ spec, readOnly, proxy = false }: { spec: SpecNode | undefined; readOnly: boolean; proxy?: boolean }) {
  const container = useRef<HTMLDivElement>(null), proxyRef = useRef(proxy);
  proxyRef.current = proxy;
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
        supportedSubmitMethods: readOnly ? [] : ['get','put','post','delete','options','head','patch','trace'], tryItOutEnabled: false,
        // Only Try it out calls are proxied; Swagger UI's own spec and $ref loading stays in the browser.
        requestInterceptor: (request: SwaggerRequest) => {
          if (proxyRef.current && !request.loadSpec && /^https?:/i.test(request.url) && !request.url.startsWith(window.location.origin + '/')) { request.headers['x-proxy-url'] = request.url; request.url = '/api/proxy'; }
          return request;
        } });
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
  const proxy = useWorkbench(state => state.proxyTryItOut), canProxy = !readOnly && !!user;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [mockOpen, setMockOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false), [snippetsOpen, setSnippetsOpen] = useState(false);
  const spec = preview?.spec;
  return <section className="document-panel" aria-label="Swagger API 文件">
    <div className="document-toolbar"><div><span className="document-label">文件預覽</span><span id="filename" className="filename">{preview?.fileName || ''}</span></div>
      {spec && <div className="document-actions"><ExportMenu preview={preview} /><button className="text-button" onClick={() => setSnippetsOpen(true)}>程式碼範例</button>{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setVersionsOpen(true)}>版本歷史 · v{currentVersion}</button>}{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setShareOpen(true)}>分享權限</button>}{ownedDocument && <button className="text-button" disabled={busy} onClick={() => setMockOpen(true)}>Mock API</button>}<span id="spec-version" className="version-chip">{spec.swagger ? 'Swagger 2.0' : `OpenAPI ${spec.openapi}`}</span></div>}
    </div>
    {snippetsOpen && spec && <RequestSnippets spec={spec} onClose={() => setSnippetsOpen(false)} />}
    {versionsOpen && ownedDocument && <VersionHistory key={ownedDocument} documentId={ownedDocument} onClose={() => setVersionsOpen(false)} />}
    {mockOpen && ownedDocument && <MockDialog key={ownedDocument} documentId={ownedDocument} onClose={() => setMockOpen(false)} />}
    {shareOpen && ownedDocument && <ShareDialog key={ownedDocument} documentId={ownedDocument} onClose={() => setShareOpen(false)} />}
    {!readOnly && (validating || diagnostics.some(d => d.severity !== 'warning')) && <div className="preview-stale" role="status">{validating ? '正在更新預覽…' : '編輯內容有錯誤，下方為最後一次有效預覽。'}</div>}
    {!readOnly && dirty && selectedId && <div className="preview-draft-note">預覽包含尚未儲存的變更。分享區仍顯示已發布版本。</div>}
    {canProxy && spec && <label className="proxy-toggle"><input type="checkbox" checked={proxy} onChange={event => useWorkbench.setState({ proxyTryItOut: event.target.checked })} /><span>Try it out 經由本站代理（略過 CORS）。不轉送本站 Cookie；你在 Authorize 填寫的授權標頭會送到目標 API。本機、私人網路與本站位址會被拒絕，請求與回應上限 5 MB、15 秒。</span></label>}
    <SwaggerPreview spec={spec} readOnly={readOnly} proxy={canProxy && proxy} />
    <footer className="document-footer">以 <a href="https://swagger.io/tools/swagger-ui/" target="_blank" rel="noopener noreferrer">Swagger UI</a> 呈現 · {readOnly ? '分享文件為唯讀；外部參照可能需要網路連線。' : canProxy && proxy ? 'API 測試經由本站代理送出，不受 CORS 限制。' : 'API 測試需目標伺服器允許 CORS；本機檔案請使用完整的伺服器網址。'}</footer>
  </section>;
}
