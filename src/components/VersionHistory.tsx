import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { Modal } from './Modal.tsx';
import { ExportMenu } from './ExportMenu.tsx';
import { buildDiffRows, summarizeSpecChanges, type DiffRow } from '../lib/diff.ts';
import { changelogMarkdown } from '../lib/changelog.ts';
import { baseName } from '../lib/export.ts';
import { saveFile } from '../lib/download.ts';
import { useUserId, useVersions, versionQuery } from '../state/queries.ts';
import { useWorkbench } from '../state/workbench.ts';
import type { SpecChangeSummary } from '../lib/spec-diff.ts';
const date = (value: string) => new Date(value).toLocaleString('zh-TW');
export function VersionHistory({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { currentVersion, busy, error: workbenchError, restoreVersion } = useWorkbench(useShallow(state => ({ currentVersion: state.currentVersion, busy: state.busy, error: state.error, restoreVersion: state.restoreVersion })));
  const userId = useUserId(), history = useVersions(documentId);
  const [selected, setSelected] = useState(currentVersion ?? 1), [compare, setCompare] = useState('');
  const [riskFilter, setRiskFilter] = useState('all'), [confirmRestore, setConfirmRestore] = useState(false), [notice, setNotice] = useState(''), [copyError, setCopyError] = useState('');
  const versions = history.data?.pages.flatMap(page => page.versions) ?? [];
  const [selectedQuery, compareQuery] = useQueries({ queries: [versionQuery(userId, documentId, selected), { ...versionQuery(userId, documentId, compare || 0), enabled: !!compare }] });
  const loading = selectedQuery.isPending || (!!compare && compareQuery.isPending);
  const version = loading ? undefined : selectedQuery.data;
  const comparison = useMemo((): { diff: { rows: DiffRow[]; summary: SpecChangeSummary } | null; error: string } => {
    if (!compare || !selectedQuery.data || !compareQuery.data) return { diff: null, error: '' };
    try { return { diff: { rows: buildDiffRows(compareQuery.data.source, selectedQuery.data.source), summary: summarizeSpecChanges(compareQuery.data.spec, selectedQuery.data.spec) }, error: '' }; }
    catch (error) { return { diff: null, error: (error as Error).message }; }
  }, [compare, selectedQuery.data, compareQuery.data]);
  const diff = comparison.diff;
  const error = copyError || comparison.error || history.error?.message || selectedQuery.error?.message || compareQuery.error?.message || '';
  const changelog = () => changelogMarkdown({ title: version!.title, from: compare, to: selected, summary: diff!.summary });
  async function copyChangelog() {
    try { await navigator.clipboard.writeText(changelog()); setNotice('已複製 Markdown 變更紀錄。'); }
    catch { setCopyError('無法存取剪貼簿，請改用下載。'); }
  }
  async function restore() {
    if (await restoreVersion(selected)) onClose();
  }
  const select = (next: number) => { setSelected(next); setCompare(''); setConfirmRestore(false); setNotice(''); setCopyError(''); };
  return <Modal wide title="版本歷史" onClose={onClose}>
    <p className="muted">每次儲存保留一份版本。還原會新增版本，不會刪除後續修改。</p>
    <div className="versions-layout"><aside className="versions-sidebar" aria-label="選擇版本">
      {versions.map(item => <button key={item.version} type="button" className={'version-item' + (item.version === selected ? ' selected' : '')} aria-pressed={item.version === selected} onClick={() => select(item.version)}>
        <strong>v{item.version}{item.version === currentVersion ? ' · 目前' : ''}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time><span>{item.note || '更新文件內容'}</span>
      </button>)}
      {history.hasNextPage && <button className="text-button" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>載入更早版本</button>}
    </aside><section className="version-content" aria-label="版本內容">
      <div className="version-controls"><label>比較基準<select value={compare} onChange={event => { setCompare(event.target.value); setNotice(''); setCopyError(''); }}><option value="">檢視原始內容</option>{versions.map(item => <option key={item.version} value={item.version}>v{item.version} → v{selected}</option>)}</select></label>
        <ExportMenu preview={version ?? null} />
        <button className="button primary" disabled={busy || loading || !version || selected === currentVersion} onClick={() => setConfirmRestore(true)}>還原此版本</button>
      </div>
      {confirmRestore && <div className="restore-confirm" role="group" aria-label="確認還原版本"><p>將 v{selected} 還原為新版本？編輯區尚未儲存的內容會被替換，已儲存的版本都會保留。</p><div className="form-actions"><button className="button" disabled={busy} onClick={() => setConfirmRestore(false)}>取消</button><button className="button primary" disabled={busy} onClick={restore}>{busy ? '正在還原…' : '確認還原'}</button></div></div>}
      {error && <p className="error" role="alert">{error}</p>}{workbenchError && <p className="error" role="alert">{workbenchError}</p>}
      {loading && <p role="status">正在讀取版本…</p>}
      {!loading && version && <><h3>{version.title} <span className="version-chip">v{selected}</span></h3>
        {diff ? <><p className="muted">− 移除　＋ 新增 · 比較 v{compare} → v{selected}</p>
          <div className="diff-metrics"><strong>{diff.summary.changes.length} 項變更</strong><span>{diff.summary.changes.filter(c => c.risk === 'breaking').length} 項可能破壞相容性</span><span>{diff.summary.changes.filter(c => c.risk === 'review').length} 項待確認</span>
            <button className="text-button" onClick={copyChangelog}>複製 Markdown</button>
            <button className="text-button" onClick={() => saveFile({ name: `${baseName(version.fileName)}-v${compare}-v${selected}-changelog.md`, type: 'text/markdown;charset=utf-8', content: changelog() })}>下載變更紀錄</button></div>
          {notice && <p className="status" role="status">{notice}</p>}
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
