// 電気回路の下準備。接続は座標の一致から推測せず、端子・接続点の ID で表す。
// 編集画面と取り込みで共通の端子・描画・接続検査を使う。
export const CIRCUIT_TYPES = Object.freeze({
  switch: { pins: ['a', 'b'], width: 120, height: 80 },
  resistor: { pins: ['a', 'b'], width: 120, height: 80 },
  variable_resistor: { pins: ['a', 'b'], width: 120, height: 80 },
  capacitor: { pins: ['a', 'b'], width: 120, height: 80 },
  inductor: { pins: ['a', 'b'], width: 120, height: 80 },
  diode: { pins: ['anode', 'cathode'], width: 120, height: 80 },
  voltage: { pins: ['positive', 'negative'], width: 120, height: 80 }, // 従来の丸と + / − の記号を保持
  voltage_dc: { pins: ['positive', 'negative'], width: 120, height: 80 },
  voltage_ac: { pins: ['a', 'b'], width: 120, height: 80 },
  current_source: { pins: ['a', 'b'], width: 120, height: 80 },
  nmos: { pins: ['gate', 'drain', 'source'], width: 120, height: 120 },
  pmos: { pins: ['gate', 'drain', 'source'], width: 120, height: 120 },
  ground: { pins: ['terminal'], width: 80, height: 80 },
});

// 原点は記号の中心。回転しても端子名は変わらない。
export function circuitPins(component) {
  const spec = CIRCUIT_TYPES[component.type];
  if (!Object.hasOwn(CIRCUIT_TYPES, component.type) || !spec || !Number.isFinite(component.x) || !Number.isFinite(component.y) ||
      ![0, 90, 180, 270].includes(component.rotation ?? 0)) throw new Error('部品の種類、位置、向きが正しくありません');
  const rotation = component.rotation ?? 0;
  const rotate = ({ x, y }) => rotation === 0 ? { x, y } : rotation === 90 ? { x: -y, y: x } :
    rotation === 180 ? { x: -x, y: -y } : { x: y, y: -x };
  const points = ['nmos', 'pmos'].includes(component.type) ? [{ x: -60, y: 0 }, { x: 20, y: component.type === 'nmos' ? -60 : 60 }, { x: 20, y: component.type === 'nmos' ? 60 : -60 }] : component.type === 'ground' ? [{ x: 0, y: -40 }] : [{ x: -60, y: 0 }, { x: 60, y: 0 }];
  return Object.fromEntries(spec.pins.map((name, i) => {
    const p = rotate(points[i]);
    return [name, { x: component.x + p.x, y: component.y + p.y }];
  }));
}

// 部品の端子、または明示された接続点への参照だけを許可する。
// 座標が重なるだけでは接続しない。入力データは変更しない。
export function analyzeCircuit({ components, junctions, wires }) {
  if (![components, junctions, wires].every(Array.isArray)) throw new Error('部品、接続点、配線が必要です');
  const nodes = new Map(), wireIds = new Set();
  const add = (key, point) => { if (nodes.has(key)) throw new Error('ID が重複しています'); nodes.set(key, { point, neighbors: new Set() }); };
  const componentIds = new Set();
  for (const c of components) {
    if (typeof c.id !== 'string' || !c.id || componentIds.has(c.id)) throw new Error('部品の ID が正しくありません');
    componentIds.add(c.id);
    for (const [pin, point] of Object.entries(circuitPins(c))) add(JSON.stringify(['pin', c.id, pin]), point);
  }
  const junctionIds = new Set();
  for (const j of junctions) {
    if (typeof j.id !== 'string' || !j.id || junctionIds.has(j.id) || !Number.isFinite(j.x) || !Number.isFinite(j.y)) throw new Error('接続点が正しくありません');
    junctionIds.add(j.id); add(JSON.stringify(['junction', j.id]), { x: j.x, y: j.y });
  }
  const keyOf = (ref, wireId, side) => {
    if (!ref || typeof ref !== 'object') throw new Error('配線の端を指定してください');
    const keys = Object.keys(ref).sort().join(',');
    if (keys === 'component,pin') return JSON.stringify(['pin', ref.component, ref.pin]);
    if (keys === 'junction') return JSON.stringify(['junction', ref.junction]);
    if (keys === 'x,y' && Number.isFinite(ref.x) && Number.isFinite(ref.y)) {
      const key = JSON.stringify(['free', wireId, side]); add(key, { x: ref.x, y: ref.y }); return key;
    }
    throw new Error('配線の端は端子または接続点で指定してください');
  };
  for (const w of wires) {
    if (typeof w.id !== 'string' || !w.id || wireIds.has(w.id)) throw new Error('配線の ID が正しくありません');
    wireIds.add(w.id);
    const a = keyOf(w.from, w.id, 'from'), b = keyOf(w.to, w.id, 'to'), start = nodes.get(a), end = nodes.get(b);
    if (!start || !end || a === b) throw new Error('配線の接続先が正しくありません');
    if (!Array.isArray(w.points) || w.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('配線の経路が正しくありません');
    const points = [start.point, ...w.points, end.point];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i];
      if ((p.x !== q.x && p.y !== q.y) || (p.x === q.x && p.y === q.y)) throw new Error('配線は長さのある水平または垂直の線にしてください');
    }
    start.neighbors.add(b); end.neighbors.add(a);
  }
  const nets = [], visited = new Set();
  for (const key of nodes.keys()) {
    if (visited.has(key)) continue;
    const pending = [key], net = []; visited.add(key);
    while (pending.length) {
      const current = pending.pop(); net.push(JSON.parse(current));
      for (const next of nodes.get(current).neighbors) if (!visited.has(next)) { visited.add(next); pending.push(next); }
    }
    nets.push(net);
  }
  return { nets };
}

// 図の画面と書き出しで共通に使える描画一覧。文字は回転させず読みやすく置く。
export function circuitPrimitives(component) {
  circuitPins(component); // 種類・座標・向きを検証する
  const rotation = component.rotation ?? 0, lw = component.lw ?? 1.5;
  if (!Number.isFinite(lw) || lw <= 0) throw new Error('線の太さが正しくありません');
  const xy = (x, y) => {
    const p = rotation === 0 ? [x, y] : rotation === 90 ? [-y, x] : rotation === 180 ? [-x, -y] : [y, -x];
    return [component.x + p[0], component.y + p[1]];
  };
  const path = (points, fill) => ({ k: 'path', cmds: points.map(([x, y], i) => [i ? 'L' : 'M', ...xy(x, y)]), lw, ...(fill ? { fill } : {}) });
  const line = (x1, y1, x2, y2) => path([[x1, y1], [x2, y2]]);
  const circle = (x, y, r) => { const [cx, cy] = xy(x, y); return { k: 'ellipse', cx, cy, rx: r, ry: r, lw, fill: '#ffffff' }; };
  const out = [];
  const mosfet = ['nmos', 'pmos'].includes(component.type);
  if (mosfet) {
    // 基板端子を省略したエンハンスメント型の簡略記号。Pチャネルだけゲートに白丸。
    // https://www.ele.kochi-tech.ac.jp/tacibana/etc/analog-intro/mosfet.html 図1(b)・図2(b)
    out.push(line(-20, -26, -20, 26), line(-8, -26, -8, 26),
      path([[20, -60], [20, -24], [-8, -24]]), path([[-8, 24], [20, 24], [20, 60]]));
    if (component.type === 'pmos') out.push(line(-60, 0, -32, 0), circle(-26, 0, 6));
    else out.push(line(-60, 0, -20, 0));
    if (component.pinLabels !== false) {
      const top = component.type === 'nmos' ? 'D' : 'S', bottom = component.type === 'nmos' ? 'S' : 'D';
      for (const [s, x, y] of [['G', -44, -12], [top, 32, -46], [bottom, 32, 46]]) {
        const [tx, ty] = xy(x, y);
        out.push({ k: 'text', x: tx, y: ty, s, size: 12, ha: 'center', va: 'center' });
      }
    }
  } else if (component.type !== 'ground') {
    out.push(line(-60, 0, -30, 0), line(30, 0, 60, 0));
    if (['resistor', 'variable_resistor'].includes(component.type)) out.push(path([[-30, -14], [30, -14], [30, 14], [-30, 14], [-30, -14]], '#ffffff'));
    if (component.type === 'variable_resistor') {
      // 抵抗本体を斜めに横切る矢印。端子は a・b の 2 つだけ。
      out.push(path([[-32, 27], [28, -27]]), path([[17, -24], [28, -27], [24, -16]]));
    }
    if (component.type === 'switch') {
      out.push(line(-30, 0, -24, 0), line(24, 0, 30, 0),
        line(-24, 0, component.closed ? 24 : 20, component.closed ? 0 : -24),
        circle(-24, 0, 3), circle(24, 0, 3));
    }
    if (component.type === 'capacitor') {
      out.push(line(-30, 0, -6, 0), line(6, 0, 30, 0), line(-6, -20, -6, 20), line(6, -20, 6, 20));
      if (component.polarized) out.push(line(-19, -28, -11, -28), line(-15, -32, -15, -24));
    }
    if (component.type === 'inductor') {
      // 四つの半円を三次曲線で描く。
      const cmds = [['M', ...xy(-30, 0)]];
      for (let i = 0; i < 4; i++) {
        const x = -30 + 15 * i;
        cmds.push(['C', ...xy(x, -10), ...xy(x + 15, -10), ...xy(x + 15, 0)]);
      }
      out.push({ k: 'path', cmds, lw });
    }
    if (component.type === 'diode') {
      // 左のアノードから右のカソードの線へ向かう標準のダイオード記号。
      out.push(path([[-30, -20], [10, 0], [-30, 20], [-30, -20]], '#ffffff'), line(10, -20, 10, 20), line(10, 0, 30, 0));
    }
    if (component.type === 'voltage') {
      out.push(circle(0, 0, 30), line(-19, 0, -9, 0), line(-14, -5, -14, 5), line(9, 0, 19, 0));
    }
    if (component.type === 'voltage_dc') {
      // 長い線が正極、短い線が負極。端子 ID は回転後も変わらない。
      out.push(line(-30, 0, -8, 0), line(8, 0, 30, 0), line(-8, -22, -8, 22), line(8, -12, 8, 12));
    }
    if (component.type === 'voltage_ac') {
      // 交流には固定した正極・負極を付けない。
      out.push(circle(0, 0, 30), { k: 'path', lw, cmds: [
        ['M', ...xy(-18, 0)], ['C', ...xy(-14, -12), ...xy(-5, -12), ...xy(0, 0)],
        ['C', ...xy(5, 12), ...xy(14, 12), ...xy(18, 0)],
      ] });
    }
    if (component.type === 'current_source') {
      // 矢印は a から b の向き。回転しても端子 ID と方向の関係を保つ。
      out.push(circle(0, 0, 30), line(-15, 0, 15, 0), path([[7, -8], [15, 0], [7, 8]]));
    }
  } else {
    out.push(line(0, -40, 0, 0), line(-24, 0, 24, 0), line(-16, 7, 16, 7), line(-8, 14, 8, 14));
  }
  const label = [component.name, component.value].filter(v => typeof v === 'string' && v.trim()).join('  ');
  if (label && mosfet) out.push({ k: 'text', x: component.x + (rotation % 180 ? 0 : 72), y: component.y + (rotation % 180 ? 72 : 0), s: label, size: component.fontSize ?? 16, ha: rotation % 180 ? 'center' : 'left', va: 'center' });
  else if (label) out.push({ k: 'text', x: component.x + (rotation % 180 ? 48 : 0), y: component.y + (rotation % 180 ? 0 : 48), s: label, size: component.fontSize ?? 16, ha: rotation % 180 ? 'left' : 'center', va: 'center' });
  return out;
}

// 線が重なったり、未指定の端や接続点に触れたりする経路は受け付けない。
// 互いの途中での十字交差は、黒点がない非接続として許可する。
export function circuitRouteConflict(points, ends, existing, junctions = []) {
  const eq = (a, b) => a.x === b.x && a.y === b.y;
  const on = (p, a, b) => (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
    (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
  const sameRef = (a, b) => a && b && a.id != null && a.id === b.id && a.pin === b.pin;
  for (const j of junctions) {
    if (ends.some(e => e.id === j.id && e.pin === j.pin)) continue;
    for (let i = 1; i < points.length; i++) if (on(j, points[i - 1], points[i])) return true;
  }
  for (const e of existing) for (let i = 1; i < points.length; i++) for (let k = 1; k < e.points.length; k++) {
    const a = points[i - 1], b = points[i], c = e.points[k - 1], d = e.points[k];
    const ah = a.y === b.y, ch = c.y === d.y;
    if (ah === ch) {
      const fixedA = ah ? a.y : a.x, fixedC = ch ? c.y : c.x;
      if (fixedA !== fixedC) continue;
      const rangeA = ah ? [a.x, b.x] : [a.y, b.y], rangeC = ch ? [c.x, d.x] : [c.y, d.y];
      const lo = Math.max(Math.min(...rangeA), Math.min(...rangeC)), hi = Math.min(Math.max(...rangeA), Math.max(...rangeC));
      if (lo > hi) continue;
      if (lo < hi) return true;
      const q = ah ? { x: lo, y: fixedA } : { x: fixedA, y: lo };
      if (!ends.some((r, n) => eq(q, points[n ? points.length - 1 : 0]) && e.ends.some((v, m) => sameRef(r, v) && eq(q, e.points[m ? e.points.length - 1 : 0])))) return true;
    } else {
      const h = ah ? [a, b] : [c, d], v = ah ? [c, d] : [a, b];
      const q = { x: v[0].x, y: h[0].y };
      if (!on(q, ...h) || !on(q, ...v)) continue;
      const shared = ends.some((r, n) => eq(q, points[n ? points.length - 1 : 0]) && e.ends.some((t, m) => sameRef(r, t) && eq(q, e.points[m ? e.points.length - 1 : 0])));
      if (!shared && (eq(q, a) || eq(q, b) || eq(q, c) || eq(q, d))) return true;
    }
  }
  return false;
}

// 接続点を配線の途中に明示して置くときだけ、元の経路をその位置で分ける。
export function splitCircuitPoints(points, point) {
  const on = (p, a, b) => (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
    (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
  const index = points.findIndex((p, i) => i > 0 && on(point, points[i - 1], p));
  if (index < 0) throw new Error('接続点が配線上にありません');
  const eq = (a, b) => a.x === b.x && a.y === b.y;
  const before = points.slice(0, index), after = points.slice(index);
  if (!eq(before.at(-1), point)) before.push(point);
  if (!eq(after[0], point)) after.unshift(point);
  return { before, after };
}

// 配線が部品の囲みの内部を通ると、端子を通らずに線が記号に重なって見える。
export function circuitPathCrossesBody(points, body) {
  const eps = 0.5;
  return points.some((b, i) => {
    if (!i) return false;
    const a = points[i - 1];
    return (Math.abs(a.y - b.y) < eps && a.y > body.y + eps && a.y < body.y + body.h - eps && Math.max(a.x, b.x) > body.x + eps && Math.min(a.x, b.x) < body.x + body.w - eps) ||
      (Math.abs(a.x - b.x) < eps && a.x > body.x + eps && a.x < body.x + body.w - eps && Math.max(a.y, b.y) > body.y + eps && Math.min(a.y, b.y) < body.y + body.h - eps);
  });
}

// 回転後も端子の外側から配線するための候補。採用前に部品・他の配線との衝突を検査する。
export function circuitRouteCandidates(start, end, startDirection, endDirection, bodies, grid = 20) {
  const stub = (p, d) => d ? { x: p.x + d.x * grid, y: p.y + d.y * grid } : p;
  const a = stub(start, startDirection), b = stub(end, endDirection);
  // 大きな図でも候補数が膨らまないよう、近い部品の外周を経路候補に使う。衝突検査は全ての部品で行う。
  const distance = o => Math.min(...[a, b].map(p => Math.max(o.x-p.x, 0, p.x-o.x-o.w) + Math.max(o.y-p.y, 0, p.y-o.y-o.h)));
  const nearby = [...bodies].sort((x,y) => distance(x)-distance(y)).slice(0,8);
  const xs = new Set([a.x, b.x, ...nearby.flatMap(o => [o.x - grid, o.x - 2 * grid, o.x + o.w + grid, o.x + o.w + 2 * grid])]);
  const ys = new Set([a.y, b.y, ...nearby.flatMap(o => [o.y - grid, o.y - 2 * grid, o.y + o.h + grid, o.y + o.h + 2 * grid])]);
  const mids = [[a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]];
  for (const x of xs) mids.push([a, { x, y: a.y }, { x, y: b.y }, b]);
  for (const y of ys) mids.push([a, { x: a.x, y }, { x: b.x, y }, b]);
  for (const x of xs) for (const y of ys) {
    mids.push([a, { x, y: a.y }, { x, y }, { x: b.x, y }, b],
      [a, { x: a.x, y }, { x, y }, { x, y: b.y }, b]);
  }
  const clean = points => {
    const out = [];
    for (const p of points) {
      if (out.length && p.x === out.at(-1).x && p.y === out.at(-1).y) continue;
      while (out.length >= 2) {
        const q = out.at(-2), r = out.at(-1);
        if (q.x === r.x && r.x === p.x && (r.y-q.y)*(p.y-r.y) >= 0 || q.y === r.y && r.y === p.y && (r.x-q.x)*(p.x-r.x) >= 0) out.pop();
        else break;
      }
      out.push(p);
    }
    return out;
  };
  const length = points => points.slice(1).reduce((sum,p,i) => sum + Math.abs(p.x-points[i].x) + Math.abs(p.y-points[i].y),0);
  return mids.map(m => clean([start,...m,end])).filter(points => !bodies.some(body => circuitPathCrossesBody(points,body)))
    .sort((a,b) => length(a)-length(b) || a.length-b.length);
}
