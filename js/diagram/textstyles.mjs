// 文字の編集に合わせて、部分書式の位置を保つ。
export function remapStyles(before, after, styles) {
  if (!Array.isArray(styles) || !styles.some(Boolean)) return [];
  let a = 0, b = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  const insertionStyle = styles[Math.max(0, a - 1)] || null;
  return [...styles.slice(0, a), ...Array(after.length - a - b).fill(insertionStyle), ...styles.slice(before.length - b, before.length)];
}
