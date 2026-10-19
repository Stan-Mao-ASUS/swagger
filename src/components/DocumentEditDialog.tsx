import { useRef, useState } from 'react';
import { metadataPatch } from '../lib/document-metadata.ts';
import { Modal } from './Modal.tsx';
import type { FormEvent } from 'react';
import type { Category, DocumentPatch, DocumentSummary } from '../../shared/types.ts';
export function DocumentEditDialog({ item, categories, onSave, onClose }: { item: DocumentSummary; categories: Category[]; onSave(id: string, patch: DocumentPatch): Promise<void>; onClose(): void }) {
  const [name, setName] = useState(item.displayName || item.title);
  const [category, setCategory] = useState(item.categoryId || '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { await onSave(item.id, metadataPatch(item, name, category)); onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="編輯文件資料" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit} className="edit-form">
      <label>文件名稱<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>分類<select value={category} disabled={busy} onChange={event => setCategory(event.target.value)}><option value="">未分類</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="muted">原始檔名：{item.fileName}<br />API title：{item.title}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button render-button" disabled={busy}>{busy ? '儲存中…' : '儲存變更'}</button></div>
    </form>
  </Modal>;
}
