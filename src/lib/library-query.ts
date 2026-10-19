export interface LibraryFilters { q: string; category: string; from: string; to: string; sort: 'created' | 'updated' | 'name' }
function dateBoundary(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('請輸入有效的日期（年份為四位數）。');
  const date = new Date(value + 'T00:00:00');
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) throw new Error('請輸入有效的日期。');
  if (endOfDay) date.setDate(date.getDate() + 1);
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso)) throw new Error('日期超出支援範圍。');
  return iso;
}
export function queryString(filters: LibraryFilters, offset: number): string {
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('開始日期不能晚於結束日期。');
  const query = new URLSearchParams({ q: filters.q, category: filters.category, sort: filters.sort, offset: String(offset) });
  if (filters.from) query.set('from', dateBoundary(filters.from));
  if (filters.to) query.set('to', dateBoundary(filters.to, true));
  return query.toString();
}
