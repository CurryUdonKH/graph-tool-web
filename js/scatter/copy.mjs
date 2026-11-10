// 元の Excel のバイナリも含めて複製し、編集後も元のグラフから独立させる。
export function duplicateGraphRecord(source, {id, now, names}) {
  const used = new Set(names), base = `${source.name}-copy`;
  let name = base, suffix = 2;
  while (used.has(name)) name = `${base}${suffix++}`;
  return {...structuredClone(source), id, name, created: now, updated: now};
}
