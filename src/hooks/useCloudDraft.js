import { useEffect, useRef, useState } from 'react';

export function useCloudDraft({ userId, documentId, initialized, editor, baseVersion, changed, request, restore }) {
  const target = userId ? `${userId}/${documentId || 'new'}` : null;
  const path = '/api/drafts/' + (documentId || 'new');
  const state = useRef({ target: null, revision: 0, source: null, loaded: false, pending: null, conflict: false });
  const latest = useRef(null);
  const [recovery, setRecovery] = useState(null), [status, setStatus] = useState(''), [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(null), [tick, setTick] = useState(0);
  latest.current = { editor, baseVersion, changed, target };
  useEffect(() => {
    const current = { target, revision: 0, source: null, loaded: false, pending: null, conflict: false };
    state.current = current; setReady(!target); setRecovery(null); setSaved(null); setStatus('');
    if (!target || !initialized) return;
    const controller = new AbortController();
    request(path, { signal: controller.signal }).then(data => {
      if (state.current !== current || controller.signal.aborted) return;
      current.revision = data.revision; current.source = data.draft?.source ?? null; current.loaded = true;
      setSaved(current.source);
      if (data.draft && data.draft.source !== latest.current.editor.source) setRecovery(data.draft);
      else setReady(true);
      setStatus(data.draft ? '找到雲端草稿。' : '編輯後會自動保存草稿。');
    }).catch(error => { if (state.current === current && !controller.signal.aborted) setStatus('無法讀取草稿：' + error.message); });
    return () => controller.abort();
  }, [target, initialized, tick]);

  async function flush() {
    const current = state.current;
    if (!target) return;
    if (!current.loaded || !ready || current.conflict) throw new Error('草稿尚未準備好，請先處理草稿提示。');
    while (current.pending) await current.pending;
    if (state.current !== current || latest.current.target !== target) return;
    const value = latest.current;
    if (!value.changed || current.source === value.editor.source) return;
    const job = (async () => {
      setStatus('正在保存雲端草稿…');
      try {
        const data = await request(path, { method: 'PUT', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-draft-revision': String(current.revision), 'x-file-name': encodeURIComponent(value.editor.fileName), 'x-source-type': value.editor.sourceType, 'x-base-version': String(value.baseVersion || 0) }, body: value.editor.source });
        if (state.current !== current) return;
        current.revision = data.revision; current.source = value.editor.source; setSaved(value.editor.source);
        setStatus('草稿已保存至帳號 · ' + new Date(data.updatedAt).toLocaleTimeString('zh-TW'));
      } catch (error) {
        if (state.current === current) { current.conflict = error.status === 409; setStatus('草稿未同步：' + error.message); }
        throw error;
      } finally { if (state.current === current) current.pending = null; }
    })();
    current.pending = job;
    await job;
  }
  useEffect(() => {
    if (!target || !ready || !changed || recovery || saved === editor.source) return;
    const timer = setTimeout(() => { flush().catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [target, ready, changed, recovery, editor.source, saved]);

  async function discard() {
    const current = state.current;
    if (current.pending) await current.pending;
    const result = await request(path, { method: 'DELETE', headers: { 'x-draft-revision': String(current.revision) } });
    if (state.current !== current) return;
    current.revision = result.revision; current.source = null;
    setSaved(null); setRecovery(null); setReady(true); setStatus('已捨棄雲端草稿，目前編輯內容保持不變。');
  }
  function recover() {
    if (!recovery) return;
    restore(recovery); setRecovery(null); setReady(true); setStatus('已恢復雲端草稿，尚未建立正式版本。');
  }
  // Clearing uses the same revision as autosave; another tab's newer draft is never deleted.
  async function clearSaved(source) {
    const current = state.current;
    if (current.pending) await current.pending;
    if (current.loaded && current.source !== null) { await discard(); if (state.current === current) setStatus('草稿已轉為正式版本。'); }
  }
  return { ready: !target || (ready && state.current.target === target), recovery, status, recover, discard, flush, clearSaved, retry: () => setTick(x => x + 1),
    unsynced: !!changed && (!target || editor.source !== saved), conflict: state.current.conflict };
}
