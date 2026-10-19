import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { currentUser, request } from './query-client.ts';
import { useWorkbench } from './workbench.ts';
import { useSession } from './queries.ts';
import type { ApiError } from '../lib/api.ts';
import type { Draft, DraftState } from '../../shared/types.ts';

// One session per draft target (account + document). Async results check they still belong
// to the current session, so a slow response never lands on a document the user has left.
interface DraftSession { target: string | null; path: string; revision: number; source: string | null; loaded: boolean; pending: Promise<void> | null; conflict: boolean }
const draftTarget = (userId: string | undefined, documentId: string | null) => userId ? `${userId}/${documentId || 'new'}` : null;
const liveTarget = () => draftTarget(currentUser()?.id, useWorkbench.getState().selectedId);
const newSession = (target: string | null, documentId: string | null): DraftSession => ({ target, path: '/api/drafts/' + (documentId || 'new'), revision: 0, source: null, loaded: false, pending: null, conflict: false });

interface CloudDraftState {
  session: DraftSession; recovery: Draft | null; status: string; loadedFlag: boolean; saved: string | null; tick: number;
  load(userId: string | undefined, documentId: string | null, initialized: boolean): () => void;
  isReady(): boolean;
  flush(): Promise<void>;
  discard(): Promise<void>;
  recover(): void;
  clearSaved(): Promise<void>;
  retry(): void;
}

export const useCloudDraft = create<CloudDraftState>()((set, get) => ({
  session: newSession(null, null), recovery: null, status: '', loadedFlag: true, saved: null, tick: 0,

  load(userId, documentId, initialized) {
    const target = draftTarget(userId, documentId), current = newSession(target, documentId);
    set({ session: current, loadedFlag: !target, recovery: null, saved: null, status: '' });
    if (!target || !initialized) return () => {};
    const controller = new AbortController();
    request<DraftState>(current.path, { signal: controller.signal }).then(data => {
      if (get().session !== current || controller.signal.aborted) return;
      current.revision = data.revision; current.source = data.draft?.source ?? null; current.loaded = true;
      set({ saved: current.source });
      if (data.draft && data.draft.source !== useWorkbench.getState().editor.source) set({ recovery: data.draft });
      else set({ loadedFlag: true });
      set({ status: data.draft ? '找到雲端草稿。' : '編輯後會自動保存草稿。' });
    }).catch(error => { if (get().session === current && !controller.signal.aborted) set({ status: '無法讀取草稿：' + error.message }); });
    return () => controller.abort();
  },
  isReady() {
    const target = liveTarget();
    return !target || (get().loadedFlag && get().session.target === target);
  },
  async flush() {
    const current = get().session, target = liveTarget();
    // Until load() replaces the session after a document switch, it still belongs to the previous target.
    if (!target || current.target !== target) return;
    if (!current.loaded || !get().loadedFlag || current.conflict) throw new Error('草稿尚未準備好，請先處理草稿提示。');
    while (current.pending) await current.pending;
    if (get().session !== current || liveTarget() !== target) return;
    const { editor, hasEdits, draftBaseVersion, currentVersion } = useWorkbench.getState();
    if (!hasEdits || current.source === editor.source) return;
    const job = (async () => {
      set({ status: '正在保存雲端草稿…' });
      try {
        const data = await request<{ revision: number; updatedAt: string }>(current.path, { method: 'PUT', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-draft-revision': String(current.revision), 'x-file-name': encodeURIComponent(editor.fileName), 'x-source-type': editor.sourceType, 'x-base-version': String(draftBaseVersion || currentVersion || 0) }, body: editor.source });
        if (get().session !== current) return;
        current.revision = data.revision; current.source = editor.source;
        set({ saved: editor.source, status: '草稿已保存至帳號 · ' + new Date(data.updatedAt).toLocaleTimeString('zh-TW') });
      } catch (error) {
        if (get().session === current) { current.conflict = (error as ApiError).status === 409; set({ status: '草稿未同步：' + (error as Error).message }); }
        throw error;
      } finally { if (get().session === current) current.pending = null; }
    })();
    current.pending = job;
    await job;
  },
  async discard() {
    const current = get().session;
    if (current.pending) await current.pending;
    const result = await request<{ revision: number }>(current.path, { method: 'DELETE', headers: { 'x-draft-revision': String(current.revision) } });
    if (get().session !== current) return;
    current.revision = result.revision; current.source = null;
    set({ saved: null, recovery: null, loadedFlag: true, status: '已捨棄雲端草稿，目前編輯內容保持不變。' });
  },
  recover() {
    const { recovery } = get();
    if (!recovery) return;
    useWorkbench.getState().restoreDraft(recovery);
    set({ recovery: null, loadedFlag: true, status: '已恢復雲端草稿，尚未建立正式版本。' });
  },
  // Clearing uses the same revision as autosave; another tab's newer draft is never deleted.
  async clearSaved() {
    const current = get().session;
    if (current.pending) await current.pending;
    if (current.loaded && current.source !== null) { await get().discard(); if (get().session === current) set({ status: '草稿已轉為正式版本。' }); }
  },
  retry: () => set(state => ({ tick: state.tick + 1 })),
}));

export interface CloudDraftView { ready: boolean; recovery: Draft | null; status: string; conflict: boolean; unsynced: boolean }
export function useCloudDraftView(): CloudDraftView {
  const userId = useSession().user?.id, selectedId = useWorkbench(state => state.selectedId);
  const editorSource = useWorkbench(state => state.editor.source), changed = useWorkbench(state => state.hasEdits);
  const { session, loadedFlag, recovery, status, saved } = useCloudDraft(useShallow(state => ({ session: state.session, loadedFlag: state.loadedFlag, recovery: state.recovery, status: state.status, saved: state.saved })));
  const target = draftTarget(userId, selectedId);
  return { ready: !target || (loadedFlag && session.target === target), recovery, status, conflict: session.conflict, unsynced: changed && (!target || editorSource !== saved) };
}

export function useCloudDraftSync() {
  const userId = useSession().user?.id, selectedId = useWorkbench(state => state.selectedId), initialized = useWorkbench(state => state.initialized);
  const tick = useCloudDraft(state => state.tick);
  const target = draftTarget(userId, selectedId);
  useEffect(() => useCloudDraft.getState().load(userId, selectedId, initialized), [target, initialized, tick]);
  const { ready, recovery } = useCloudDraftView();
  const changed = useWorkbench(state => state.hasEdits), source = useWorkbench(state => state.editor.source), saved = useCloudDraft(state => state.saved);
  useEffect(() => {
    if (!target || !ready || !changed || recovery || saved === source) return;
    const timer = setTimeout(() => { useCloudDraft.getState().flush().catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [target, ready, changed, recovery, source, saved]);
}
