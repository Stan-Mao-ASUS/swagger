import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { ExportMenu } from './ExportMenu.jsx';
import { parseDefinition } from '../lib/openapi.js';
import { buildDiffRows, summarizeSpecChanges } from '../lib/diff.js';
const date = value => new Date(value).toLocaleString('zh-TW');
export function VersionHistory({ workbench: w, onClose }) {
  const [versions, setVersions] = useState([]), [nextOffset, setNextOffset] = useState(null);
  const [selected, setSelected] = useState(w.currentVersion), [compare, setCompare] = useState('');
  const [version, setVersion] = useState(null), [diff, setDiff] = useState(null);
  const [riskFilter, setRiskFilter] = useState('all');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const base = `/api/documents/${w.selectedId}/versions`;
  useEffect(() => {
    const controller = new AbortController();
    w.request(base, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setVersions(data.versions); setNextOffset(data.nextOffset);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [base]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setVersion(null); setDiff(null);
    Promise.all([selected, ...(compare ? [compare] : [])].map(n => w.request(`${base}/${n}`, { signal: controller.signal }))).then(([selectedVersion, older]) => {
      if (controller.signal.aborted) return;
      setVersion({ ...selectedVersion, spec: parseDefinition(selectedVersion.source) });
      if (older) setDiff({ rows: buildDiffRows(older.source, selectedVersion.source), summary: summarizeSpecChanges(parseDefinition(older.source), parseDefinition(selectedVersion.source)) });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, selected, compare]);
  async function loadMore() {
    setLoadingMore(true);
    try { const data = await w.request(`${base}?offset=${nextOffset}`); setVersions(old => [...old, ...data.versions]); setNextOffset(data.nextOffset); }
    catch (error) { setError(error.message); } finally { setLoadingMore(false); }
  }
  async function restore() {
    if (await w.restoreVersion(selected)) onClose();
  }
  return <Modal wide title="版本歷史" onClose={onClose}>
    <p className="muted">每次儲存保留一份版本。還原會新增版本，不會刪除後續修改。</p>
    <div className="versions-layout"><aside className="versions-sidebar" aria-label="選擇版本">
      {versions.map(item => <button key={item.version} type="button" className={'version-item' + (item.version === selected ? ' selected' : '')} aria-pressed={item.version === selected} onClick={() => { setSelected(item.version); setCompare(''); setConfirmRestore(false); }}>
        <strong>v{item.version}{item.version === w.currentVersion ? ' · 目前' : ''}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time><span>{item.note || '更新文件內容'}</span>
      </button>)}
      {nextOffset !== null && <button className="text-button" disabled={loadingMore} onClick={loadMore}>載入更早版本</button>}
    </aside><section className="version-content" aria-label="版本內容">
      <div className="version-controls"><label>比較基準<select value={compare} onChange={event => setCompare(event.target.value)}><option value="">檢視原始內容</option>{versions.map(item => <option key={item.version} value={item.version}>v{item.version} → v{selected}</option>)}</select></label>
        <ExportMenu preview={version} />
        <button className="button primary" disabled={w.busy || loading || !version || selected === w.currentVersion} onClick={() => setConfirmRestore(true)}>還原此版本</button>
      </div>
      {confirmRestore && <div className="restore-confirm" role="group" aria-label="確認還原版本"><p>將 v{selected} 還原為新版本？編輯區尚未儲存的內容會被替換，已儲存的版本都會保留。</p><div className="form-actions"><button className="button" disabled={w.busy} onClick={() => setConfirmRestore(false)}>取消</button><button className="button primary" disabled={w.busy} onClick={restore}>{w.busy ? '正在還原…' : '確認還原'}</button></div></div>}
      {error && <p className="error" role="alert">{error}</p>}{w.error && <p className="error" role="alert">{w.error}</p>}
      {loading && <p role="status">正在讀取版本…</p>}
      {!loading && version && <><h3>{version.title} <span className="version-chip">v{selected}</span></h3>
        {diff ? <><p className="muted">− 移除　＋ 新增 · 比較 v{compare} → v{selected}</p>
          <div className="diff-metrics"><strong>{diff.summary.changes.length} 項變更</strong><span>{diff.summary.changes.filter(c => c.risk === 'breaking').length} 項可能破壞相容性</span><span>{diff.summary.changes.filter(c => c.risk === 'review').length} 項待確認</span></div>
          <label className="diff-filter">變更篩選<select value={riskFilter} onChange={e => setRiskFilter(e.target.value)}><option value="all">全部變更</option><option value="breaking">可能破壞相容性</option><option value="review">需要人工確認</option><option value="info">一般變更</option></select></label>
          {diff.summary.warnings.map((warning, i) => <p className="error" key={i}>{warning}</p>)}
          <ul className="diff-summary">{diff.summary.changes.filter(c => riskFilter === 'all' || c.risk === riskFilter).map((change, i) => <li key={i} className={'risk-' + change.risk}><span className="risk-badge">{change.risk === 'breaking' ? '可能不相容' : change.risk === 'review' ? '待確認' : '一般'}</span> {change.type === 'removed' ? '−' : change.type === 'added' ? '+' : '~'} {change.label}{change.detail && <small>{change.detail}</small>}</li>)}</ul>
          {!diff.summary.changes.length && <p className="muted">未發現已涵蓋規則的 API 結構變動。</p>}
          <p className="muted">相容性標示是輔助判斷，包含參數、Request／Response、Schema 與授權規則；不代表完整相容性保證。請一併檢查原始差異。</p>
          <div className="diff-view">{diff.rows.map((row, i) => row.type === 'collapsed' ? <details key={i}><summary>… {row.count} 行相同 …</summary>{row.lines.map((line, n) => <pre key={n}>{'  '}{line.text || ' '}</pre>)}</details> : <pre key={i} className={'diff-line ' + row.type}>{row.type === 'added' ? '+ ' : row.type === 'removed' ? '− ' : '  '}{row.text || ' '}</pre>)}</div></>
          : <><pre className="version-source">{version.source.slice(0, 500000)}</pre>{version.source.length > 500000 && <p className="muted">畫面僅顯示前 500,000 字元；下載可取得完整內容。</p>}</>}
      </>}
    </section></div>
  </Modal>;
}
