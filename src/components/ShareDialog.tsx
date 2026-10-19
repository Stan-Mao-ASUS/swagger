import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from './Modal.tsx';
import { ExportMenu } from './ExportMenu.tsx';
import { documentKey, jsonBody, queryClient, request } from '../state/query-client.ts';
import { usePublication, useUserId, useVersion, useVersions } from '../state/queries.ts';
import { useWorkbench } from '../state/workbench.ts';
import type { Publication, Visibility } from '../../shared/types.ts';
export function ShareDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const currentVersion = useWorkbench(state => state.currentVersion) ?? 1, specTitle = useWorkbench(state => state.preview?.spec.info?.title);
  const userId = useUserId(), publicationQuery = usePublication(documentId), history = useVersions(documentId);
  const ready = publicationQuery.isSuccess && history.isSuccess, publication = publicationQuery.data ?? null;
  const versions = history.data?.pages.flatMap(page => page.versions) ?? [];
  const [version, setVersion] = useState(currentVersion), versionQuery = useVersion(documentId, version), preview = versionQuery.data;
  const [title, setTitle] = useState(''), [summary, setSummary] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [visibility, setVisibility] = useState<Visibility | 'private'>('private'), [expiresAt, setExpiresAt] = useState(''), [rotateLink, setRotateLink] = useState(false);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [status, setStatus] = useState('');
  const pending = useRef(false), base = `/api/documents/${documentId}`;
  const error = actionError || publicationQuery.error?.message || history.error?.message || versionQuery.error?.message || '';
  useEffect(() => {
    if (!ready) return;
    setVisibility(publication?.visibility || 'private');
    if (publication?.expiresAt) { const date = new Date(publication.expiresAt); setExpiresAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)); }
    setTitle(publication?.title || (typeof specTitle === 'string' ? specTitle : '').slice(0, 200)); setSummary(publication?.summary || '');
  }, [ready]);
  useEffect(() => { setConfirmed(false); }, [version]);
  const setPublication = (value: Publication | null) => queryClient.setQueryData(documentKey(userId, documentId, 'publication'), value);
  const save = useMutation({
    mutationFn: () => request<{ publication: Publication }>(base + '/publication', jsonBody('PUT', { version, title, summary, confirmPublic: true, visibility, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, rotateLink })),
    onSuccess: data => setPublication(data.publication),
  });
  const revoke = useMutation({ mutationFn: () => request(base + '/publication', { method: 'DELETE' }), onSuccess: () => setPublication(null) });
  async function action(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setActionError(''); setStatus('');
    try { await operation(); } catch (error) { setActionError((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  const shareUrl = publication ? `${window.location.origin}/?share=${publication.id}` : '';
  function publish(event: FormEvent) {
    event.preventDefault();
    if (visibility === 'private') { action(async () => { await revoke.mutateAsync(); setStatus('已設為私人，原分享連結已失效。'); }); return; }
    if (!confirmed || !preview) return;
    action(async () => {
      await save.mutateAsync(); setConfirmed(false); setRotateLink(false); setStatus(visibility === 'public' ? `已發布 v${version} 至分享區。` : `已建立 v${version} 的持連結分享。`);
    });
  }
  return <Modal title="分享權限" onClose={() => { if (!pending.current) onClose(); }}>
    <p className="muted">選擇誰可以閱讀與下載指定版本。後續編輯及草稿不會自動更新分享內容。</p>
    {!ready && !error && <p role="status">正在讀取分享設定…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {ready && <>
      <div className="share-status"><strong>{publication ? `${publication.expiresAt && Date.parse(publication.expiresAt) <= Date.now() ? '已到期' : publication.visibility === 'unlisted' ? '持連結可讀' : '公開分享區'} · v${publication.version}` : '目前為私人文件'}</strong>
        {publication && <>{publication.expiresAt && <p className="muted">到期：{new Date(publication.expiresAt).toLocaleString('zh-TW')}</p>}<label>分享網址<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><div className="share-link-actions"><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setStatus('已複製分享網址。'); } catch { setStatus('請選取上方網址後複製。'); } }}>複製連結</button><a href={shareUrl} target="_blank" rel="noopener noreferrer">查看分享頁面</a><button type="button" className="text-button" disabled={busy} onClick={() => action(async () => { await revoke.mutateAsync(); setVisibility('private'); setStatus('已撤下，原分享連結已失效。'); })}>撤下分享</button></div></>}
      </div>
      <form className="edit-form share-form" onSubmit={publish}>
        <label>存取權限<select value={visibility} disabled={busy} onChange={event => { setVisibility(event.target.value as Visibility | 'private'); setConfirmed(false); }}><option value="private">私人：只有自己可以讀取</option><option value="unlisted">持連結可讀：不列入分享區</option><option value="public">公開分享區：所有訪客可瀏覽</option></select></label>
        {visibility !== 'private' && <>
        <p className="muted">{visibility === 'unlisted' ? '任何取得連結的人都能閱讀與下載，無須登入。' : '文件會列在公開分享區。'} 變更分享範圍會更換連結，舊連結立即失效。</p>
        <label>到期時間（本地時間，留空表示不限期）<input type="datetime-local" value={expiresAt} disabled={busy} onChange={event => { setExpiresAt(event.target.value); setConfirmed(false); }} /></label>
        {publication && <label className="share-consent"><input type="checkbox" checked={rotateLink} disabled={busy} onChange={event => { setRotateLink(event.target.checked); setConfirmed(false); }} /><span>更換分享連結，讓舊連結失效</span></label>}
        <label>分享標題<input required maxLength={200} value={title} disabled={busy} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} /></label>
        <label>分享說明（選填）<textarea maxLength={500} rows={3} value={summary} disabled={busy} onChange={event => { setSummary(event.target.value); setConfirmed(false); }} placeholder="這份 API 文件的用途" /></label>
        <label>分享版本<select value={version} disabled={busy} onChange={event => setVersion(Number(event.target.value))}>{versions.map(item => <option key={item.version} value={item.version}>v{item.version} · {new Date(item.createdAt).toLocaleString('zh-TW')}</option>)}</select></label>
        {history.hasNextPage && <button type="button" className="text-button" disabled={busy} onClick={() => action(async () => { await history.fetchNextPage({ throwOnError: true }); })}>載入更早版本</button>}
        {preview ? <details className="share-source"><summary>確認 v{version} 的分享內容 · {preview.fileName}</summary><ExportMenu preview={preview} /><pre>{preview.source.slice(0, 500000)}</pre>{preview.source.length > 500000 && <p>畫面顯示前 500,000 字元；下載可確認完整內容。</p>}</details> : <p role="status">正在讀取版本內容…</p>}
        <label className="share-consent"><input type="checkbox" checked={confirmed} disabled={busy || !preview} onChange={event => setConfirmed(event.target.checked)} /><span>我確認此版本的完整 YAML／JSON 與檔名可供持連結的訪客閱讀與下載，包含其中的網址及範例資料。</span></label>
        <p className="muted">私人分類、其他版本與帳號 Email 不會公開。撤下後無法收回別人已下載的副本。</p>
        </>}
        <button className="button primary" disabled={busy || (visibility !== 'private' && (!confirmed || !preview || !title.trim()))}>{busy ? '處理中…' : visibility === 'private' ? '設為私人並撤銷分享' : '儲存分享設定'}</button>
      </form>
    </>}
    {status && <p role="status" className="status">{status}</p>}
  </Modal>;
}
