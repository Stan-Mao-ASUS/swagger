import { useMemo, useState } from 'react';
import { Modal } from './Modal.tsx';
import { operationsOf, requestSnippets, type Snippets } from '../lib/snippets.ts';
import type { SpecNode } from '../../shared/types.ts';
const languages: [keyof Omit<Snippets, 'url'>, string][] = [['curl', 'curl'], ['javascript', 'JavaScript fetch'], ['python', 'Python requests']];
export function RequestSnippets({ spec, onClose }: { spec: SpecNode; onClose: () => void }) {
  const ops = useMemo(() => operationsOf(spec), [spec]);
  const [label, setLabel] = useState(ops[0]?.label ?? ''), [language, setLanguage] = useState<keyof Omit<Snippets, 'url'>>('curl'), [status, setStatus] = useState('');
  const selected = ops.find(op => op.label === label) ?? ops[0];
  const snippets = useMemo(() => { try { return selected ? requestSnippets(spec, selected, window.location.origin) : null; } catch (error) { return { error: (error as Error).message }; } }, [spec, selected]);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setStatus('已複製程式碼。'); } catch { setStatus('無法存取剪貼簿，請手動選取複製。'); }
  }
  return <Modal wide title="程式碼範例" onClose={onClose}>
    <p className="muted">依規格產生呼叫範例：必填參數與 JSON Request Body 使用 Schema 示範值，授權資訊以 &lt;TOKEN&gt;、&lt;API_KEY&gt; 等佔位符表示，請換成實際值。伺服器網址取自 servers（Swagger 2 為 host 與 basePath）。</p>
    {!ops.length ? <p className="muted">此文件沒有可產生範例的端點。</p> : <>
      <div className="mock-options"><label>端點<select value={selected?.label} onChange={event => { setLabel(event.target.value); setStatus(''); }}>{ops.map(op => <option key={op.label}>{op.label}</option>)}</select></label>
        <label>語言<select value={language} onChange={event => { setLanguage(event.target.value as typeof language); setStatus(''); }}>{languages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      {snippets && 'error' in snippets ? <p className="error" role="alert">{snippets.error}</p> : snippets && <>
        <pre className="mock-output snippet-output">{snippets[language]}</pre>
        <div className="form-actions"><button className="button primary" onClick={() => copy(snippets[language])}>複製程式碼</button></div>
      </>}
    </>}
    {status && <p className="status" role="status">{status}</p>}
  </Modal>;
}
