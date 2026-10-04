const sourceLabels = { upload: '上傳', paste: '貼上', import: '匯入' };

export function DocumentHistory({ session, busy, items, nextOffset, selectedId, historyError, onRefresh, onOpen, onDelete, onLibrary }) {
  const message = historyError || (session.loading ? '正在讀取…' : !session.user ? '登入後查看你的文件。' : !items.length ? '尚無文件。上傳檔案或貼上 YAML 後即可儲存。' : '');
  return <section className="history" aria-labelledby="history-title">
    <div className="editor-heading">
      <h2 id="history-title">我的文件歷史</h2>{session.user && <button className="text-button" type="button" onClick={onLibrary}>管理文件</button>}
      <button id="history-refresh" className="text-button" type="button" disabled={busy || !session.user} onClick={() => onRefresh(false)}>重新整理</button>
    </div>
    <p id="history-status" role="status">{message}</p>
    <ul id="history-list">{items.map(item => <li className="history-item" key={item.id}>
      <button type="button" className="history-open" disabled={busy} aria-label={'開啟 ' + (item.displayName || item.title)} aria-current={selectedId === item.id ? 'true' : undefined} onClick={() => onOpen(item.id)}>
        <strong>{(item.displayName || item.title)}</strong><span>{item.fileName} · {sourceLabels[item.sourceType] || item.sourceType}</span>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-TW')}</time>
      </button>
      <button type="button" className="history-delete" disabled={busy} aria-label={'刪除 ' + (item.displayName || item.title)} onClick={() => onDelete(item)}>刪除</button>
    </li>)}</ul>
    {nextOffset !== null && <button id="history-more" className="text-button" type="button" disabled={busy} onClick={() => onRefresh(true)}>載入更多</button>}
  </section>;
}
