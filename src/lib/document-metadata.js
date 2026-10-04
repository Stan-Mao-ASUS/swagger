export function metadataPatch(item, name, category) {
  const patch = { categoryId: category || null };
  // Legacy API titles can be 500 characters; only a newly edited display name has the 200-character limit.
  if (name !== (item.displayName || item.title)) {
    const value = name.trim();
    if (!value || value.length > 200) throw new Error('名稱請填寫 1–200 個字。');
    patch.displayName = value;
  }
  return patch;
}
