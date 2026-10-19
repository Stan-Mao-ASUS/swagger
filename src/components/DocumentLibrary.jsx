import { queryString } from '../lib/library-query.js';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { DocumentEditDialog } from './DocumentEditDialog.jsx';
const initialFilters = { q: '', category: '', from: '', to: '', sort: 'created' };
const sourceLabels = { upload: '上傳', paste: '貼上', import: '匯入' };
const matchLabels = { path: '路徑', operationId: 'operationId', tag: 'tag', schema: 'Schema', summary: '摘要' };
const dateTime = value => new Date(value).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function CategoryRow({ item, busy, onRename, onDelete }) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  return <form className="category-row" onSubmit={event => { event.preventDefault(); onRename(item.id, name); }}>
    <input aria-label={'分類名稱：' + item.name} value={name} maxLength={80} required disabled={busy} onChange={event => setName(event.target.value)} />
    <button className="text-button" disabled={busy || name.trim() === item.name} type="submit">改名</button>
    <button className="text-button danger-text" disabled={busy} type="button" onClick={() => onDelete(item)}>移除</button>
  </form>;
}
export function DocumentLibrary({ workbench: w, onClose }) {
  const [draft, setDraft] = useState(initialFilters); const [filters, setFilters] = useState(initialFilters);
  const [items, setItems] = useState([]); const [categories, setCategories] = useState([]);
  const [offset, setOffset] = useState(0); const [nextOffset, setNextOffset] = useState(null);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [editing, setEditing] = useState(null);
  const [categoryName, setCategoryName] = useState(''); const pending = useRef(false);
  const busy = loading || saving || w.busy;
  const refresh = () => { setOffset(0); setRevision(value => value + 1); };
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    if (offset === 0) setItems([]);
    Promise.resolve().then(() => Promise.all([w.request('/api/documents?' + queryString(filters, offset), { signal: controller.signal }), w.request('/api/categories', { signal: controller.signal })])).then(([data, groups]) => {
      if (controller.signal.aborted) return;
      setItems(previous => offset ? [...previous, ...data.documents] : data.documents);
      setNextOffset(data.nextOffset); setCategories(groups.categories);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setNextOffset(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, offset, revision]);
  async function mutate(path, method, body) {
    return w.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function action(operation, message) {
    if (pending.current || busy) return;
    pending.current = true; setSaving(true); setError(''); setNotice('');
    try { await operation(); setNotice(message); refresh(); await w.refreshHistory(false); }
    catch (error) { setError(error.message); }
    finally { pending.current = false; setSaving(false); }
  }
  const changeFilter = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  function applyFilters(event) {
    event.preventDefault();
    try { queryString(draft, 0); } catch (error) { setError(error.message); return; }
    setOffset(0); setFilters({ ...draft }); setNotice('');
  }
  return <Modal wide title="我的文件" onClose={() => { if (!saving && !w.busy) onClose(); }}>
    <p className="library-intro">整理名稱與分類，隨時開啟已儲存的 API 文件。搜尋也會比對目前版本的路徑、operationId、tag、Schema 名稱與摘要；較早儲存的文件開啟一次後才納入內容搜尋。</p>
    <form className="library-filters" onSubmit={applyFilters}>
      <label className="search-field">搜尋<input type="search" placeholder="名稱、檔名、路徑、operationId、tag 或 Schema" value={draft.q} maxLength={200} onChange={event => changeFilter('q', event.target.value)} /></label>
      <label>分類<select value={draft.category} onChange={event => changeFilter('category', event.target.value)}><option value="">全部分類</option><option value="uncategorized">未分類</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>建立日期起<input type="date" value={draft.from} onInput={event => changeFilter('from', event.target.value)} onChange={event => changeFilter('from', event.target.value)} /></label>
      <label>建立日期迄<input type="date" value={draft.to} onInput={event => changeFilter('to', event.target.value)} onChange={event => changeFilter('to', event.target.value)} /></label>
      <label>排序<select value={draft.sort} onChange={event => changeFilter('sort', event.target.value)}><option value="created">最近新增</option><option value="updated">最近修改</option><option value="name">名稱 A–Z</option></select></label>
      <div className="filter-actions"><button className="button render-button" disabled={busy}>套用篩選</button><button className="text-button" type="button" disabled={busy} onClick={() => { setDraft(initialFilters); setFilters({ ...initialFilters }); setOffset(0); }}>清除</button></div>
    </form>
    <details className="category-manager"><summary>管理分類 <span className="muted">{categories.length}</span></summary>
      <p className="muted">移除分類後，文件會移至「未分類」。</p>
      <form className="category-row" onSubmit={event => { event.preventDefault(); action(async () => { await mutate('/api/categories', 'POST', { name: categoryName.trim() }); setCategoryName(''); }, '已新增分類。'); }}>
        <input aria-label="新分類名稱" placeholder="例如：會員系統" maxLength={80} required value={categoryName} disabled={busy} onChange={event => setCategoryName(event.target.value)} />
        <button className="button" disabled={busy || !categoryName.trim()}>新增分類</button>
      </form>
      <div className="category-list">{categories.map(item => <CategoryRow key={item.id} item={item} busy={busy}
        onRename={(id, name) => action(() => mutate('/api/categories/' + id, 'PATCH', { name: name.trim() }), '分類已更新。')}
        onDelete={item => { if (window.confirm(`移除分類「${item.name}」？文件會保留並移至「未分類」。`)) action(async () => {
          await mutate('/api/categories/' + item.id, 'DELETE');
          if (filters.category === item.id) setFilters(previous => ({ ...previous, category: '' }));
          if (draft.category === item.id) setDraft(previous => ({ ...previous, category: '' }));
        }, '分類已移除，文件已保留。'); }} />)}</div>
    </details>
    {error && <div role="alert" className="error">{error}<button type="button" className="text-button" onClick={refresh} disabled={busy}>重新整理</button></div>}
    {w.error && !error && <div role="alert" className="error">{w.error}</div>}
    <div className="library-status" role="status">{loading ? '正在讀取文件…' : notice || `已顯示 ${items.length} 份文件${nextOffset !== null ? '，可載入更多' : ''}`}</div>
    {!loading && !error && items.length === 0 && <div className="library-empty">沒有符合條件的文件。<span>調整篩選，或回到編輯區上傳、貼上 YAML。</span></div>}
    {items.length > 0 && <div className="document-table"><table><thead><tr><th>文件名稱</th><th>分類</th><th>來源</th><th>建立日期</th><th>最後修改</th><th>操作</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
      <td className="document-name" data-label="文件名稱"><button className="text-button" disabled={busy} onClick={async () => { if (await w.openDocument(item.id)) onClose(); }}>{item.displayName || item.title}</button><span>{item.fileName}</span>{item.matches?.length > 0 && <span className="search-matches">{item.matches.map(m => `${matchLabels[m.kind] || m.kind} ${m.value}`).join(' · ')}</span>}</td>
      <td data-label="分類"><span className="category-chip">{categories.find(category => category.id === item.categoryId)?.name || '未分類'}</span></td>
      <td data-label="來源">{sourceLabels[item.sourceType] || item.sourceType}</td>
      <td data-label="建立日期"><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></td>
      <td data-label="最後修改"><time dateTime={item.updatedAt}>{dateTime(item.updatedAt)}</time></td>
      <td className="row-actions" data-label="操作"><button className="text-button" disabled={busy} onClick={() => setEditing(item)} aria-label={'編輯 ' + (item.displayName || item.title)}>編輯</button><button className="text-button danger-text" disabled={busy} onClick={async () => { if (await w.deleteDocument(item)) { setNotice('文件已刪除。'); refresh(); } }} aria-label={'刪除 ' + (item.displayName || item.title)}>刪除</button></td>
    </tr>)}</tbody></table></div>}
    {nextOffset !== null && <button className="button load-more" disabled={busy} onClick={() => setOffset(nextOffset)}>載入更多</button>}
    {editing && <DocumentEditDialog item={editing} categories={categories} onClose={() => setEditing(null)} onSave={async (id, body) => {
      await mutate('/api/documents/' + id, 'PATCH', body); setNotice('文件資料已更新。'); refresh(); await w.refreshHistory(false);
    }} />}
  </Modal>;
}
