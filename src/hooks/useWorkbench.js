import { useEffect, useRef, useState } from 'react';
import { convertSource } from '../lib/editor.js';
import { useCloudDraft } from './useCloudDraft.js';
import { example } from '../example.js';
import { api } from '../lib/api.js';
import { createSessionClient } from '../lib/session-client.js';
import { MAX_BYTES, parseDefinition, endpointCount, formatError } from '../lib/openapi.js';

const STYLE_STORAGE = 'workbench-style-rules-off';
function storedOffRules() { try { const value = JSON.parse(localStorage.getItem(STYLE_STORAGE)); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; } }
const exampleDraft = () => ({ source: example, fileName: 'petstore-example.yaml', sourceType: 'import' });
const previewFor = draft => ({ spec: parseDefinition(draft.source), fileName: draft.fileName, source: draft.source });
const selectUrl = id => {
  const query = new URLSearchParams(window.location.search);
  if (query.has('share') || query.get('view') === 'shared') return;
  window.history.replaceState(null, '', id ? '?doc=' + encodeURIComponent(id) : '/');
};

export function useWorkbench() {
  const [initialized, setInitialized] = useState(false);
  const [draftBaseVersion, setDraftBaseVersion] = useState(null);
  const [editor, setEditor] = useState(exampleDraft);
  const [preview, setPreview] = useState(() => previewFor(exampleDraft()));
  const [diagnostics, setDiagnostics] = useState([]);
  const [styleIssues, setStyleIssues] = useState([]), [styleRulesOff, setStyleRulesOff] = useState(storedOffRules);
  const [validating, setValidating] = useState(false);
  const [savedSource, setSavedSource] = useState(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [session, setSession] = useState({ loading: true, user: null, configured: false });
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [versionNote, setVersionNote] = useState('');
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('已載入 3 個 API 端點');
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  // State drives the view; this synchronous lock prevents duplicate writes in one event turn.
  const pending = useRef(true);
  const sessionClient = useRef(null);
  if (!sessionClient.current) sessionClient.current = createSessionClient(api, clearPrivateView);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let active = true;
    pending.current = true;
    async function initialize() {
      try {
        const data = await request('/api/me', options);
        if (!active) return;
        setSession({ loading: false, user: data.user, configured: data.googleConfigured });
        if (!data.user) return;
        const history = await request('/api/documents?offset=0', options);
        if (!active) return;
        setItems(history.documents); setNextOffset(history.nextOffset);
        const id = new URLSearchParams(window.location.search).get('doc');
        if (id) {
          const { document } = await request('/api/documents/' + encodeURIComponent(id), options);
          if (!active) return;
          const draft = { source: document.source, fileName: document.fileName, sourceType: document.sourceType };
          const nextPreview = previewFor(draft);
          setHasEdits(false); setDraftBaseVersion(null); setEditor(draft); setSavedSource(draft.source); setPreview(nextPreview); setSelectedId(document.id); setCurrentVersion(document.currentVersion); setVersionNote('');
          setStatus('已開啟文件。編輯後可儲存新版本，舊版會保留。');
        }
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          setSession({ loading: false, user: null, configured: true });
          setItems([]); setNextOffset(null); setPreview(null); selectUrl(null);
        } else setSession(previous => ({ ...previous, loading: false }));
        setError(formatError(error));
      } finally {
        if (active) { setInitialized(true); pending.current = false; setBusy(false); }
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

  const validatorWorker = useRef(null), validationSequence = useRef(0);
  useEffect(() => {
    const worker = new Worker('/validation-worker.js'); validatorWorker.current = worker;
    return () => { worker.terminate(); validatorWorker.current = null; };
  }, []);
  useEffect(() => {
    setValidating(true);
    const id = ++validationSequence.current, worker = validatorWorker.current;
    const receive = event => {
      if (event.data.id !== id) return;
      const result = event.data.result; setDiagnostics(result.diagnostics); setStyleIssues(result.style);
      if (result.spec) setPreview(previous => previous?.source === editor.source && previous.fileName === editor.fileName ? previous : { spec: result.spec, source: editor.source, fileName: editor.fileName });
      setValidating(false);
    };
    const failed = () => { setStyleIssues([]); setDiagnostics([{ line: 1, column: 1, severity: 'error', message: '驗證元件載入失敗，請重新整理。' }]); setValidating(false); };
    worker.addEventListener('message', receive); worker.addEventListener('error', failed);
    const timer = setTimeout(() => worker.postMessage({ id, source: editor.source, styleOff: styleRulesOff }), 350);
    return () => { clearTimeout(timer); worker.removeEventListener('message', receive); worker.removeEventListener('error', failed); };
  }, [editor, styleRulesOff]);
  const dirty = editor.source !== savedSource;
  const cloudDraft = useCloudDraft({ userId: session.user?.id, documentId: selectedId, initialized, editor, baseVersion: draftBaseVersion || currentVersion, changed: hasEdits, request,
    restore: draft => { setEditor({ source: draft.source, fileName: draft.fileName, sourceType: draft.sourceType }); setDraftBaseVersion(draft.baseVersion); setHasEdits(true); setStatus('已恢復草稿；儲存後才建立正式版本。'); } });
  useEffect(() => {
    const leave = event => { if (hasEdits && cloudDraft.unsynced) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, hasEdits, cloudDraft.unsynced]);

  function convert(format) {
    try { changeSource(convertSource(editor.source, format)); }
    catch (error) { setError(formatError(error)); }
  }

  function clearPrivateView() {
    setSession(previous => ({ ...previous, user: null }));
    setItems([]); setNextOffset(null); setSelectedId(null); setCurrentVersion(null); setVersionNote(''); setHistoryError('');
    setDraftBaseVersion(null); setHasEdits(false); setEditor(exampleDraft()); setSavedSource(null); setPreview(null); selectUrl(null);
  }

  function request(path, options) {
    return sessionClient.current.request(path, options);
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

  async function persist(draft, newVersion = false, clearDraft = false) {
    const nextPreview = previewFor(draft);
    setPreview(nextPreview);
    setStatus(`已載入 ${endpointCount(nextPreview.spec)} 個 API 端點`);
    if (!session.user) {
      setStatus('已預覽，尚未儲存。請先使用 Google 登入，再按「儲存並更新文件」。');
      return;
    }
    setStatus('正在儲存…');
    const data = await request(newVersion ? `/api/documents/${selectedId}/content` : '/api/documents', {
      method: newVersion ? 'PUT' : 'POST', headers: { ...(newVersion ? { 'x-expected-version': String(draftBaseVersion || currentVersion), 'x-version-note': encodeURIComponent(versionNote) } : {}), 'content-type': 'text/plain; charset=utf-8', 'x-source-type': draft.sourceType, 'x-file-name': encodeURIComponent(draft.fileName) }, body: draft.source,
    });
    if (clearDraft) await cloudDraft.clearSaved(draft.source).catch(() => {});
    setHasEdits(false); setDraftBaseVersion(null); setSavedSource(draft.source);
    setSelectedId(data.document.id); setCurrentVersion(data.document.currentVersion); setVersionNote(''); selectUrl(data.document.id);
    setStatus(`已儲存 v${data.document.currentVersion}，重新整理後仍可開啟。`);
    try { await fetchHistory(); }
    catch (error) {
      if (error.status === 401) throw error;
      setHistoryError('文件已儲存，歷史清單暫時無法更新，請按重新整理。');
    }
  }

  function save(draft = editor, asNew = false) {
    if (!cloudDraft.ready) return setError('請先恢復或捨棄雲端草稿。');
    return run(() => persist(draft, !asNew && !!selectedId, true), '尚未確認儲存。請先重新整理歷史確認；編輯區內容已保留。');
  }

  function changeSource(source) {
    if (pending.current) return;
    setHasEdits(true);
    setEditor(previous => ({ ...previous, source }));
    setStatus('未儲存的變更 · 預覽會即時更新，儲存後才建立版本。'); setError('');
  }

  function pasteSource(source) {
    return run(async () => {
      await cloudDraft.flush();
      setHasEdits(true); setDraftBaseVersion(null);
      setSelectedId(null); setCurrentVersion(null); setSavedSource(null); setVersionNote(''); selectUrl(null);
      const draft = { source, fileName: 'pasted-api.yaml', sourceType: 'paste' };
      setEditor(draft); await persist(draft);
    });
  }

  function importExample() {
    if (pending.current) return;
    return run(async () => { await cloudDraft.flush(); const draft = exampleDraft(); setHasEdits(true); setDraftBaseVersion(null); setSelectedId(null); setCurrentVersion(null); setSavedSource(null); selectUrl(null); setEditor(draft); await persist(draft); });
  }

  function loadFile(file) {
    if (!file) return;
    return run(async () => {
      await cloudDraft.flush();
      if (!/\.(ya?ml|json)$/i.test(file.name)) throw new Error('請選擇 .yaml、.yml 或 .json 檔案。');
      if (file.size > MAX_BYTES) throw new Error('檔案過大，請使用 5 MB 以內的文件。');
      const draft = { source: await file.text(), fileName: file.name, sourceType: 'upload' };
      setSelectedId(null); setCurrentVersion(null); setSavedSource(null); setVersionNote(''); setDraftBaseVersion(null); setHasEdits(true); selectUrl(null);
      setEditor(draft); await persist(draft);
    });
  }

  function openDocument(id) {
    return run(async () => {
      await cloudDraft.flush();
      const { document } = await request('/api/documents/' + encodeURIComponent(id));
      const draft = { source: document.source, fileName: document.fileName, sourceType: document.sourceType };
      const nextPreview = previewFor(draft);
      setHasEdits(false); setDraftBaseVersion(null); setEditor(draft); setSavedSource(draft.source); setPreview(nextPreview); setSelectedId(document.id); setCurrentVersion(document.currentVersion); setVersionNote(''); selectUrl(document.id);
      if (id === selectedId) cloudDraft.retry();
      setStatus('已開啟文件。編輯後可儲存新版本，舊版會保留。');
    });
  }

  function restoreVersion(version) {
    return run(async () => {
      await cloudDraft.flush();
      const { document } = await request(`/api/documents/${selectedId}/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version, expectedVersion: currentVersion }) });
      await cloudDraft.clearSaved().catch(() => {});
      const restored = await request(`/api/documents/${selectedId}/versions/${document.currentVersion}`);
      const draft = { source: restored.source, fileName: restored.fileName, sourceType: editor.sourceType };
      setHasEdits(false); setDraftBaseVersion(null); setEditor(draft); setSavedSource(draft.source); setPreview(previewFor(draft)); setCurrentVersion(document.currentVersion); setVersionNote('');
      setStatus(`已將 v${version} 還原為 v${document.currentVersion}，所有舊版本仍保留。`);
      try { await fetchHistory(); } catch (error) { if (error.status === 401) throw error; setHistoryError('已還原，請重新整理歷史清單。'); }
    });
  }

  function deleteDocument(item) {
    if (pending.current || !window.confirm(`刪除「${item.displayName || item.title}」？這會移除文件與所有版本，無法復原。`)) return;
    return run(async () => {
      await request('/api/documents/' + encodeURIComponent(item.id), { method: 'DELETE' });
      setItems(previous => previous.filter(document => document.id !== item.id));
      if (selectedId === item.id) {
        const draft = exampleDraft();
        setSelectedId(null); setCurrentVersion(null); setVersionNote(''); selectUrl(null); setHasEdits(false); setSavedSource(null); setEditor(draft); setPreview(previewFor(draft));
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
      await cloudDraft.flush();
      const { csrfToken } = await request('/api/auth/csrf');
      await request('/api/auth/signout', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
        body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin }),
      });
      sessionClient.current.invalidate(); const draft = exampleDraft(); setEditor(draft); setPreview(previewFor(draft)); setStatus('已登出。');
    });
  }

  function toggleStyleRule(id) {
    setStyleRulesOff(previous => {
      const next = previous.includes(id) ? previous.filter(rule => rule !== id) : [...previous, id];
      try { localStorage.setItem(STYLE_STORAGE, JSON.stringify(next)); } catch { /* Rule choices still apply for this page when storage is disabled. */ }
      return next;
    });
  }

  return {
    style: styleIssues, styleRulesOff, toggleStyleRule,
    editor, preview, cloudDraft, draftBaseVersion, diagnostics, validating, dirty, convert, currentVersion, versionNote, setVersionNote, restoreVersion, session, items, nextOffset, selectedId, busy, status: !dirty && status.startsWith('未儲存的變更') ? '目前內容與已儲存版本一致。' : status, error, historyError,
    request, save, changeSource, pasteSource, importExample, loadFile, openDocument, deleteDocument, signOut,
    refreshHistory: append => session.user && run(() => fetchHistory(append)),
    reportError: message => setError(message),
  };
}
