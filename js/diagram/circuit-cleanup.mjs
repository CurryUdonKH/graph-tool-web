import { hasTerminal, terminalMode } from './terminal-marks.mjs';

// 分岐でなくなった接続点を整理する。単独で置いた点や通常の黒点は残す。
// 削除時は影響した点だけ、読み込み時は配線につながっている点だけを対象にする。
export function cleanupCircuitJunctions(items, pointOf, affected = null) {
  let result = [...items];
  for (const dot of items.filter(i => i.type === 'circuit-junction')) {
    const attached = result.filter(i => i.type === 'edge' && [i.from.id, i.to.id].includes(dot.id));
    if (affected ? !affected.has(dot.id) : !attached.length) continue;
    if (attached.length > 2 || attached.some(e => !e.circuitWire)) continue;
    const center = { x: dot.x + dot.w / 2, y: dot.y + dot.h / 2 };
    if (attached.length === 1) {
      const e = attached[0];
      if (e.from.id === dot.id) e.from = { ...center };
      if (e.to.id === dot.id) e.to = { ...center };
    } else if (attached.length === 2) {
      const [a, b] = attached;
      // 意図して異なる書式や注釈を付けた線は上書きしない。
      if (a.lw !== b.lw || !!a.dash !== !!b.dash || (a.label && b.label)) continue;
      const outer = e => e.from.id === dot.id ? 'to' : 'from';
      const ak = outer(a), bk = outer(b), from = a[ak], to = b[bk];
      if (from.id === dot.id || to.id === dot.id ||
          (from.id != null && from.id === to.id && from.pin === to.pin)) continue;
      const path = e => [pointOf(e.from), ...(e.points || []), pointOf(e.to)];
      const ap = path(a), bp = path(b);
      if (ak === 'to') ap.reverse();
      if (bk === 'from') bp.reverse();
      const pts = [];
      for (const p of [...ap, ...bp.slice(1)]) {
        if (pts.length && p.x === pts.at(-1).x && p.y === pts.at(-1).y) continue;
        while (pts.length >= 2) {
          const q = pts.at(-2), r = pts.at(-1);
          if ((q.x === r.x && r.x === p.x && (r.y-q.y)*(p.y-r.y) >= 0) ||
              (q.y === r.y && r.y === p.y && (r.x-q.x)*(p.x-r.x) >= 0)) pts.pop();
          else break;
        }
        pts.push({ ...p });
      }
      const marked = (e, k) => e.terminalEnds === 'auto' ? e[k].id == null : hasTerminal(e.terminalEnds, k === 'from' ? 'start' : 'end');
      const marks = a.terminalEnds === 'auto' && b.terminalEnds === 'auto' ? 'auto' : terminalMode(marked(a, ak), marked(b, bk));
      a.from = { ...from }; a.to = { ...to }; a.points = pts.slice(1, -1); a.terminalEnds = marks;
      if (b.label) {
        a.label = b.label;
        for (const key of ['textStyles', 'fontSize']) if (b[key] !== undefined) a[key] = b[key];
      }
      result = result.filter(i => i.id !== b.id);
    }
    result = result.filter(i => i.id !== dot.id);
  }
  return result;
}
