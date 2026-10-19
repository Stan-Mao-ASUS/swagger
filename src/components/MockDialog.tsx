import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from './Modal.tsx';
import { METHODS, resolve } from '../../shared/spec-tools.ts';
import { mockControls, mockResponse, sampleRequest, validateMockRequest, type MockResult } from '../../shared/mock.ts';
import { documentKey, jsonBody, queryClient, request } from '../state/query-client.ts';
import { useMock, useUserId, useVersion, useVersions } from '../state/queries.ts';
import { useWorkbench } from '../state/workbench.ts';
import type { MockConfig } from '../../shared/types.ts';
export function MockDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const currentVersion = useWorkbench(state => state.currentVersion) ?? 1, userId = useUserId();
  const mockQuery = useMock(documentId), history = useVersions(documentId);
  const ready = mockQuery.isSuccess && history.isSuccess, mock = mockQuery.data ?? null;
  const versions = history.data?.pages.flatMap(page => page.versions) ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => { if (ready && chosen === null) setChosen(mock?.version || currentVersion); }, [ready]);
  const version = chosen ?? currentVersion;
  const snapshotQuery = useVersion(documentId, version), snapshot = snapshotQuery.data;
  const [days, setDays] = useState(7), [confirmed, setConfirmed] = useState(false), [endpoint, setEndpoint] = useState('');
  const [statusCode, setStatusCode] = useState(''), [exampleName, setExampleName] = useState('');
  const [query, setQuery] = useState(''), [body, setBody] = useState(''), [validate, setValidate] = useState(true);
  const [delay, setDelay] = useState(''), [failRate, setFailRate] = useState(''), [failStatus, setFailStatus] = useState('');
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [status, setStatus] = useState(''), [result, setResult] = useState<{ status: number; body: string } | null>(null);
  const pending = useRef(false), testRequest = useRef<AbortController | null>(null), base = `/api/documents/${documentId}`;
  const error = actionError || mockQuery.error?.message || history.error?.message || snapshotQuery.error?.message || '';
  const setMock = (value: MockConfig | null) => queryClient.setQueryData(documentKey(userId, documentId, 'mock'), value);
  const enable = useMutation({ mutationFn: () => request<{ mock: MockConfig }>(base + '/mock', jsonBody('PUT', { version, expiresInDays: days, confirmPublic: true })), onSuccess: data => setMock(data.mock) });
  const disable = useMutation({ mutationFn: () => request(base + '/mock', { method: 'DELETE' }), onSuccess: () => setMock(null) });
  useEffect(() => () => testRequest.current?.abort(), []);
  useEffect(() => { setConfirmed(false); setEndpoint(''); setResult(null); setStatusCode(''); setExampleName(''); }, [version]);
  async function action(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setActionError(''); setStatus('');
    try { await fn(); } catch (e) { setActionError((e as Error).message); } finally { pending.current = false; setBusy(false); }
  }
  const ops: { path: string; method: string; label: string }[] = [];
  for (const [path, raw] of Object.entries<unknown>(snapshot?.spec.paths || {})) {
    try { const item = resolve(snapshot!.spec, raw); for (const method of METHODS) if (method !== 'trace' && item?.[method]) ops.push({ path, method, label: method.toUpperCase() + ' ' + path }); } catch {}
  }
  const selected = ops.find(o => o.label === endpoint) || ops[0];
  const requestSample = selected && snapshot ? sampleRequest(snapshot.spec, selected.method, selected.path) : null;
  useEffect(() => { setBody(requestSample?.body || ''); }, [snapshot, selected?.label]);
  const testPath = requestSample?.path || '/', method = selected?.method.toUpperCase() ?? 'GET';
  const takesBody = !!selected && !['GET', 'HEAD', 'OPTIONS'].includes(method) && (!!requestSample?.body || ['POST', 'PUT', 'PATCH'].includes(method));
  const sendBody = takesBody && body.trim() !== '';
  const mockBase = mock ? `${window.location.origin}/mock/${mock.id}` : '';
  const params = new URLSearchParams(query);
  for (const [name, value] of [['__status', statusCode], ['__example', exampleName], ['__delay', delay], ['__fail', failRate], ['__failStatus', failStatus], ['__validate', validate ? '' : 'off']]) if (value) params.set(name, value);
  const testUrl = mockBase + testPath + (params.size ? '?' + params : '');
  const active = mock && Date.parse(mock.expiresAt) > Date.now();
  let sample: (Partial<MockResult> & { error?: string }) | undefined;
  if (selected && snapshot) {
    try {
      const controls = mockControls(params);
      const issues = controls.validate ? validateMockRequest(snapshot.spec, method, testPath, { query: new URLSearchParams(query), headers: new Headers(sendBody ? { 'content-type': 'application/json' } : {}), body: sendBody ? body : '' }) : [];
      sample = issues.length ? { error: '請求不符合規格（HTTP 400）：\n' + issues.map(issue => `${issue.at}：${issue.message}`).join('\n') } : mockResponse(snapshot.spec, method, testPath, controls.status, controls.example);
    } catch (e) { sample = { error: (e as Error).message }; }
  }
  return <Modal wide title="Mock API" onClose={() => { if (!pending.current) onClose(); }}>
    <p className="muted">將已儲存版本變成可呼叫的假 API。依規格驗證請求，回應優先使用 example，否則產生示意資料；不呼叫真實伺服器、不儲存請求內容、不模擬資料庫寫入。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!ready && !error && <p role="status">正在讀取 Mock 設定…</p>}
    {ready && <>
      <div className="share-status"><strong>{mock ? `${active ? '已啟用' : '已到期'} · v${mock.version}` : '尚未啟用'}</strong>
        {mock && <><label>Mock Base URL<input readOnly value={mockBase} onFocus={e => e.target.select()} /></label><p className="muted">到期：{new Date(mock.expiresAt).toLocaleString('zh-TW')}</p><div className="share-link-actions"><button className="text-button" onClick={() => action(async () => { await navigator.clipboard.writeText(mockBase); setStatus('已複製 Mock Base URL。'); })}>複製 Base URL</button><button className="text-button" disabled={busy} onClick={() => action(async () => { await disable.mutateAsync(); setResult(null); setStatus('已停用，舊 Mock URL 已失效。'); })}>停用 Mock</button></div></>}
      </div>
      <div className="mock-grid"><section className="edit-form" aria-label="Mock 設定">
        <label>Mock 版本<select value={version} disabled={busy} onChange={e => setChosen(Number(e.target.value))}>{!versions.some(v => v.version === version) && <option value={version}>v{version} · 已啟用版本</option>}{versions.map(v => <option key={v.version} value={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString('zh-TW')}</option>)}</select></label>
        {history.hasNextPage && <button className="text-button" disabled={busy} onClick={() => action(async () => { await history.fetchNextPage({ throwOnError: true }); })}>載入更早版本</button>}
        <label>有效期限<select value={days} disabled={busy} onChange={e => { setDays(Number(e.target.value)); setConfirmed(false); }}><option value={1}>1 天</option><option value={7}>7 天</option><option value={30}>30 天</option></select></label>
        {snapshot && <details className="share-source"><summary>檢查 v{version} 原始內容與範例</summary><pre>{snapshot.source.slice(0, 500000)}</pre>{snapshot.source.length > 500000 && <p>畫面顯示前 500,000 字元；請先從版本歷史下載確認完整內容。</p>}</details>}
        <label className="mock-consent"><input type="checkbox" checked={confirmed} disabled={busy || !snapshot} onChange={e => setConfirmed(e.target.checked)} /><span>我確認此版本的回應範例與 Schema 可供任何取得 Mock URL 的人存取。</span></label>
        <p className="muted">Mock 與文件分享各自獨立。停用文件分享不會停用 Mock；刪除文件會停用兩者。每次啟用／更新都會換發網址，舊網址立即失效。</p>
        <button className="button primary" disabled={busy || !confirmed || !snapshot} onClick={() => action(async () => { await enable.mutateAsync(); setConfirmed(false); setResult(null); setStatus(`已啟用 v${version} 的 Mock API。`); })}>{busy ? '處理中…' : mock ? '更新並換發 Mock URL' : '啟用 Mock API'}</button>
      </section><section className="edit-form" aria-label="Mock 回應預覽">
        <label>測試端點<select value={selected?.label || ''} disabled={busy} onChange={e => { setEndpoint(e.target.value); setResult(null); }}>{ops.map(o => <option key={o.label}>{o.label}</option>)}</select></label>
        {!ops.length && <p className="muted">此版本沒有可預覽的本地端點。</p>}
        <div className="mock-options"><label>回應狀態碼<input placeholder="自動選擇成功回應" value={statusCode} maxLength={3} onChange={e => { setStatusCode(e.target.value); setResult(null); }} /></label><label>具名 example<input placeholder="預設第一個範例" value={exampleName} maxLength={200} onChange={e => { setExampleName(e.target.value); setResult(null); }} /></label></div>
        <label>Query 參數<input placeholder="例如 limit=10&amp;status=available" value={query} maxLength={2000} onChange={e => { setQuery(e.target.value); setResult(null); }} /></label>
        {takesBody && <label>Request Body（JSON）<textarea className="mock-body" rows={6} spellCheck={false} value={body} maxLength={256 * 1024} onChange={e => { setBody(e.target.value); setResult(null); }} /></label>}
        <label className="mock-consent"><input type="checkbox" checked={validate} onChange={e => { setValidate(e.target.checked); setResult(null); }} /><span>依規格驗證請求（不符合時回應 400）</span></label>
        <div className="mock-options"><label>延遲（毫秒）<input inputMode="numeric" placeholder="0–5000" value={delay} maxLength={4} onChange={e => { setDelay(e.target.value); setResult(null); }} /></label><label>失敗機率<input inputMode="decimal" placeholder="0–1，例如 0.2" value={failRate} maxLength={5} onChange={e => { setFailRate(e.target.value); setResult(null); }} /></label><label>失敗狀態碼<input inputMode="numeric" placeholder="預設 500" value={failStatus} maxLength={3} onChange={e => { setFailStatus(e.target.value); setResult(null); }} /></label></div>
        <p className="muted">路徑參數與 Request Body 以 Schema 產生示範值。查詢參數 __status、__example 選擇回應；__delay、__fail、__failStatus 模擬延遲與錯誤；__validate=off 關閉請求驗證。驗證只檢查型別、必填、enum、長度與範圍，不檢查 format 與 pattern；需要 header 的端點請用 curl 加上 -H。本機預覽不模擬延遲與隨機錯誤。外部參照、二進位與串流不支援。</p>
        {sample && <><strong>本機預覽{!sample.error && ` · HTTP ${sample.status} · ${sample.source}`}</strong><pre className="mock-output">{sample.error || sample.body || '（無回應內容）'}</pre></>}
        {active && selected && mock.version === version && <><label>呼叫網址<input readOnly value={testUrl} onFocus={e => e.target.select()} /></label><pre className="mock-output">{`curl -X ${method} '${testUrl.replace(/'/g, "'\\''")}'` + (sendBody ? ` -H 'Content-Type: application/json' --data '${body.replace(/'/g, "'\\''")}'` : '')}</pre><button className="button" disabled={busy} onClick={() => action(async () => { const controller = new AbortController(); testRequest.current = controller; const timer = setTimeout(() => controller.abort(), 15000); try { const response = await fetch(testUrl, { method, credentials: 'omit', signal: controller.signal, ...(sendBody ? { headers: { 'content-type': 'application/json' }, body } : {}) }); setResult({ status: response.status, body: await response.text() }); } finally { clearTimeout(timer); } })}>實際呼叫 Mock</button></>}
        {result && <div role="status"><strong>實際回應 · HTTP {result.status}</strong><pre className="mock-output">{result.body || '（無回應內容）'}</pre></div>}
      </section></div>
    </>}
    {status && <p className="status" role="status">{status}</p>}
  </Modal>;
}
