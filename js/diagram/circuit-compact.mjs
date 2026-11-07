import { circuitPins, circuitRouteConflict, circuitPathCrossesBody } from './circuit-model.mjs';

// 大きすぎる回路の空き区間だけを縮める。各軸の順番を維持し、部品の囲みの内側は等倍に保つ。
// 入力を変更せず、参照・端子・交差の検査を通らない候補は採用しない。
export function compactCircuitDoc(doc) {
  const unchanged = message => ({ doc, changes: [message], applied: false });
  const items = doc.items || [], parts = items.filter(x => x.type === 'circuit');
  if (!doc.circuitSketch || items.some(x => !['circuit', 'circuit-junction', 'edge'].includes(x.type))) return unchanged('この回路の配置は変更できないため、元の配置を維持しました。');
  const grid = doc.grid || 20, tracks = { x: new Set(), y: new Set() };
  const put = (axis, v) => { if (!Number.isFinite(v) || Math.abs(v / grid - Math.round(v / grid)) > 1e-7) throw new Error('グリッド外の座標'); tracks[axis].add(v); };
  const point = p => { put('x', p.x); put('y', p.y); };
  try {
    for (const it of items) {
      if (it.type === 'circuit') {
        point({ x: it.x, y: it.y }); point({ x: it.x + it.w, y: it.y + it.h });
        point({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
      } else if (it.type === 'circuit-junction') point({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
      else {
        if (it.circuitWire ? it.style !== 'elbow' : !it.annotation || it.style !== 'straight' || it.from.id != null || it.to.id != null) throw new Error('未対応の線');
        for (const ref of [it.from, it.to]) if (ref.id == null) point(ref);
        for (const p of it.points || []) point(p);
      }
    }
  } catch { return unchanged('グリッド外または未対応の要素があるため、元の配置を維持しました。'); }
  const xs = [...tracks.x].sort((a, b) => a - b), ys = [...tracks.y].sort((a, b) => a - b);
  if (!xs.length || !ys.length || (xs.at(-1) - xs[0] <= 800 && ys.at(-1) - ys[0] <= 500)) return unchanged('回路の間隔は十分近いため、元の配置を維持しました。');
  function axisMap(values, axis) {
    const result = new Map([[values[0], values[0]]]);
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1], b = values[i];
      const protectedGap = parts.some(p => {
        const lo = p[axis], hi = lo + (axis === 'x' ? p.w : p.h);
        return a >= lo && b <= hi;
      });
      // 電気回路は左右の枝を読みやすくし、縦方向の長い配線を抑える。
      const maxGap = grid * (axis === 'x' ? 4 : 2);
      result.set(b, result.get(a) + (protectedGap ? b - a : Math.min(b - a, maxGap)));
    }
    return result;
  }
  const mx = axisMap(xs, 'x'), my = axisMap(ys, 'y'), out = JSON.parse(JSON.stringify(doc));
  // 清書案のみ、部品名と矢印の標準文字を大きくし、書き出し時の用紙幅を抑える。
  out.circuitSketchClean = true;
  const move = p => ({ ...p, x: mx.get(p.x), y: my.get(p.y) });
  for (const it of out.items) {
    if ((it.type === 'circuit' || it.annotation) && it.fontSize === 16) it.fontSize = 24;
    if (it.type === 'circuit') { it.x = mx.get(it.x); it.y = my.get(it.y); }
    else if (it.type === 'circuit-junction') { const c = move({ x: it.x + it.w / 2, y: it.y + it.h / 2 }); it.x = c.x - it.w / 2; it.y = c.y - it.h / 2; }
    else {
      if (it.from.id == null) it.from = move(it.from);
      if (it.to.id == null) it.to = move(it.to);
      if (it.points) it.points = it.points.map(move);
    }
  }
  const byId = new Map(out.items.map(x => [x.id, x])), bodies = out.items.filter(x => x.type === 'circuit');
  const nodes = bodies.flatMap(c => Object.entries(circuitPins({ type: c.kind, x: c.x + c.w / 2, y: c.y + c.h / 2, rotation: c.rotation })).map(([pin, p]) => ({ ...p, id: c.id, pin })));
  nodes.push(...out.items.filter(x => x.type === 'circuit-junction').map(c => ({ x: c.x + c.w / 2, y: c.y + c.h / 2, id: c.id })));
  const refPoint = ref => { if (ref.id == null) return ref; const n = nodes.find(p => p.id === ref.id && p.pin === ref.pin); if (!n || !byId.has(ref.id)) throw new Error('端子がありません'); return n; };
  try {
    if (nodes.some((p, i) => nodes.slice(i + 1).some(q => p.x === q.x && p.y === q.y))) throw new Error('端子が重なりました');
    const wires = out.items.filter(x => x.circuitWire).map(e => ({ points: [refPoint(e.from), ...(e.points || []), refPoint(e.to)], ends: [e.from, e.to] }));
    for (let i = 0; i < wires.length; i++) {
      const w = wires[i];
      if (w.points.some((p, j) => j && (p.x === w.points[j - 1].x && p.y === w.points[j - 1].y || p.x !== w.points[j - 1].x && p.y !== w.points[j - 1].y)) || circuitRouteConflict(w.points, w.ends, wires.filter((_, n) => n !== i), nodes) || bodies.some(b => circuitPathCrossesBody(w.points, b))) throw new Error('接続の検査に失敗');
    }
  } catch { return unchanged('接続や交差の安全を確認できなかったため、元の配置を維持しました。'); }
  const before = [xs.at(-1) - xs[0], ys.at(-1) - ys[0]], after = [mx.get(xs.at(-1)) - mx.get(xs[0]), my.get(ys.at(-1)) - my.get(ys[0])];
  if (after[0] === before[0] && after[1] === before[1]) return unchanged('縮められる安全な余白がないため、元の配置を維持しました。');
  return { doc: out, changes: ['接続と部品サイズを保ち、広すぎる配線間隔を縮めました。'], applied: true, before, after };
}
