import { useEffect, useRef, useState } from 'react';
import { example } from '../example.js';
import { api } from '../lib/api.js';
import { MAX_BYTES, parseDefinition, endpointCount, formatError } from '../lib/openapi.js';

const exampleDraft = () => ({ source: example, fileName: 'petstore-example.yaml', sourceType: 'import' });
const previewFor = draft => ({ spec: parseDefinition(draft.source), fileName: draft.fileName });
const selectUrl = id => window.history.replaceState(null, '', id ? '?doc=' + encodeURIComponent(id) : '/');

export function useWorkbench() {
  const [editor, setEditor] = useState(exampleDraft);
  const [preview, setPreview] = useState(() => previewFor(exampleDraft()));
  const [session, setSession] = useState({ loading: true, user: null, configured: false });
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('已載入 3 個 API 端點');
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  // State drives the view; this synchronous lock prevents duplicate writes in one event turn.
  const pending = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let active = true;
    pending.current = true;
    async function initialize() {
      try {
        const data = await api('/api/me', options);
        if (!active) return;
        setSession({ loading: false, user: data.user, configured: data.googleConfigured });
        if (!data.user) return;
        const history = await api('/api/documents?offset=0', options);
        if (!active) return;
        setItems(history.documents); setNextOffset(history.nextOffset);
        const id = new URLSearchParams(window.location.search).get('doc');
        if (id) {
          const { document } = await api('/api/documents/' + encodeURIComponent(id), options);
          if (!active) return;
          const draft = { source: document.source, fileName: document.fileName, sourceType: document.sourceType };
          const nextPreview = previewFor(draft);
          setEditor(draft); setPreview(nextPreview); setSelectedId(document.id);
          setStatus('已從歷史開啟。編輯後儲存會建立新紀錄。');
        }
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          setSession({ loading: false, user: null, configured: true });
          setItems([]); setNextOffset(null); setPreview(null); selectUrl(null);
        } else setSession(previous => ({ ...previous, loading: false }));
        setError(formatError(error));
      } finally {
        if (active) { pending.current = false; setBusy(false); }
      }
    }
    initialize();
    const onPageShow = event => { if (event.persisted) window.location.reload(); };
    const preventFileNavigation = event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      active = false; controller.abort();
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  function clearPrivateView() {
    setSession(previous => ({ ...previous, user: null }));
    setItems([]); setNextOffset(null); setSelectedId(null); setHistoryError('');
    setPreview(null); selectUrl(null);
  }

  async function request(path, options) {
    try { return await api(path, options); }
    catch (error) { if (error.status === 401) clearPrivateView(); throw error; }
  }

  async function run(operation, failureStatus = '尚未完成操作；編輯區內容已保留。') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await operation(); return true; }
    catch (error) { setError(formatError(error)); setStatus(failureStatus); return false; }
    finally { pending.current = false; setBusy(false); }
  }

  async function fetchHistory(append = false) {
    const data = await request('/api/documents?offset=' + (append ? nextOffset || 0 : 0));
    setItems(previous => append ? [...previous, ...data.documents] : data.documents);
    setNextOffset(data.nextOffset); setHistoryError('');
  }

  async function persist(draft) {
    const nextPreview = previewFor(draft);
    setPreview(nextPreview);
    setStatus(`已載入 ${endpointCount(nextPreview.spec)} 個 API 端點`);
    if (!session.user) {
      setStatus('已預覽，尚未儲存。請先使用 Google 登入，再按「儲存並更新文件」。');
      return;
    }
    setStatus('正在儲存…');
    const data = await request('/api/documents', {
      method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-source-type': draft.sourceType, 'x-file-name': encodeURIComponent(draft.fileName) }, body: draft.source,
    });
    setSelectedId(data.document.id); selectUrl(data.document.id);
    setStatus('已儲存至個人歷史，重新整理後仍可開啟。');
    try { await fetchHistory(); }
    catch (error) {
      if (error.status === 401) throw error;
      setHistoryError('文件已儲存，歷史清單暫時無法更新，請按重新整理。');
    }
  }

  function save(draft = editor) {
    return run(() => persist(draft), '尚未確認儲存。請先重新整理歷史確認；編輯區內容已保留。');
  }

  function changeSource(source) {
    if (pending.current) return;
    setEditor({ source, fileName: 'pasted-api.yaml', sourceType: 'paste' });
    setStatus('內容已變更，按「儲存並更新文件」套用。'); setError('');
  }

  function pasteSource(source) {
    if (pending.current) return;
    const draft = { source, fileName: 'pasted-api.yaml', sourceType: 'paste' };
    setEditor(draft);
    return save(draft);
  }

  function importExample() {
    if (pending.current) return;
    const draft = exampleDraft(); setEditor(draft); return save(draft);
  }

  function loadFile(file) {
    if (!file) return;
    return run(async () => {
      if (!/\.(ya?ml|json)$/i.test(file.name)) throw new Error('請選擇 .yaml、.yml 或 .json 檔案。');
      if (file.size > MAX_BYTES) throw new Error('檔案過大，請使用 5 MB 以內的文件。');
      const draft = { source: await file.text(), fileName: file.name, sourceType: 'upload' };
      setEditor(draft); await persist(draft);
    });
  }

  function openDocument(id) {
    return run(async () => {
      const { document } = await request('/api/documents/' + encodeURIComponent(id));
      const draft = { source: document.source, fileName: document.fileName, sourceType: document.sourceType };
      const nextPreview = previewFor(draft);
      setEditor(draft); setPreview(nextPreview); setSelectedId(document.id); selectUrl(document.id);
      setStatus('已從歷史開啟。編輯後儲存會建立新紀錄。');
    });
  }

  function deleteDocument(item) {
    if (pending.current || !window.confirm(`刪除「${item.displayName || item.title}」？這會移除已儲存的文件，無法復原。`)) return;
    return run(async () => {
      await request('/api/documents/' + encodeURIComponent(item.id), { method: 'DELETE' });
      setItems(previous => previous.filter(document => document.id !== item.id));
      if (selectedId === item.id) {
        const draft = exampleDraft();
        setSelectedId(null); selectUrl(null); setEditor(draft); setPreview(previewFor(draft));
      }
      setStatus('文件已刪除。');
      try { await fetchHistory(); }
      catch (error) {
        if (error.status === 401) throw error;
        setHistoryError('文件已刪除，請重新整理歷史清單。');
      }
    });
  }

  function signOut() {
    return run(async () => {
      const { csrfToken } = await request('/api/auth/csrf');
      await request('/api/auth/signout', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
        body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin }),
      });
      clearPrivateView(); const draft = exampleDraft(); setEditor(draft); setPreview(previewFor(draft)); setStatus('已登出。');
    });
  }

  return {
    editor, preview, session, items, nextOffset, selectedId, busy, status, error, historyError,
    request, save, changeSource, pasteSource, importExample, loadFile, openDocument, deleteDocument, signOut,
    refreshHistory: append => session.user && run(() => fetchHistory(append)),
    reportError: message => setError(message),
  };
}
