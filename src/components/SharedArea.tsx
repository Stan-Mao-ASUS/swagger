import { useState } from 'react';
import { DocumentPreview } from './DocumentPreview.tsx';
import { useSharedDocument, useSharedList } from '../state/queries.ts';
const date = (value: string) => new Date(value).toLocaleDateString('zh-TW');
export function SharedArea({ shareId, onOpen, onBrowse }: { shareId: string | null; onOpen(id: string): void; onBrowse(): void }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const list = useSharedList(query, offset, !shareId), item = useSharedDocument(shareId);
  const current = shareId ? item : list, loading = current.isFetching, error = current.error?.message || '';
  const publication = item.data ?? null, items = list.data?.publications ?? [], nextOffset = list.data?.nextOffset ?? null;
  return <main className="shared-area">
    <div className="shared-heading"><div><span className="eyebrow">SHARED DOCUMENTS</span><h1>{shareId ? publication?.title || '分享文件' : '分享區'}</h1><p>{shareId ? publication?.summary || '這是擁有者選定的分享版本。' : '瀏覽公開的 API 文件，或從你的工作台發布一份文件。'}</p></div>{shareId && <button className="button" onClick={onBrowse}>回到分享區</button>}</div>
    {!shareId && <form className="shared-search" onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(search.trim()); }}><input aria-label="搜尋分享文件" maxLength={200} placeholder="搜尋標題或說明" value={search} onChange={event => setSearch(event.target.value)} /><button className="button primary">搜尋</button></form>}
    {loading && <p className="shared-notice" role="status">正在讀取分享文件…</p>}
    {error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => current.refetch()}>重試</button></div>}
    {!loading && !error && (shareId ? publication && <><p className="shared-meta">{publication.visibility === 'unlisted' ? '持連結分享' : '公開版本'} v{publication.version} · 更新於 {date(publication.updatedAt)} · 唯讀</p><DocumentPreview preview={publication} readOnly /></> : <>
      {items.length ? <div className="shared-grid">{items.map(item => <article className="shared-card" key={item.id}><span className="version-chip">v{item.version}</span><h2><a href={'/?share=' + item.id} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpen(item.id); } }}>{item.title}</a></h2><p>{item.summary || '發布者未填寫說明。'}</p><time dateTime={item.updatedAt}>更新於 {date(item.updatedAt)}</time></article>)}</div> : <div className="shared-empty"><h2>{query ? '沒有符合的分享文件' : '還沒有公開文件'}</h2><p>{query ? '試試其他關鍵字。' : '開啟自己的文件，選擇「分享權限」後設為公開分享區即可分享。'}</p></div>}
      {(offset > 0 || nextOffset !== null) && <div className="shared-pagination"><button className="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 24))}>上一頁</button><span>第 {Math.floor(offset / 24) + 1} 頁</span><button className="button" disabled={nextOffset === null} onClick={() => setOffset(nextOffset ?? offset)}>下一頁</button></div>}
    </>)}
  </main>;
}
