import { create } from 'zustand';
import { convertSource, formatSource, type FormatOptions } from '../lib/editor.ts';
import { example } from '../example.ts';
import { MAX_BYTES, parseDefinition, endpointCount, formatError } from '../lib/openapi.ts';
import { ApiError } from '../lib/api.ts';
import { currentUser, fetchMe, invalidateDocument, invalidateLibrary, invalidateSession, jsonBody, meKey, onSessionInvalidated, queryClient, request } from './query-client.ts';
import { useCloudDraft } from './cloud-draft.ts';
import type { OutlineItem } from '../lib/analyze-source.ts';
import type { Diagnostic, DocumentDetail, DocumentSummary, Me, SourceType, SpecNode, VersionDetail } from '../../shared/types.ts';

export interface EditorDraft { source: string; fileName: string; sourceType: SourceType }
export interface Preview { spec: SpecNode; source: string; fileName: string }

const STYLE_STORAGE = 'workbench-style-rules-off';
function storedOffRules(): string[] {
  try { const value = JSON.parse(localStorage.getItem(STYLE_STORAGE) || 'null'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; }
}
const exampleDraft = (): EditorDraft => ({ source: example, fileName: 'petstore-example.yaml', sourceType: 'import' });
const previewFor = (draft: EditorDraft): Preview => ({ spec: parseDefinition(draft.source), fileName: draft.fileName, source: draft.source });
const draftOf = (document: DocumentDetail): EditorDraft => ({ source: document.source, fileName: document.fileName, sourceType: document.sourceType });
const selectUrl = (id: string | null) => {
  const query = new URLSearchParams(window.location.search);
  if (query.has('share') || query.get('view') === 'shared') return;
  window.history.replaceState(null, '', id ? '?doc=' + encodeURIComponent(id) : '/');
};

interface WorkbenchState {
  initialized: boolean;
  editor: EditorDraft; savedSource: string | null; hasEdits: boolean;
  selectedId: string | null; currentVersion: number | null; draftBaseVersion: number | null; versionNote: string;
  preview: Preview | null; diagnostics: Diagnostic[]; style: Diagnostic[]; validating: boolean; styleRulesOff: string[];
  outlineOpen: boolean; outline: OutlineItem[]; proxyTryItOut: boolean;
  // Doubles as the write lock: set() is synchronous, so a second action in the same event turn sees it.
  busy: boolean; status: string; error: string;
  initialize(): () => void;
  changeSource(source: string): void;
  pasteSource(source: string): Promise<boolean | undefined>;
  importExample(): Promise<boolean | undefined>;
  loadFile(file: File | undefined): Promise<boolean | undefined>;
  openDocument(id: string): Promise<boolean | undefined>;
  save(draft?: EditorDraft, asNew?: boolean): Promise<boolean | undefined> | void;
  restoreVersion(version: number): Promise<boolean | undefined>;
  deleteDocument(item: Pick<DocumentSummary, 'id' | 'title' | 'displayName'>): Promise<boolean | undefined> | undefined;
  signOut(): Promise<boolean | undefined>;
  convert(format: 'json' | 'yaml'): void;
  format(options: FormatOptions): void;
  restoreDraft(draft: EditorDraft & { baseVersion: number | null }): void;
  setVersionNote(note: string): void;
  toggleStyleRule(id: string): void;
  reportError(message: string): void;
  clearPrivateView(): void;
}

export const useWorkbench = create<WorkbenchState>()((set, get) => {
  async function run(operation: () => Promise<void>, failureStatus = '尚未完成操作；編輯區內容已保留。') {
    if (get().busy) return;
    set({ busy: true, error: '' });
    try { await operation(); return true; }
    catch (error) { set({ error: formatError(error), status: failureStatus }); return false; }
    finally { set({ busy: false }); }
  }
  const showDocument = (document: DocumentDetail) => {
    const draft = draftOf(document);
    set({ hasEdits: false, draftBaseVersion: null, editor: draft, savedSource: draft.source, preview: previewFor(draft), selectedId: document.id, currentVersion: document.currentVersion, versionNote: '' });
  };
  const startNewDocument = (draft: EditorDraft) => {
    set({ hasEdits: true, draftBaseVersion: null, selectedId: null, currentVersion: null, savedSource: null, versionNote: '', editor: draft }); selectUrl(null);
  };
  async function persist(draft: EditorDraft, newVersion = false, clearDraft = false) {
    const preview = previewFor(draft);
    set({ preview, status: `已載入 ${endpointCount(preview.spec)} 個 API 端點` });
    if (!currentUser()) { set({ status: '已預覽，尚未儲存。請先使用 Google 登入，再按「儲存並更新文件」。' }); return; }
    set({ status: '正在儲存…' });
    const { selectedId, draftBaseVersion, currentVersion, versionNote } = get();
    const data = await request<{ document: DocumentSummary }>(newVersion ? `/api/documents/${selectedId}/content` : '/api/documents', {
      method: newVersion ? 'PUT' : 'POST', headers: { ...(newVersion ? { 'x-expected-version': String(draftBaseVersion || currentVersion), 'x-version-note': encodeURIComponent(versionNote) } : {}), 'content-type': 'text/plain; charset=utf-8', 'x-source-type': draft.sourceType, 'x-file-name': encodeURIComponent(draft.fileName) }, body: draft.source,
    });
    if (clearDraft) await useCloudDraft.getState().clearSaved().catch(() => {});
    set({ hasEdits: false, draftBaseVersion: null, savedSource: draft.source, selectedId: data.document.id, currentVersion: data.document.currentVersion, versionNote: '' }); selectUrl(data.document.id);
    set({ status: `已儲存 v${data.document.currentVersion}，重新整理後仍可開啟。` });
    invalidateLibrary(); invalidateDocument(data.document.id);
  }
  const flushDraft = () => useCloudDraft.getState().flush();

  return {
    initialized: false,
    editor: exampleDraft(), savedSource: null, hasEdits: false,
    selectedId: null, currentVersion: null, draftBaseVersion: null, versionNote: '',
    preview: previewFor(exampleDraft()), diagnostics: [], style: [], validating: false, styleRulesOff: storedOffRules(),
    outlineOpen: false, outline: [], proxyTryItOut: false,
    busy: true, status: '已載入 3 個 API 端點', error: '',

    initialize() {
      const controller = new AbortController(), options = { signal: controller.signal };
      let active = true;
      set({ busy: true });
      (async () => {
        try {
          const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: () => fetchMe(options), staleTime: Infinity });
          if (!active || !me.user) return;
          const id = new URLSearchParams(window.location.search).get('doc');
          if (!id) return;
          const { document } = await request<{ document: DocumentDetail }>('/api/documents/' + encodeURIComponent(id), options);
          if (!active) return;
          showDocument(document);
          set({ status: '已開啟文件。編輯後可儲存新版本，舊版會保留。' });
        } catch (error) {
          if (!active) return;
          if ((error as ApiError).status === 401) {
            queryClient.setQueryData<Me>(meKey, { user: null, googleConfigured: true });
            set({ preview: null }); selectUrl(null);
          } else if (!queryClient.getQueryData(meKey)) queryClient.setQueryData<Me>(meKey, { user: null, googleConfigured: false });
          set({ error: formatError(error) });
        } finally {
          if (active) set({ initialized: true, busy: false });
        }
      })();
      return () => { active = false; controller.abort(); };
    },

    changeSource(source) {
      if (get().busy) return;
      set(state => ({ hasEdits: true, editor: { ...state.editor, source }, status: '未儲存的變更 · 預覽會即時更新，儲存後才建立版本。', error: '' }));
    },
    pasteSource(source) {
      return run(async () => {
        await flushDraft();
        const draft: EditorDraft = { source, fileName: 'pasted-api.yaml', sourceType: 'paste' };
        startNewDocument(draft); await persist(draft);
      });
    },
    importExample() {
      return run(async () => { await flushDraft(); const draft = exampleDraft(); startNewDocument(draft); await persist(draft); });
    },
    loadFile(file) {
      if (!file) return Promise.resolve(undefined);
      return run(async () => {
        await flushDraft();
        if (!/\.(ya?ml|json)$/i.test(file.name)) throw new Error('請選擇 .yaml、.yml 或 .json 檔案。');
        if (file.size > MAX_BYTES) throw new Error('檔案過大，請使用 5 MB 以內的文件。');
        const draft: EditorDraft = { source: await file.text(), fileName: file.name, sourceType: 'upload' };
        startNewDocument(draft); await persist(draft);
      });
    },
    openDocument(id) {
      return run(async () => {
        await flushDraft();
        const { document } = await request<{ document: DocumentDetail }>('/api/documents/' + encodeURIComponent(id));
        const reopened = id === get().selectedId;
        showDocument(document); selectUrl(document.id);
        if (reopened) useCloudDraft.getState().retry();
        set({ status: '已開啟文件。編輯後可儲存新版本，舊版會保留。' });
      });
    },
    save(draft = get().editor, asNew = false) {
      if (!useCloudDraft.getState().isReady()) { set({ error: '請先恢復或捨棄雲端草稿。' }); return; }
      return run(() => persist(draft, !asNew && !!get().selectedId, true), '尚未確認儲存。請先重新整理歷史確認；編輯區內容已保留。');
    },
    restoreVersion(version) {
      return run(async () => {
        await flushDraft();
        const { selectedId, currentVersion, editor } = get();
        const { document } = await request<{ document: DocumentSummary }>(`/api/documents/${selectedId}/restore`, jsonBody('POST', { version, expectedVersion: currentVersion }));
        await useCloudDraft.getState().clearSaved().catch(() => {});
        const restored = await request<VersionDetail>(`/api/documents/${selectedId}/versions/${document.currentVersion}`);
        const draft: EditorDraft = { source: restored.source, fileName: restored.fileName, sourceType: editor.sourceType };
        set({ hasEdits: false, draftBaseVersion: null, editor: draft, savedSource: draft.source, preview: previewFor(draft), currentVersion: document.currentVersion, versionNote: '' });
        set({ status: `已將 v${version} 還原為 v${document.currentVersion}，所有舊版本仍保留。` });
        invalidateLibrary(); invalidateDocument(document.id);
      });
    },
    deleteDocument(item) {
      if (get().busy || !window.confirm(`刪除「${item.displayName || item.title}」？這會移除文件與所有版本，無法復原。`)) return;
      return run(async () => {
        await request('/api/documents/' + encodeURIComponent(item.id), { method: 'DELETE' });
        if (get().selectedId === item.id) {
          const draft = exampleDraft();
          set({ selectedId: null, currentVersion: null, versionNote: '', hasEdits: false, savedSource: null, editor: draft, preview: previewFor(draft) }); selectUrl(null);
        }
        set({ status: '文件已刪除。' });
        invalidateLibrary(); invalidateDocument(item.id);
      });
    },
    signOut() {
      return run(async () => {
        await flushDraft();
        const { csrfToken } = await request<{ csrfToken: string }>('/api/auth/csrf');
        await request('/api/auth/signout', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
          body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin }),
        });
        invalidateSession(); const draft = exampleDraft(); set({ editor: draft, preview: previewFor(draft), status: '已登出。' });
      });
    },
    convert(format) {
      try { get().changeSource(convertSource(get().editor.source, format)); }
      catch (error) { set({ error: formatError(error) }); }
    },
    format(options) {
      try { get().changeSource(formatSource(get().editor.source, options)); }
      catch (error) { set({ error: formatError(error) }); }
    },
    restoreDraft(draft) {
      set({ editor: { source: draft.source, fileName: draft.fileName, sourceType: draft.sourceType }, draftBaseVersion: draft.baseVersion, hasEdits: true, status: '已恢復草稿；儲存後才建立正式版本。' });
    },
    setVersionNote: versionNote => set({ versionNote }),
    toggleStyleRule(id) {
      const previous = get().styleRulesOff, next = previous.includes(id) ? previous.filter(rule => rule !== id) : [...previous, id];
      try { localStorage.setItem(STYLE_STORAGE, JSON.stringify(next)); } catch { /* Rule choices still apply for this page when storage is disabled. */ }
      set({ styleRulesOff: next });
    },
    reportError: error => set({ error }),
    clearPrivateView() {
      set({ selectedId: null, currentVersion: null, versionNote: '', draftBaseVersion: null, hasEdits: false, editor: exampleDraft(), savedSource: null, preview: null });
      selectUrl(null);
    },
  };
});
onSessionInvalidated(() => useWorkbench.getState().clearPrivateView());

export const useDirty = () => useWorkbench(state => state.editor.source !== state.savedSource);
