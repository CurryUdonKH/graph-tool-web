// 未設定の保存図は従来の見た目を保つ。重なり順を操作した図は図形と線を一緒に扱う。
export function paintOrder(doc) {
  const items = doc.items || [];
  return doc.itemStack === 1 ? [...items] : [...items.filter(i => i.type !== 'edge'), ...items.filter(i => i.type === 'edge')];
}

export function reorderedItems(doc, ids, mode, bounds) {
  const selected = new Set(ids), order = paintOrder(doc);
  if (mode === 'front') return [...order.filter(i => !selected.has(i.id)), ...order.filter(i => selected.has(i.id))];
  if (mode === 'back') return [...order.filter(i => selected.has(i.id)), ...order.filter(i => !selected.has(i.id))];
  const overlaps = (a, b) => {
    const x = bounds(a), y = bounds(b);
    return x && y && x.x <= y.x + y.w && y.x <= x.x + x.w && x.y <= y.y + y.h && y.y <= x.y + x.h;
  };
  if (mode === 'down') order.reverse();
  for (let j = order.length - 1; j >= 0; j--) {
    const item = order[j];
    if (!selected.has(item.id)) continue;
    let next = j + 1;
    while (next < order.length && (selected.has(order[next].id) || !overlaps(item, order[next]))) next++;
    if (next < order.length) { order.splice(j, 1); order.splice(next, 0, item); }
  }
  if (mode === 'down') order.reverse();
  return order;
}
