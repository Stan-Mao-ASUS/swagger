import { diffLines } from 'diff';

export { summarizeSpecChanges } from './spec-diff.ts';

// Flat line diff with long unchanged runs collapsed into expandable markers.
export type DiffLine = { type: 'added' | 'removed' | 'same'; text: string };
export type DiffRow = DiffLine | { type: 'collapsed'; count: number; lines: DiffLine[] };
export function buildDiffRows(oldSource: string, newSource: string, context = 3): DiffRow[] {
  const raw: DiffLine[] = [];
  if (oldSource.length + newSource.length > 800000 || oldSource.split('\n').length + newSource.split('\n').length > 12000) throw new Error('文件較大，請下載兩個版本後使用本機工具比較。');
  const parts = diffLines(oldSource, newSource, { timeout: 600, maxEditLength: 4000 });
  if (!parts) throw new Error('差異較多，請下載兩個版本後使用本機工具比較。');
  for (const part of parts) {
    const type = part.added ? 'added' : part.removed ? 'removed' : 'same';
    for (const line of part.value.replace(/\n$/, '').split('\n')) raw.push({ type, text: line });
  }
  const segments: DiffRow[] = []; let i = 0;
  while (i < raw.length) {
    if (raw[i].type !== 'same') { segments.push(raw[i]); i++; continue; }
    let j = i;
    while (j < raw.length && raw[j].type === 'same') j++;
    const run = raw.slice(i, j);
    if (run.length <= context * 2 + 1) segments.push(...run);
    else segments.push(...run.slice(0, context), { type: 'collapsed', count: run.length - context * 2, lines: run.slice(context, run.length - context) }, ...run.slice(run.length - context));
    i = j;
  }
  return segments;
}
