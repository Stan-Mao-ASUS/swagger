import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { parseDefinition } from '../lib/openapi.js';
import { DocumentPreview } from './DocumentPreview.jsx';
const date = value => new Date(value).toLocaleDateString('zh-TW');
export function SharedArea({ shareId, onOpen, onBrowse }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const [items, setItems] = useState([]), [nextOffset, setNextOffset] = useState(null), [publication, setPublication] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setPublication(null); setItems([]);
    api(shareId ? '/api/shared/' + encodeURIComponent(shareId) : '/api/shared?' + new URLSearchParams({ q: query, offset: String(offset) }), { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (shareId) setPublication({ ...data.publication, spec: parseDefinition(data.publication.source) });
      else { setItems(data.publications); setNextOffset(data.nextOffset); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shareId, query, offset, revision]);
  return <main className="shared-area">
    <div className="shared-heading"><div><span className="eyebrow">SHARED DOCUMENTS</span><h1>{shareId ? publication?.title || '分享文件' : '分享區'}</h1><p>{shareId ? publication?.summary || '這是發布者主動公開的文件版本。' : '瀏覽公開的 API 文件，或從你的工作台發布一份文件。'}</p></div>{shareId && <button className="button" onClick={onBrowse}>回到分享區</button>}</div>
    {!shareId && <form className="shared-search" onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(search.trim()); }}><input aria-label="搜尋分享文件" maxLength={200} placeholder="搜尋標題或說明" value={search} onChange={event => setSearch(event.target.value)} /><button className="button primary">搜尋</button></form>}
    {loading && <p className="shared-notice" role="status">正在讀取分享文件…</p>}
    {error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => setRevision(n => n + 1)}>重試</button></div>}
    {!loading && !error && (shareId ? publication && <><p className="shared-meta">公開版本 v{publication.version} · 更新於 {date(publication.updatedAt)} · 唯讀</p><DocumentPreview preview={publication} readOnly /></> : <>
      {items.length ? <div className="shared-grid">{items.map(item => <article className="shared-card" key={item.id}><span className="version-chip">v{item.version}</span><h2><a href={'/?share=' + item.id} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpen(item.id); } }}>{item.title}</a></h2><p>{item.summary || '發布者未填寫說明。'}</p><time dateTime={item.updatedAt}>更新於 {date(item.updatedAt)}</time></article>)}</div> : <div className="shared-empty"><h2>{query ? '沒有符合的分享文件' : '還沒有公開文件'}</h2><p>{query ? '試試其他關鍵字。' : '開啟自己的文件，選擇「發布到分享區」即可分享。'}</p></div>}
      {(offset > 0 || nextOffset !== null) && <div className="shared-pagination"><button className="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 24))}>上一頁</button><span>第 {Math.floor(offset / 24) + 1} 頁</span><button className="button" disabled={nextOffset === null} onClick={() => setOffset(nextOffset)}>下一頁</button></div>}
    </>)}
  </main>;
}
