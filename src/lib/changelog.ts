import type { SpecChangeSummary } from './spec-diff.ts';
const sections: [string, string][] = [['breaking', '可能不相容'], ['review', '需要人工確認'], ['info', '一般變更']];
const verbs: Record<string, string> = { added: '新增', removed: '移除', changed: '變更' };
const inline = (value: unknown) => String(value).replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|#]/g, '\\$&');
export function changelogMarkdown({ title, from, to, summary }: { title: string; from: number | string; to: number | string; summary: SpecChangeSummary }): string {
  const lines = [`# ${inline(title)} 變更紀錄`, '', `v${from} → v${to} · ${summary.changes.length} 項變更`, ''];
  for (const [risk, heading] of sections) {
    const items = summary.changes.filter(change => change.risk === risk);
    if (items.length) lines.push(`## ${heading}（${items.length}）`, '', ...items.map(c => `- **${verbs[c.type] || '變更'}** ${inline(c.label)}${c.detail ? `（${inline(c.detail)}）` : ''}`), '');
  }
  if (!summary.changes.length) lines.push('未發現已涵蓋規則的 API 結構變動。', '');
  if (summary.warnings.length) lines.push('## 注意', '', ...summary.warnings.map(warning => `- ${inline(warning)}`), '');
  lines.push('> 相容性標示為規則式輔助判斷，不代表完整相容性保證。', '');
  return lines.join('\n');
}
