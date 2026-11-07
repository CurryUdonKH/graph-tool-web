// Excel 形式の範囲を、実際のシート内の座標に変換する。
export function parseCellRange(input, rows) {
  const match = /^\s*\$?([a-z]+)\$?([1-9]\d*)\s*(?::\s*\$?([a-z]+)\$?([1-9]\d*))?\s*$/i.exec(input);
  if (!match) throw new Error('範囲は A1 または B3:D20 の形で入力してください。');
  const col = value => [...value.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const r0 = Number(match[2]) - 1, c0 = col(match[1]);
  const r1 = Number(match[4] || match[2]) - 1, c1 = col(match[3] || match[1]);
  const maxCols = rows.reduce((n, row) => Math.max(n, row?.length || 0), 0);
  if (![r0, r1, c0, c1].every(Number.isSafeInteger) || Math.min(r0, r1) < 0 || Math.min(c0, c1) < 0 || Math.max(r0, r1) >= rows.length || Math.max(c0, c1) >= maxCols)
    throw new Error('範囲がシートの外です。行番号と列記号を確認してください。');
  return { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
}

// 見出しで列・行を選ぶ。もう一方の選択を保ち、元のシート順で並べる。
export function selectHeader(previous, axis, index, source, { additive = false, extend = false } = {}) {
  const isColumn = axis === 'cols', start = isColumn ? 'c0' : 'r0', end = isColumn ? 'c1' : 'r1';
  const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const old = previous?.[axis] || []; // まだ指定していない軸は、最初のクリックから選び始める。
  let chosen = [index];
  if (extend && previous) chosen = span(Math.min(previous[start], index), Math.max(previous[end], index));
  else if (additive && previous) chosen = old.includes(index) ? old.filter(i => i !== index) : [...old, index];
  if (!chosen.length) return previous; // 最後の一つは残す。
  chosen.sort((a, b) => a - b);
  const cols = source.reduce((n, row) => Math.max(n, row?.length || 0), 1);
  const next = { r0: 0, r1: Math.max(0, source.length - 1), c0: 0, c1: cols - 1, ...previous,
    header: previous?.header !== false, [axis]: chosen, [start]: chosen[0], [end]: chosen.at(-1) };
  if (isColumn && !previous?.rows && (!previous || previous.cols)) {
    let first = -1, last = -1;
    source.forEach((row, r) => {
      if (chosen.some(c => row?.[c] != null && String(row[c]).trim() !== '')) {
        if (first < 0) first = r;
        last = r;
      }
    });
    next.r0 = Math.max(0, first); next.r1 = Math.max(0, last);
  }
  return next;
}

export function containsCell(range, row, col) {
  if (range?.areas) return range.areas.some(area => containsCell(area, row, col));
  return !!range && row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1
    && (!range.rows || range.rows.includes(row)) && (!range.cols || range.cols.includes(col));
}

// 複数範囲は元の座標のまま保持する。離れた範囲の間のセルは含めない。
export const selectionAreas = range => !range ? [] : range.areas || [range];
export function selectionAxis(range, axis) {
  const start = axis === 'rows' ? 'r0' : 'c0', end = axis === 'rows' ? 'r1' : 'c1';
  const indexes = new Set();
  for (const area of selectionAreas(range)) {
    const values = area[axis] || Array.from({length: area[end] - area[start] + 1}, (_, i) => area[start] + i);
    for (const i of values) if (i >= area[start] && i <= area[end]) indexes.add(i);
  }
  return [...indexes].sort((a, b) => a - b);
}
export function selectArea(previous, area, additive = false) {
  const boxes = additive ? selectionAreas(previous).map(({r0,r1,c0,c1,rows,cols}) => ({r0,r1,c0,c1,...(rows ? {rows} : {}),...(cols ? {cols} : {})})) : [];
  const same = boxes.findIndex(b => !b.rows && !b.cols && ['r0','r1','c0','c1'].every(k => b[k] === area[k]));
  if (same >= 0) { if (boxes.length > 1) boxes.splice(same, 1); }
  else boxes.push(area);
  const range = { areas: boxes, header: previous?.header !== false };
  range.rows = selectionAxis(range, 'rows'); range.cols = selectionAxis(range, 'cols');
  return {...range, r0:range.rows[0], r1:range.rows.at(-1), c0:range.cols[0], c1:range.cols.at(-1)};
}
export function selectionTSV(source, range) {
  const quote = value => {
    const text = String(value ?? '');
    return /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const cols = selectionAxis(range, 'cols');
  return selectionAxis(range, 'rows').map(r => cols.map(c => containsCell(range, r, c) ? quote(source[r]?.[c]) : '').join('\t')).join('\n');
}
export function parseCellRanges(input, source) {
  const parts = input.split(/[,，;]/).map(s => s.trim());
  if (parts.some(s => !s)) throw new Error('セル範囲をカンマで区切って入力してください。例: A1:A10, C1:C10');
  let result = null;
  for (const part of parts) {
    const area = parseCellRange(part, source);
    // 重複した入力は追加選択の解除と扱わない。
    if (!selectionAreas(result).some(a => ['r0','r1','c0','c1'].every(k => a[k] === area[k]))) result = selectArea(result, area, true);
  }
  return result;
}
