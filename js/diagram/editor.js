// 図の作成エディタ(ブラウザ版)
// 楕円・四角・注釈・文字と、直線/曲線/直角の矢印、論理ゲートをマウスで置く。
// 手元版(Streamlit のカスタムコンポーネント)の描画・操作をそのまま使い、
// 変更のたびに onChange(doc) で知らせる(保存は呼び出し側が IndexedDB に行う)。
// 文字は text.js で並べる($...$ は MathJax の数式になる)。

import { layout, textMarkup, onTextReady, loadFont } from "../text.js";

// ------------------------------------------------------------------ 状態
const TOOLS = [
  ["select", "↖ 選択", "V", "クリックで選択、ドラッグで移動。空いた所をドラッグすると範囲で選択。ダブルクリックで文字を編集。"],
  ["ellipse", "◯ 楕円", "E", "クリックで置く(ドラッグで大きさを決める)。状態遷移図の「状態」に。"],
  ["rect", "▭ 四角", "R", "クリックで置く(ドラッグで大きさを決める)。ブロック図の「ブロック」に。"],
  ["note", "▤ 注釈", "N", "説明を書く枠。クリックで置き、「直線」ツールで指し示す線を引けます。"],
  ["text", "A 文字", "T", "枠のない文字。クリックで置く。"],
  ["gate", "", "G", "クリックで論理ゲートを置く。入力は左の辺、出力は右の辺につなぎます(線の端がグリッドの点に合います)。"],
  ["straight", "→ 直線", "L", "図形から図形へドラッグ。同じ図形の上で離すと自分に戻る矢印(ループ)になります。"],
  ["curve", "⤻ 曲線", "C", "図形から図形へドラッグ。選ぶと出る真ん中の ● で全体のふくらみ、◇ でその側の曲がり方を変えられます(両端は動きません)。両端の ○ は図形から離して置くこともできます。同じ図形の上で離すと、自分に戻る矢印になります。"],
  ["elbow", "┘ 直角", "W", "始点をクリック → 曲がる所をクリック → 終点の図形をクリック(何もない所で終えるならダブルクリック)。線は縦か横だけになります。"],
];
const DEF = {
  ellipse: { w: 160, h: 80, text: "状態", fontSize: 22, lw: 1.5, fill: "#ffffff" },
  rect:    { w: 160, h: 80, text: "ブロック", fontSize: 22, lw: 2, fill: "#ffffff" },
  note:    { w: 240, h: 80, text: "注釈", fontSize: 18, lw: 1, fill: "#ffffff" },
  text:    { w: 120, h: 40, text: "文字", fontSize: 18, lw: 1, fill: "none" },
  gate:    { w: 120, h: 80, text: "", fontSize: 16, lw: 2, fill: "#ffffff" },
};
const W = 1600, H = 1000;

const S = {
  doc: newDoc(), sel: [], tool: "select", hist: [], fut: [],
  drag: null, draft: null, guides: [], editing: null, clip: null, mouse: { x: 0, y: 0 }, zoom: 1,
};
try { S.zoom = Math.min(4, Math.max(0.25, +localStorage.getItem("diagram_zoom") || 1)); } catch (e) {}
const px = v => v / S.zoom;   // 画面上で同じ大きさに見えるように(つまみ・当たり判定など)
function newDoc() { return { grid: 20, snap: true, showGrid: true, W, H, items: [], nextId: 1 }; }
function fixDoc() {
  const d = S.doc;
  d.W = d.W || W; d.H = d.H || H; d.grid = d.grid || 20;
  if (d.snap === undefined) d.snap = true;
  if (d.showGrid === undefined) d.showGrid = true;
  d.items = d.items || [];
  d.nextId = Math.max(d.nextId || 1, ...d.items.map(i => i.id + 1), 1);
  for (const e of d.items) {
    if (e.type !== "edge") continue;
    if (e.style === "loop") {           // 前の形式の自分に戻る矢印 → 曲線に
      const sh = d.items.find(i => i.id === e.from.id);
      if (!sh) continue;
      const c = ctr(sh), th = (e.angle ?? -90) * Math.PI / 180;
      const a0 = e.a0 ?? th - 0.42, a1 = e.a1 ?? th + 0.42, L = e.size ?? 45;
      const at = a => anchorOn(sh, boundary(sh, { x: c.x + Math.cos(a) * 100, y: c.y + Math.sin(a) * 100 }));
      e.from = at(a0); e.to = at(a1); e.style = "curve";
      const p0 = refPt(e.from), p1 = refPt(e.to), cm = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      if (!(e.c1 && e.c2)) { const u = (a0 + a1) / 2; e.mx = Math.cos(u) * L * 1.3; e.my = Math.sin(u) * L * 1.3; }
      for (const k of ["angle", "size", "a0", "a1"]) delete e[k];
    }
  }
}

const $ = id => document.getElementById(id);
const svg = $("svg");
const get = id => S.doc.items.find(i => i.id === id);
const isShape = it => it && it.type !== "edge";
const shapes = () => S.doc.items.filter(isShape);
const edges = () => S.doc.items.filter(i => i.type === "edge");
const selItems = () => S.sel.map(get).filter(Boolean);

// ------------------------------------------------------------------ 幾何
const ctr = s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const snapV = v => S.doc.snap ? Math.round(v / S.doc.grid) * S.doc.grid : Math.round(v);
const snapP = p => ({ x: snapV(p.x), y: snapV(p.y) });

function boundary(s, t) { // 図形 s の輪郭上で、中心から t の方向にある点
  const c = ctr(s), dx = t.x - c.x, dy = t.y - c.y, rx = s.w / 2, ry = s.h / 2;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: c.x, y: c.y - ry };
  let k;
  if (s.type === "ellipse") k = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  else k = Math.min(Math.abs(dx) > 1e-9 ? rx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? ry / Math.abs(dy) : Infinity);
  return { x: c.x + dx * k, y: c.y + dy * k };
}
// 矢印の端: {x, y}(どこにもつながっていない) または {id}(楕円:輪郭に自動で合わせる)
// または {id, ax, ay}(四角など:辺の上の決まった位置。ax, ay は 0〜1 の相対位置)
const angPt = (s, a) => ({ x: s.x + s.w / 2 + Math.cos(a) * s.w / 2, y: s.y + s.h / 2 + Math.sin(a) * s.h / 2 });
function refPt(end) {
  if (end.id == null) return { x: end.x, y: end.y };
  const s = get(end.id);
  if (!s) return { x: end.x || 0, y: end.y || 0 };
  if (end.ang != null) return angPt(s, end.ang);
  if (s.type === "ellipse" || end.ax == null) return ctr(s);
  return { x: s.x + end.ax * s.w, y: s.y + end.ay * s.h };
}
function entry(s, from, to) {  // from → to の線が図形 s の輪郭に最初に当たる点(当たらなければ null)
  const dx = to.x - from.x, dy = to.y - from.y;
  let t = null;
  if (s.type === "ellipse") {
    const c = ctr(s), rx = s.w / 2, ry = s.h / 2, ox = (from.x - c.x) / rx, oy = (from.y - c.y) / ry, vx = dx / rx, vy = dy / ry;
    const A = vx * vx + vy * vy, B = 2 * (ox * vx + oy * vy), C = ox * ox + oy * oy - 1, D = B * B - 4 * A * C;
    if (C <= 0 || A < 1e-9 || D < 0) return null;            // 始まりが図形の中なら何もしない
    t = (-B - Math.sqrt(D)) / (2 * A);
  } else {
    if (from.x > s.x && from.x < s.x + s.w && from.y > s.y && from.y < s.y + s.h) return null;
    let t0 = 0, t1 = 1;
    for (const [pp, q] of [[-dx, from.x - s.x], [dx, s.x + s.w - from.x], [-dy, from.y - s.y], [dy, s.y + s.h - from.y]]) {
      if (Math.abs(pp) < 1e-9) { if (q < 0) return null; continue; }
      const r = q / pp;
      if (pp < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (t0 > t1) return null;
    t = t0;
  }
  if (t == null || t < 0 || t > 1) return null;
  return { x: from.x + dx * t, y: from.y + dy * t };
}
function attach(end, toward) {
  if (end.id == null) return { x: end.x, y: end.y };
  const s = get(end.id);
  if (!s) return { x: end.x || 0, y: end.y || 0 };
  if (end.ang != null || (s.type !== "ellipse" && end.ax != null)) {
    // 輪郭の決まった位置につないだ端:向こう側にあって線が図形を突き抜けるときは、手前の輪郭で止める
    const a = end.ang != null ? angPt(s, end.ang) : { x: s.x + end.ax * s.w, y: s.y + end.ay * s.h };
    const hit = entry(s, toward, a);
    return hit && dist(hit, a) > 1 ? hit : a;
  }
  if (s.type === "ellipse" || end.ax == null) return boundary(s, toward);
  return { x: s.x + end.ax * s.w, y: s.y + end.ay * s.h };
}
function shapeAt(p, exclude) {
  const list = shapes();
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (exclude && exclude.includes(s.id)) continue;
    if (s.type === "ellipse") {
      const c = ctr(s);
      if (((p.x - c.x) / (s.w / 2)) ** 2 + ((p.y - c.y) / (s.h / 2)) ** 2 <= 1) return s;
    } else if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return s;
  }
  return null;
}
const EDGE_BAND = 16;   // 輪郭から画面で何 px 以内なら、グリッドより輪郭を優先して吸い付くか
function nearShape(p, exclude) {   // p を含む図形、なければ輪郭のすぐ近くの図形
  const inside = shapeAt(p, exclude);
  if (inside) return inside;
  let best = null, bd = px(EDGE_BAND);
  for (const s of shapes()) {
    if (exclude && exclude.includes(s.id)) continue;
    const d = dist(p, boundary(s, p));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function endpointAt(p, exclude) { // マウスの位置にある図形につなぐ(なければ自由な点)
  const s = nearShape(p, exclude);
  if (!s) return snapP(p);
  if (s.type === "ellipse") {
    // 輪郭の近く → 輪郭の上のその位置に固定(角度は 15° きざみ)。真ん中の方 → 向きに合わせて自動
    const b = boundary(s, p);
    if (shapeAt(p) === s && dist(p, b) > px(EDGE_BAND + 4)) return { id: s.id };
    const c = ctr(s);
    let a = Math.atan2((b.y - c.y) / (s.h / 2), (b.x - c.x) / (s.w / 2));
    if (S.doc.snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    return { id: s.id, ang: a };
  }
  // 一番近い辺に乗せ、辺にそった位置もグリッドに合わせる
  const d = { l: Math.abs(p.x - s.x), r: Math.abs(s.x + s.w - p.x), t: Math.abs(p.y - s.y), b: Math.abs(s.y + s.h - p.y) };
  const side = Object.keys(d).reduce((a, b) => d[a] <= d[b] ? a : b);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // 辺にそった位置:辺の真ん中・端に近ければそこ、そうでなければグリッド
  const along = (v, lo, len) => {
    for (const k of [0.5, 0, 1, 0.25, 0.75]) if (Math.abs(v - (lo + k * len)) < px(8)) return lo + k * len;
    return clamp(snapV(v), lo, lo + len);
  };
  if (side === "l" || side === "r") return { id: s.id, ax: side === "l" ? 0 : 1, ay: (along(p.y, s.y, s.h) - s.y) / s.h };
  return { id: s.id, ax: (along(p.x, s.x, s.w) - s.x) / s.w, ay: side === "t" ? 0 : 1 };
}
function labelGap(e, n) { // 線から文字の枠までが 6px あくような、文字の中心までの距離
  if (!e.label) return 14;
  const b = layout(e.label, e.fontSize, "center", "center").box;
  return 6 + Math.abs(n.x) * b.w / 2 + Math.abs(n.y) * b.h / 2;
}
function defaultMid(e, a, b) {   // まだ動かしていない曲線の真ん中の点
  if (e.from.id != null && e.from.id === e.to.id) {     // 自分に戻る矢印:図形の外側へ
    const s = get(e.from.id), c = ctr(s), cm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let u = { x: cm.x - c.x, y: cm.y - c.y }; const ul = Math.hypot(u.x, u.y);
    u = ul > 1 ? { x: u.x / ul, y: u.y / ul } : { x: 0, y: -1 };
    return { x: cm.x + u.x * 60, y: cm.y + u.y * 60 };
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }, bend = (e.bend ?? 40) / 2;
  return { x: (a.x + b.x) / 2 + n.x * bend, y: (a.y + b.y) / 2 + n.y * bend };
}
// 図形 s の上に、自分に戻る矢印の両端を置く(上側に 2 つ)
function loopEnds(s, dirDeg) {
  const c = ctr(s), th = (dirDeg ?? -90) * Math.PI / 180;
  const at = d => { const b = boundary(s, { x: c.x + Math.cos(th + d) * 100, y: c.y + Math.sin(th + d) * 100 }); return anchorOn(s, b); };
  return [at(-0.42), at(0.42)];
}
function anchorOn(s, b) {        // 輪郭の上の点 b を、図形への取り付け位置にする
  if (s.type === "ellipse") { const c = ctr(s); return { id: s.id, ang: Math.atan2((b.y - c.y) / (s.h / 2), (b.x - c.x) / (s.w / 2)) }; }
  const d = { l: Math.abs(b.x - s.x), r: Math.abs(s.x + s.w - b.x), t: Math.abs(b.y - s.y), b: Math.abs(s.y + s.h - b.y) };
  const side = Object.keys(d).reduce((p, q) => d[p] <= d[q] ? p : q);
  if (side === "l" || side === "r") return { id: s.id, ax: side === "l" ? 0 : 1, ay: (b.y - s.y) / s.h };
  return { id: s.id, ax: (b.x - s.x) / s.w, ay: side === "t" ? 0 : 1 };
}
function detachEnds(e, keep) {   // 図形につながった端を、今の位置の自由な点にする(keep に入っている図形につながった端はそのまま)
  const g = edgeGeom(e), a0 = refPt(e.from), b0 = refPt(e.to);
  let changed = false;
  if (e.from.id != null && !keep.has(e.from.id)) { e.from = { x: g.start.x, y: g.start.y }; changed = true; }
  if (e.to.id != null && !keep.has(e.to.id)) { e.to = { x: g.end.x, y: g.end.y }; changed = true; }
  if (!changed || e.style !== "curve") return;
  const a = refPt(e.from), b = refPt(e.to);       // 曲がり方が変わらないように直す
  if (e.c1 && e.c2) {
    e.c1 = { dx: a0.x + e.c1.dx - a.x, dy: a0.y + e.c1.dy - a.y }; e.c2 = { dx: b0.x + e.c2.dx - b.x, dy: b0.y + e.c2.dy - b.y };
  } else { e.mx = g.mid.x - (a.x + b.x) / 2; e.my = g.mid.y - (a.y + b.y) / 2; }
}
function freezeEnds(e) {   // 輪郭に自動で合わせている端を、今の位置に固定する(曲がり方を変えても端が滑らないように)
  const g = edgeGeom(e);
  for (const [k, pt] of [["from", g.start], ["to", g.end]]) {
    const end = e[k];
    if (end.id != null && end.ang == null && end.ax == null) { const sh = get(end.id); if (sh) e[k] = anchorOn(sh, pt); }
  }
}
function makeLoop(e, dirDeg) {
  const s = get(e.from.id);
  [e.from, e.to] = loopEnds(s, dirDeg);
  e.style = "curve";
  delete e.mx; delete e.my; delete e.points; delete e.bend; delete e.c1; delete e.c2;
}
function edgeGeom(e) {
  const g = { handles: [] };
  if (e.style === "loop" || e.style === "curve") {
    // 曲線(自分に戻る矢印も含む)。真ん中の点 M を必ず通る 3 次ベジェ曲線。
    // M は「両端を結んだ線の真ん中」からのずれ (mx, my) で持つ。真ん中を動かしても両端は動かない。
    const a = refPt(e.from), b = refPt(e.to), cm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const M = e.mx != null ? { x: cm.x + e.mx, y: cm.y + e.my } : defaultMid(e, a, b);
    const ctl = (P0, P3) => {
      const C = { x: 2 * M.x - (P0.x + P3.x) / 2, y: 2 * M.y - (P0.y + P3.y) / 2 };   // M を通る放物線の制御点
      let c1 = { x: P0.x + (C.x - P0.x) * 2 / 3, y: P0.y + (C.y - P0.y) * 2 / 3 };
      let c2 = { x: P3.x + (C.x - P3.x) * 2 / 3, y: P3.y + (C.y - P3.y) * 2 / 3 };
      // 両端が近いとき(自分に戻る矢印など)は、風船のように横へふくらませる(M は通ったまま)
      const mid = { x: (P0.x + P3.x) / 2, y: (P0.y + P3.y) / 2 }, h = dist(M, mid), chord = dist(P0, P3);
      const spread = Math.max(0, 0.95 * h - 0.5 * chord);
      if (spread > 0) {
        let u = chord > 1 ? { x: (P0.x - P3.x) / chord, y: (P0.y - P3.y) / chord }
                          : { x: -(M.y - mid.y) / (h || 1), y: (M.x - mid.x) / (h || 1) };
        c1 = { x: c1.x + u.x * spread, y: c1.y + u.y * spread }; c2 = { x: c2.x - u.x * spread, y: c2.y - u.y * spread };
      }
      return [c1, c2];
    };
    let c1, c2, p0, p1;
    if (e.c1 && e.c2) {           // ◇ で調整した曲線:調整点は両端からの相対位置
      c1 = { x: a.x + e.c1.dx, y: a.y + e.c1.dy }; c2 = { x: b.x + e.c2.dx, y: b.y + e.c2.dy };
      p0 = attach(e.from, c1); p1 = attach(e.to, c2);
    } else {
      [c1, c2] = ctl(a, b);
      p0 = attach(e.from, c1); p1 = attach(e.to, c2);
      [c1, c2] = ctl(p0, p1);
    }
    g.cmds = [["M", p0.x, p0.y], ["C", c1.x, c1.y, c2.x, c2.y, p1.x, p1.y]];
    Object.assign(g, { start: p0, end: p1, startFrom: c1, endFrom: c2, c1, c2, cm, a, b });
    g.mid = { x: .125 * p0.x + .375 * c1.x + .375 * c2.x + .125 * p1.x, y: .125 * p0.y + .375 * c1.y + .375 * c2.y + .125 * p1.y };
    // 文字は、曲線がふくらんでいる側に出す
    const tx = p1.x + c2.x - c1.x - p0.x, ty = p1.y + c2.y - c1.y - p0.y, tl = Math.hypot(tx, ty) || 1;
    let nn = { x: -ty / tl, y: tx / tl };
    const chordMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    if ((g.mid.x - chordMid.x) * nn.x + (g.mid.y - chordMid.y) * nn.y < 0) nn = { x: -nn.x, y: -nn.y };
    const gap = labelGap(e, nn);
    g.labelBase = { x: g.mid.x + nn.x * gap, y: g.mid.y + nn.y * gap };
    g.handles = [{ k: "start", ...p0 }, { k: "end", ...p1 }, { k: "mid", ...g.mid }, { k: "c1", ...c1 }, { k: "c2", ...c2 }];
  } else {
    const wps = e.style === "elbow" ? (e.points || []) : [];
    const a = refPt(e.from), b = refPt(e.to);
    const p0 = attach(e.from, wps.length ? wps[0] : b), p1 = attach(e.to, wps.length ? wps[wps.length - 1] : a);
    const pts = [p0, ...wps, p1];
    g.cmds = pts.map((p, i) => [i ? "L" : "M", p.x, p.y]);
    Object.assign(g, { start: p0, end: p1, startFrom: pts[1], endFrom: pts[pts.length - 2], pts });
    const k = Math.max(0, Math.floor((pts.length - 2) / 2));
    const q0 = pts[k], q1 = pts[k + 1];
    g.mid = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
    const len = dist(q0, q1) || 1;
    let n = { x: (q1.y - q0.y) / len, y: -(q1.x - q0.x) / len };  // 線の左上側
    if (n.y > 0 || (Math.abs(n.y) < 1e-9 && n.x > 0)) n = { x: -n.x, y: -n.y };
    const gap = labelGap(e, n);
    g.labelBase = { x: g.mid.x + n.x * gap, y: g.mid.y + n.y * gap };
    g.handles = [{ k: "start", ...p0 }, { k: "end", ...p1 }, ...wps.map((p, i) => ({ k: "wp", i, x: p.x, y: p.y }))];
  }
  g.label = { x: g.labelBase.x + (e.lx || 0), y: g.labelBase.y + (e.ly || 0) };
  return g;
}
function headCmds(tip, from, lw) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), sp = 0.42, L = 9 + lw * 3;
  return [["M", tip.x - L * Math.cos(a - sp), tip.y - L * Math.sin(a - sp)], ["L", tip.x, tip.y],
          ["L", tip.x - L * Math.cos(a + sp), tip.y - L * Math.sin(a + sp)]];
}

// ------------------------------------------------------------------ 論理ゲートの形
// 右向き。入力は左の辺(2 入力なら高さの 1/4 と 3/4、1 入力なら真ん中)、出力は右の辺の真ん中。
const GATE_NAMES = { and: "AND", or: "OR", not: "NOT", nand: "NAND", nor: "NOR", xor: "XOR", xnor: "XNOR", buf: "バッファ" };
function gatePrims(s) {
  const k = s.kind || "and", x = s.x, y = s.y, w = s.w, h = s.h, cy = y + h / 2;
  const bx0 = x + 0.22 * w, bubble = ["nand", "nor", "xnor", "not"].includes(k), r = Math.min(0.05 * w, 0.1 * h);
  const bx1 = x + 0.8 * w - (bubble ? 2 * r : 0), bw = bx1 - bx0, out = [], lw = s.lw;
  const line = (x1, y1, x2, y2) => out.push({ k: "path", cmds: [["M", x1, y1], ["L", x2, y2]], lw });
  const inputs = ["not", "buf"].includes(k) ? [0.5] : [0.25, 0.75];
  let body, leadEnd;
  if (k === "and" || k === "nand") {
    const mx = bx0 + bw * 0.45, rx = bx1 - mx, ry = h / 2, c = 0.5523;
    body = [["M", bx0, y], ["L", mx, y], ["C", mx + c * rx, y, bx1, cy - c * ry, bx1, cy],
            ["C", bx1, cy + c * ry, mx + c * rx, y + h, mx, y + h], ["L", bx0, y + h], ["L", bx0, y]];
    leadEnd = () => bx0;
  } else if (k === "not" || k === "buf") {
    body = [["M", bx0, y + 0.1 * h], ["L", bx1, cy], ["L", bx0, y + 0.9 * h], ["L", bx0, y + 0.1 * h]];
    leadEnd = () => bx0;
  } else {                                  // OR 系:後ろがへこんだ形
    const ox = k === "xor" || k === "xnor" ? bx0 + 0.1 * bw : bx0, ow = bx1 - ox, back = 0.25 * ow;
    body = [["M", ox, y], ["Q", ox + 0.65 * ow, y, bx1, cy], ["Q", ox + 0.65 * ow, y + h, ox, y + h], ["Q", ox + back, cy, ox, y]];
    // 後ろの曲線の上で、高さ v の位置の x
    const backX = (x0, v) => x0 + 2 * (1 - v) * v * back;
    if (ox !== bx0) out.push({ k: "path", cmds: [["M", bx0, y], ["Q", bx0 + back, cy, bx0, y + h]], lw });
    leadEnd = v => backX(bx0, v);
  }
  for (const v of inputs) line(x, y + v * h, leadEnd(v), y + v * h);
  out.unshift({ k: "path", cmds: body, lw, fill: s.fill === "none" ? null : s.fill, dash: !!s.dash });
  if (bubble) out.push({ k: "ellipse", cx: bx1 + r, cy, rx: r, ry: r, lw, fill: "#ffffff" });
  line(bx1 + (bubble ? 2 * r : 0), cy, x + w, cy);
  return out;
}

// ------------------------------------------------------------------ 描く図形の一覧(Python にも送る)
function buildPrims() {
  const out = [];
  for (const s of shapes()) {
    const c = ctr(s), base = { lw: s.lw, dash: !!s.dash, fill: s.fill === "none" ? null : s.fill };
    if (s.type === "ellipse") out.push({ k: "ellipse", cx: c.x, cy: c.y, rx: s.w / 2, ry: s.h / 2, ...base });
    else if (s.type === "gate") out.push(...gatePrims(s));
    else if (s.type !== "text") out.push({ k: "rect", x: s.x, y: s.y, w: s.w, h: s.h, ...base });
    if (s.text) {
      if (s.type === "note") out.push({ k: "text", x: s.x + 10, y: s.y + 8, s: s.text, size: s.fontSize, ha: "left", va: "top", src: s.id });
      else if (s.type === "gate") out.push({ k: "text", x: s.x + s.w * 0.47, y: c.y, s: s.text, size: s.fontSize, ha: "center", va: "center", src: s.id });
      else out.push({ k: "text", x: c.x, y: c.y, s: s.text, size: s.fontSize, ha: "center", va: "center", src: s.id });
    }
  }
  for (const e of edges()) {
    if (!edgeOk(e)) continue;
    const g = edgeGeom(e);
    out.push({ k: "path", cmds: g.cmds, lw: e.lw, dash: !!e.dash });
    if (e.arrow !== "none") out.push({ k: "path", cmds: headCmds(g.end, g.endFrom, e.lw), lw: e.lw });
    if (e.arrow === "both") out.push({ k: "path", cmds: headCmds(g.start, g.startFrom, e.lw), lw: e.lw });
    if (e.label) out.push({ k: "text", x: g.label.x, y: g.label.y, s: e.label, size: e.fontSize, ha: "center", va: "center", src: e.id });
  }
  return out;
}
function edgeOk(e) {
  return (e.from.id == null || get(e.from.id)) && (e.style === "loop" || e.to.id == null || get(e.to.id));
}

// ------------------------------------------------------------------ 画面に描く
function el(tag, attrs, parent) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  (parent || svg).appendChild(n);
  return n;
}
const dStr = cmds => cmds.map(c => c[0] + c.slice(1).map(v => v.toFixed(1)).join(" ")).join(" ");
function drawText(p, parent) {   // 文字と $...$ の数式(並べ方は text.js。書き出しも同じ並べ方)
  const L = layout(p.s, p.size, p.ha, p.va);
  for (const er of L.errors) if (!S.mathErr.some(x => x.tex === er.tex)) S.mathErr.push(er);
  el("g", {}, parent).innerHTML = textMarkup(L, p.x, p.y);
}
function render() {
  svg.innerHTML = "";
  S.mathErr = [];
  const d = S.doc;
  svg.setAttribute("width", d.W * S.zoom); svg.setAttribute("height", d.H * S.zoom);
  svg.setAttribute("viewBox", `0 0 ${d.W} ${d.H}`);
  if (d.showGrid) {
    const defs = el("defs", {});
    const pat = el("pattern", { id: "grid", width: d.grid * 5, height: d.grid * 5, patternUnits: "userSpaceOnUse" }, defs);
    for (let i = 0; i < 5; i++) {
      const v = i * d.grid, c = i === 0 ? "#dcdcd8" : "#efefec";
      el("line", { x1: v, y1: 0, x2: v, y2: d.grid * 5, stroke: c, "stroke-width": 1 }, pat);
      el("line", { x1: 0, y1: v, x2: d.grid * 5, y2: v, stroke: c, "stroke-width": 1 }, pat);
    }
    el("rect", { x: 0, y: 0, width: d.W, height: d.H, fill: "url(#grid)" });
  }
  const u = d.underlay;
  if (u && u.src && u.visible !== false)
    el("image", { href: u.src, x: u.x, y: u.y, width: u.w, height: u.h, opacity: u.opacity ?? 0.4, preserveAspectRatio: "none" });
  const layer = el("g", {});
  for (const p of buildPrims()) {
    const st = { stroke: "#000", "stroke-width": p.lw, "stroke-dasharray": p.dash ? `${p.lw * 5} ${p.lw * 3}` : null,
                 fill: p.fill || "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
    if (p.k === "ellipse") el("ellipse", { cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry, ...st }, layer);
    else if (p.k === "rect") el("rect", { x: p.x, y: p.y, width: p.w, height: p.h, ...st }, layer);
    else if (p.k === "path") el("path", { d: dStr(p.cmds), ...st, fill: p.fill || "none" }, layer);
    else if (p.k === "text" && p.src !== S.editing) drawText(p, layer);   // 編集中の文字は入力欄の方だけ見せる
  }
  drawOverlay();
  updateUI();
}
function drawOverlay() {
  const A = "#2a78d6";
  const u = S.doc.underlay;
  if (S.underEdit && u && u.src) {
    el("rect", { x: u.x, y: u.y, width: u.w, height: u.h, fill: "none", stroke: "#eda100", "stroke-width": px(2), "stroke-dasharray": `${px(6)} ${px(4)}` });
    el("rect", { x: u.x + u.w - px(7), y: u.y + u.h - px(7), width: px(14), height: px(14), fill: "#fff", stroke: "#eda100", "stroke-width": px(2) });
  }
  for (const g of S.guides) el("line", { ...g, stroke: "#e34948", "stroke-width": 1, "stroke-dasharray": "4 3" });
  const one = S.sel.length === 1 ? get(S.sel[0]) : null;
  for (const it of selItems()) {
    if (isShape(it)) {
      el("rect", { x: it.x - 3, y: it.y - 3, width: it.w + 6, height: it.h + 6, fill: "none", stroke: A, "stroke-width": 1, "stroke-dasharray": "4 3" });
      if (it === one) for (const h of cornerHandles(it)) el("rect", { x: h.x - px(5), y: h.y - px(5), width: px(10), height: px(10), fill: "#fff", stroke: A, "stroke-width": px(1.5) });
    } else if (edgeOk(it)) {
      const g = edgeGeom(it);
      el("path", { d: dStr(g.cmds), fill: "none", stroke: A, "stroke-width": it.lw + 5, opacity: .25 });
      if (it === one) {
        if (it.style === "curve") {   // 調整点までの補助線
          const dsh = `${px(3)} ${px(3)}`;
          el("line", { x1: g.start.x, y1: g.start.y, x2: g.c1.x, y2: g.c1.y, stroke: A, "stroke-width": px(1), "stroke-dasharray": dsh });
          el("line", { x1: g.end.x, y1: g.end.y, x2: g.c2.x, y2: g.c2.y, stroke: A, "stroke-width": px(1), "stroke-dasharray": dsh });
        }
        for (const h of g.handles) {
          if (h.k === "c1" || h.k === "c2") { const r = px(6); el("path", { d: `M${h.x} ${h.y - r}L${h.x + r} ${h.y}L${h.x} ${h.y + r}L${h.x - r} ${h.y}Z`, fill: "#fff", stroke: A, "stroke-width": px(1.5) }); }
          else el("circle", { cx: h.x, cy: h.y, r: px(6), fill: h.k === "start" || h.k === "end" ? "#fff" : A, stroke: A, "stroke-width": px(1.5) });
        }
        el("circle", { cx: g.label.x, cy: g.label.y, r: px(4), fill: "#eda100", stroke: "#fff", "stroke-width": px(1) });
      }
    }
  }
  if (S.drag && S.drag.kind === "box") {
    const b = boxOf(S.drag.start, S.mouse);
    el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "rgba(42,120,214,.08)", stroke: A, "stroke-width": 1 });
  }
  if (S.drag && S.drag.kind === "create") {
    const b = boxOf(S.drag.start, snapP(S.mouse));
    el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "none", stroke: A, "stroke-width": 1, "stroke-dasharray": "4 3" });
  }
  if (S.drag && S.drag.kind === "edge") {
    const to = endpointAt(S.mouse), a = attach(S.drag.from, refPt(to)), b = attach(to, refPt(S.drag.from));
    el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: A, "stroke-width": 2, "stroke-dasharray": "5 4" });
    hoverRing(to);
  }
  if (S.draft) {
    const pts = draftPts();
    el("polyline", { points: pts.map(p => `${p.x},${p.y}`).join(" "), fill: "none", stroke: A, "stroke-width": 2, "stroke-dasharray": "5 4" });
    hoverRing(endpointAt(S.mouse));
  }
}
function hoverRing(end) {
  if (end.id == null) return;
  const s = get(end.id);
  el("rect", { x: s.x - 4, y: s.y - 4, width: s.w + 8, height: s.h + 8, fill: "none", stroke: "#1baf7a", "stroke-width": 2, rx: 6 });
  if (end.ax != null || end.ang != null) { const p = refPt(end); el("circle", { cx: p.x, cy: p.y, r: px(5), fill: "#1baf7a" }); }
}
const boxOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
const cornerHandles = s => [
  { k: "nw", x: s.x, y: s.y }, { k: "ne", x: s.x + s.w, y: s.y },
  { k: "sw", x: s.x, y: s.y + s.h }, { k: "se", x: s.x + s.w, y: s.y + s.h }];

// ------------------------------------------------------------------ 選択・当たり判定
function samplePts(cmds) {
  const pts = []; let cur = null;
  for (const c of cmds) {
    if (c[0] === "M" || c[0] === "L") { cur = { x: c[1], y: c[2] }; pts.push(cur); }
    else if (c[0] === "Q") {
      const p0 = cur;
      for (let t = .05; t <= 1.0001; t += .05) pts.push({
        x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c[1] + t * t * c[3], y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c[2] + t * t * c[4] });
      cur = { x: c[3], y: c[4] };
    } else if (c[0] === "C") {
      const p0 = cur;
      for (let t = .05; t <= 1.0001; t += .05) {
        const u = 1 - t;
        pts.push({ x: u ** 3 * p0.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5],
                   y: u ** 3 * p0.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6] });
      }
      cur = { x: c[5], y: c[6] };
    }
  }
  return pts;
}
function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function labelBox(e, g) {
  const b = layout(e.label, e.fontSize, "center", "center").box;
  return { x: g.label.x + b.x - 4, y: g.label.y + b.y - 2, w: b.w + 8, h: b.h + 4 };
}
function hitTest(p) {
  const es = edges().filter(edgeOk);
  for (let i = es.length - 1; i >= 0; i--) {
    const e = es[i], g = edgeGeom(e);
    if (e.label) { const b = labelBox(e, g); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { item: e, label: true }; }
    const pts = samplePts(g.cmds);
    for (let j = 1; j < pts.length; j++) if (distSeg(p, pts[j - 1], pts[j]) < px(6)) return { item: e };
  }
  const s = shapeAt(p);
  return s ? { item: s } : null;
}
function handleAt(p) {
  if (S.sel.length !== 1) return null;
  const it = get(S.sel[0]);
  if (!it) return null;
  if (isShape(it)) { const h = cornerHandles(it).find(h => dist(h, p) < px(8)); return h ? { ...h, item: it } : null; }
  if (!edgeOk(it)) return null;
  const g = edgeGeom(it);
  const h = g.handles.find(h => dist(h, p) < px(8));
  if (h) return { ...h, item: it, g };
  if (dist(g.label, p) < px(7)) return { k: "label", item: it, g };
  return null;
}

// ------------------------------------------------------------------ 履歴
function pushHist() { S.hist.push(JSON.stringify(S.doc)); if (S.hist.length > 200) S.hist.shift(); S.fut = []; }
function undo() { if (!S.hist.length) return; S.fut.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.hist.pop()); afterJump(); }
function redo() { if (!S.fut.length) return; S.hist.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.fut.pop()); afterJump(); }
function afterJump() { S.sel = S.sel.filter(get); render(); push(); }
function commit() { render(); push(); }

// ------------------------------------------------------------------ マウス
const ptOf = ev => { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) / S.zoom, y: (ev.clientY - r.top) / S.zoom }; };
function draftPts() { // 直角の線を描いている途中の点(最後はマウスに向けて縦か横)
  const d = S.draft, fixed = [refPt(d.from), ...d.pts], last = fixed[fixed.length - 1];
  return [...fixed, orth(last, S.mouse)];
}
function orth(last, p) {
  const q = snapP(p);
  return Math.abs(q.x - last.x) >= Math.abs(q.y - last.y) ? { x: q.x, y: last.y } : { x: last.x, y: q.y };
}

let lastDown = null;
svg.addEventListener("mousedown", ev => {
  if (ev.button === 1 || (ev.button === 0 && S.space)) {   // スペース+ドラッグ / ホイールを押してドラッグ → 画面を動かす
    ev.preventDefault();
    S.drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    setCursor("grabbing"); return;
  }
  if (ev.button !== 0) return;
  const p = ptOf(ev); S.mouse = p;
  const u = S.doc.underlay;
  if (S.underEdit && u && u.src) {            // 下絵の位置・大きさを調整中
    const corner = Math.hypot(p.x - (u.x + u.w), p.y - (u.y + u.h)) < px(12);
    if (corner || (p.x >= u.x && p.x <= u.x + u.w && p.y >= u.y && p.y <= u.y + u.h)) {
      pushHist();
      S.drag = { kind: corner ? "uresize" : "umove", start: p, orig: { ...u }, moved: false };
    }
    return;
  }
  const now = performance.now();
  if (lastDown && now - lastDown.t < 450 && Math.hypot(ev.clientX - lastDown.x, ev.clientY - lastDown.y) < 6) {
    lastDown = null; closeEditor(true); onDouble(p); return;
  }
  lastDown = { t: now, x: ev.clientX, y: ev.clientY };
  closeEditor(true);
  const t = S.tool;
  if (t === "select") {
    const h = handleAt(p);
    if (h) { pushHist(); S.drag = { kind: "handle", h, moved: false }; return; }
    const hit = hitTest(p);
    if (hit) {
      const id = hit.item.id;
      if (ev.shiftKey) S.sel = S.sel.includes(id) ? S.sel.filter(i => i !== id) : [...S.sel, id];
      else if (!S.sel.includes(id)) S.sel = [id];
      if (hit.label && S.sel.length === 1) { pushHist(); S.drag = { kind: "handle", h: { k: "label", item: hit.item, g: edgeGeom(hit.item) }, moved: false }; }
      else { pushHist(); S.drag = { kind: "move", start: p, orig: JSON.stringify(S.doc), moved: false }; }
    } else {
      if (!ev.shiftKey) S.sel = [];
      S.drag = { kind: "box", start: p };
    }
  } else if (DEF[t]) {
    S.drag = { kind: "create", start: snapP(p) };
  } else if (t === "straight" || t === "curve") {
    S.drag = { kind: "edge", from: endpointAt(p), start: p };
  } else if (t === "elbow") {
    if (!S.draft) S.draft = { from: endpointAt(p), pts: [] };
    else {
      const s = nearShape(p);
      if (s && !S.draft.pts.length && s.id === S.draft.from.id) { /* 始点の図形をもう一度クリック → 何もしない */ }
      else if (s) finishElbow(endpointAt(p));
      else { const pts = draftPts(); S.draft.pts.push(pts[pts.length - 1]); }
    }
  }
  render();
});
window.addEventListener("mousemove", ev => {
  if (S.drag && S.drag.kind === "pan") {
    wrap.scrollLeft = S.drag.sl - (ev.clientX - S.drag.sx); wrap.scrollTop = S.drag.st - (ev.clientY - S.drag.sy);
    return;
  }
  S.mouse = ptOf(ev);
  updateCursor(ev);
  if (!S.drag && !S.draft && S.tool === "select") return;
  if (S.drag) dragMove(S.drag, S.mouse);
  render();
});
window.addEventListener("mouseup", ev => {
  const d = S.drag; if (!d) return;
  S.drag = null; S.guides = [];
  if (d.kind === "pan") { updateCursor(ev); return; }
  const p = ptOf(ev);
  if (d.kind === "box") {
    const b = boxOf(d.start, p);
    if (b.w > 3 || b.h > 3) {
      const inside = shapes().filter(s => s.x >= b.x && s.y >= b.y && s.x + s.w <= b.x + b.w && s.y + s.h <= b.y + b.h).map(s => s.id);
      const ins = new Set(inside);
      const es = edges().filter(e => {     // 両端とも選んだ図形につながっている矢印も選ぶ
        const att = [e.from, e.style === "loop" ? e.from : e.to].filter(x => x.id != null);
        return att.length && att.every(x => ins.has(x.id));
      }).map(e => e.id);
      S.sel = [...new Set([...S.sel, ...inside, ...es])];
    }
    render(); return;
  }
  if (d.kind === "create") { createShape(d.start, snapP(p)); return; }
  if (d.kind === "edge") { createEdge(d.from, endpointAt(p), d.start, p); return; }
  if (d.kind === "handle" && d.h.k !== "label" && (d.h.k === "start" || d.h.k === "end")) dropEndpoint(d, p);
  if (!d.moved) { S.hist.pop(); render(); return; }
  commit();
});
// ダブルクリック:クリックのたびに図を描き直すので、ブラウザの dblclick は届かない。自分で判定する。
function onDouble(p) {
  if (S.draft && S.draft.pts.length) { finishElbow(snapP(orth([refPt(S.draft.from), ...S.draft.pts].slice(-1)[0], p))); return; }
  S.draft = null;   // 直角の線を描き始めただけなら、やめて文字の編集にする
  S.drag = null;
  const hit = hitTest(p);   // どの道具を選んでいても、ダブルクリックで文字を編集できる
  if (hit) { S.tool = "select"; S.sel = [hit.item.id]; render(); openEditor(hit.item); }
  else render();
}

function dragMove(d, p) {
  if (d.kind === "umove" || d.kind === "uresize") {
    const u = S.doc.underlay, o = d.orig; d.moved = true;
    if (d.kind === "umove") { u.x = o.x + p.x - d.start.x; u.y = o.y + p.y - d.start.y; }
    else { const kk = Math.max(0.1, (p.x - o.x) / o.w); u.w = o.w * kk; u.h = o.h * kk; }   // 縦横比は保つ
    return;
  }
  if (d.kind === "move") {
    const dx0 = p.x - d.start.x, dy0 = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx0, dy0) < 3) return;
    if (!d.moved) {
      const keep = new Set(S.sel.filter(id => isShape(get(id))));
      for (const id of S.sel) { const it = get(id); if (it && !isShape(it)) detachEnds(it, keep); }
      d.orig = JSON.stringify(S.doc);          // 外したあとの位置を基準に動かす
    }
    d.moved = true;
    const orig = JSON.parse(d.orig), O = id => orig.items.find(i => i.id === id);
    const sel = new Set(S.sel), selShapes = orig.items.filter(i => sel.has(i.id) && isShape(i));
    let dx = dx0, dy = dy0;
    S.guides = [];
    if (selShapes.length) {      // 先頭の図形の左上をグリッドに合わせる(大きさもグリッドの倍数なので、四辺ともグリッドに乗る)
      const s0 = selShapes[0];
      let tx = snapV(s0.x + dx), ty = snapV(s0.y + dy);
      // 他の図形の辺(上下左右)や中心とほぼそろうときは、そちらに合わせてガイド線を出す
      const raw = { x: s0.x + dx, y: s0.y + dy };
      let best = { x: px(7), y: px(7) };
      for (const o of shapes().filter(s => !sel.has(s.id))) {
        for (const [mine, off] of [[0, 0], [s0.w / 2, 0.5], [s0.w, 1]])          // 自分の 左・中心・右
          for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {                    // 相手の 左・中心・右
            const dd = Math.abs(raw.x + mine - ox);
            if (dd < best.x) { best.x = dd; tx = ox - mine; S.guides[0] = { x1: ox, y1: 0, x2: ox, y2: S.doc.H }; }
          }
        for (const mine of [0, s0.h / 2, s0.h])
          for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
            const dd = Math.abs(raw.y + mine - oy);
            if (dd < best.y) { best.y = dd; ty = oy - mine; S.guides[1] = { x1: 0, y1: oy, x2: S.doc.W, y2: oy }; }
          }
      }
      S.guides = S.guides.filter(Boolean);
      dx = tx - s0.x; dy = ty - s0.y;
    } else { dx = snapV(dx); dy = snapV(dy); }
    for (const id of sel) {
      const it = get(id), o = O(id);
      if (!it || !o) continue;
      if (isShape(it)) { it.x = o.x + dx; it.y = o.y + dy; }
      else {
        if (it.from.id == null) { it.from.x = o.from.x + dx; it.from.y = o.from.y + dy; }
        if (it.to && it.to.id == null && it.style !== "loop") { it.to.x = o.to.x + dx; it.to.y = o.to.y + dy; }
        if (it.points) it.points = o.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
      }
    }
    // 選んだ図形につながっている直角の線は、曲がり角も一緒に動かす
    for (const e of edges()) {
      if (sel.has(e.id) || e.style !== "elbow" || !(e.points || []).length) continue;
      const o = O(e.id); if (!o) continue;
      const fs = sel.has(e.from.id), ts = sel.has(e.to.id);
      if (fs && ts) e.points = o.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
      else if (fs || ts) {
        e.points = o.points.map(q => ({ ...q }));
        const i = fs ? 0 : e.points.length - 1, endO = refPtIn(orig, fs ? o.from : o.to), q = o.points[i];
        if (Math.abs(q.y - endO.y) < 1) e.points[i].y = q.y + dy;   // 横の線 → 高さを合わせる
        if (Math.abs(q.x - endO.x) < 1) e.points[i].x = q.x + dx;   // 縦の線 → 横位置を合わせる
      }
    }
  } else if (d.kind === "handle") {
    const h = d.h, it = h.item;
    d.moved = true;
    if (["nw", "ne", "sw", "se"].includes(h.k)) {
      const q = snapP(p), fx = h.k.includes("w") ? it.x + it.w : it.x, fy = h.k.includes("n") ? it.y + it.h : it.y;
      if (!d.fixed) d.fixed = snapP({ x: fx, y: fy });
      const b = boxOf(d.fixed, q);
      if (b.w >= 20) { it.x = b.x; it.w = b.w; }
      if (b.h >= 20) { it.y = b.y; it.h = b.h; }
    } else if (h.k === "mid") {        // 真ん中の点:両端は動かさず、曲線がこの点を通るようにする(グリッドには合わせない)
      if (!d.frozen) { freezeEnds(it); d.frozen = true; }
      const g = edgeGeom(it), q = p;
      if (it.c1 && it.c2) {
        if (!d.init) d.init = { c1: { ...it.c1 }, c2: { ...it.c2 }, mid: g.mid };
        const ddx = (q.x - d.init.mid.x) * 4 / 3, ddy = (q.y - d.init.mid.y) * 4 / 3;
        it.c1 = { dx: d.init.c1.dx + ddx, dy: d.init.c1.dy + ddy }; it.c2 = { dx: d.init.c2.dx + ddx, dy: d.init.c2.dy + ddy };
      } else { it.mx = q.x - g.cm.x; it.my = q.y - g.cm.y; }
    } else if (h.k === "c1" || h.k === "c2") {   // ◇:その側の曲がり方だけを変える
      if (!d.frozen) { freezeEnds(it); d.frozen = true; }
      const g = edgeGeom(it);
      if (!it.c1 || !it.c2) {      // 今の形を調整点として固定する
        it.c1 = { dx: g.c1.x - g.a.x, dy: g.c1.y - g.a.y }; it.c2 = { dx: g.c2.x - g.b.x, dy: g.c2.y - g.b.y };
        delete it.mx; delete it.my;
      }
      const q = p, base = h.k === "c1" ? g.a : g.b;   // ◇ はグリッドに合わせない
      it[h.k] = { dx: q.x - base.x, dy: q.y - base.y };
    } else if (h.k === "wp") {
      const q = snapP(p), pts = it.points, old = pts[h.i];
      const ns = nearShape(p);   // 図形の輪郭の近くなら、輪郭の上に乗せる
      if (ns && !shapeAt(p)) {
        const b = boundary(ns, p);
        if (Math.abs(b.x - p.x) < px(EDGE_BAND)) q.x = Math.round(b.x);
        if (Math.abs(b.y - p.y) < px(EDGE_BAND)) q.y = Math.round(b.y);
      }
      for (const j of [h.i - 1, h.i + 1]) {   // となりの曲がり角も動かして、縦横を保つ
        if (j < 0 || j >= pts.length) continue;
        if (Math.abs(pts[j].y - old.y) < 1) pts[j].y = q.y;
        else if (Math.abs(pts[j].x - old.x) < 1) pts[j].x = q.x;
      }
      pts[h.i] = q;
    } else if (h.k === "label") {
      const g = edgeGeom(it);
      it.lx = Math.round(p.x - g.labelBase.x); it.ly = Math.round(p.y - g.labelBase.y);
    } else if (h.k === "start" || h.k === "end") {
      if (!d.init) { const g = edgeGeom(it); d.init = { M: g.mid }; }   // 真ん中の点はその場にとどめる
      let end = endpointAt(p);                // 図形から離せば自由な点になる
      const other = h.k === "start" ? it.to : it.from;
      if (end.id != null && end.id === other.id && end.ang == null && end.ax == null) {
        const sh = get(end.id); end = anchorOn(sh, boundary(sh, p));   // 同じ図形の上では輪郭に乗せる
      }
      if (h.k === "start") it.from = end; else it.to = end;
      if (it.style === "curve" && it.mx != null && !(it.c1 && it.c2)) {
        const a2 = refPt(it.from), b2 = refPt(it.to);
        it.mx = d.init.M.x - (a2.x + b2.x) / 2; it.my = d.init.M.y - (a2.y + b2.y) / 2;
      }
    }
  }
}
function refPtIn(doc, end) {
  if (end.id == null) return end;
  const s = doc.items.find(i => i.id === end.id);
  if (!s) return { x: 0, y: 0 };
  if (end.ang != null) return angPt(s, end.ang);
  if (s.type === "ellipse" || end.ax == null) return ctr(s);
  return { x: s.x + end.ax * s.w, y: s.y + end.ay * s.h };
}
function dropEndpoint(d, p) {
  const e = d.h.item;
  if (e.from.id != null && e.to.id != null && e.from.id === e.to.id && e.style !== "curve") makeLoop(e);
}

// ------------------------------------------------------------------ 作る
function createShape(a, b) {
  const t = S.tool, def = DEF[t], box = boxOf(a, b);
  const under = box.w < 15 && box.h < 15 ? (shapeAt(S.mouse) || hitTest(S.mouse)?.item) : null;
  if (under) { S.sel = [under.id]; render(); return; }   // 既にある図形の上をクリックしたら選ぶだけ
  pushHist();
  const s = { id: S.doc.nextId++, type: t, ...def };
  if (t === "gate") s.kind = S.gateKind || "and";
  const fit = v => S.doc.snap ? Math.max(S.doc.grid, Math.round(v / S.doc.grid) * S.doc.grid) : v;
  if (box.w >= 15 && box.h >= 15) Object.assign(s, box);
  else { s.w = fit(def.w); s.h = fit(def.h); s.x = snapV(a.x - s.w / 2); s.y = snapV(a.y - s.h / 2); }
  S.doc.items.push(s);
  S.sel = [s.id]; setTool("select");
  commit();
  if (t !== "gate") openEditor(s);
}
function createEdge(from, to, start, p) {
  if (dist(start, p) < 10) { render(); return; }   // クリックしただけのときは何も作らない
  pushHist();
  const e = { id: S.doc.nextId++, type: "edge", style: S.tool, from, to, label: "", fontSize: 18, lw: 1.5, arrow: "end", dash: false };
  if (S.tool === "curve") e.bend = 40;
  if (from.id != null && from.id === to.id) makeLoop(e);
  // 注釈から引く線は、細い線にする(参考図の「ここを設計」のような指し示し)
  const src = from.id != null ? get(from.id) : null;
  if (src && src.type === "note") e.lw = 1;
  S.doc.items.push(e);
  S.sel = [e.id]; S.tool = "select";   // 置いたら選択に戻る
  commit(); updateCursor();
  if (!(src && src.type === "note")) openEditor(e);
}
function simplify(a, pts, b) { // 一直線に並んだ余分な曲がり角を取りのぞく
  const all = [a, ...pts, b], keep = [];
  for (let i = 1; i < all.length - 1; i++) {
    const p = all[i - 1], q = all[i], r = all[i + 1];
    const same = (Math.abs(p.x - q.x) < 1 && Math.abs(q.x - r.x) < 1) || (Math.abs(p.y - q.y) < 1 && Math.abs(q.y - r.y) < 1);
    if (!same && dist(p, q) > 0.5) keep.push(q);
  }
  return keep;
}
function finishElbow(to) {
  const d = S.draft; S.draft = null;
  const pts = d.pts.slice(), last = pts.length ? pts[pts.length - 1] : refPt(d.from);
  if (to.id != null) {             // 終点の図形に縦か横で入るように、必要なら角を足す
    const s = get(to.id), e = refPt(to);
    const sideways = s.type === "ellipse" && to.ang == null ? Math.abs(last.y - e.y) < Math.abs(last.x - e.x)
      : to.ang != null ? Math.abs(Math.cos(to.ang)) > 0.7 : (to.ax === 0 || to.ax === 1);
    if (Math.abs(last.x - e.x) > 1 && Math.abs(last.y - e.y) > 1) pts.push(sideways ? { x: last.x, y: e.y } : { x: e.x, y: last.y });
  }
  if (to.id == null && d.from.id == null && !pts.length) { render(); return; }
  pushHist();
  const e = { id: S.doc.nextId++, type: "edge", style: "elbow", from: d.from, to, points: simplify(refPt(d.from), pts, refPt(to)), label: "", fontSize: 18, lw: 1.5, arrow: "end", dash: false };
  S.doc.items.push(e);
  S.sel = [e.id]; S.tool = "select";   // 置いたら選択に戻る
  commit(); updateCursor();
}

// ------------------------------------------------------------------ 文字の編集
function openEditor(it) {
  const ta = $("edit");
  let x, y, w, h, text, size;
  if (isShape(it)) {
    text = it.text || ""; size = it.fontSize;
    const k = it.type === "ellipse" ? 0.72 : 0.92, lines = Math.max(1, text.split("\n").length);
    w = it.w * k; h = Math.min(it.h * k, lines * size * 1.25 + 6);
    x = it.x + (it.w - w) / 2; y = it.type === "note" ? it.y + 6 : it.y + (it.h - h) / 2;
  }
  else { const g = edgeGeom(it); size = it.fontSize; w = 180; h = size * 1.6 + 8; x = g.label.x - w / 2; y = g.label.y - h / 2; text = it.label || ""; }
  const z = S.zoom;
  Object.assign(ta.style, { display: "block", left: x * z + "px", top: y * z + "px", width: Math.max(w * z, 80) + "px",
    height: h * z + "px", fontSize: size * z + "px", textAlign: it.type === "note" ? "left" : "center" });
  ta.value = text;
  S.editing = it.id;
  render();   // 図の方の文字を隠す
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
}
function closeEditor(save) {
  const ta = $("edit");
  if (S.editing == null) return;
  const it = get(S.editing); S.editing = null;
  ta.style.display = "none";
  ta.blur();   // キーボードの操作(Delete など)を図の画面に戻す
  if (save && it) {
    const v = ta.value.replace(/\s+$/, "");
    const cur = isShape(it) ? it.text : it.label;
    if (v !== cur) { pushHist(); if (isShape(it)) it.text = v; else it.label = v; commit(); return; }
  }
  render();
}
$("edit").addEventListener("keydown", ev => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); closeEditor(true); }
  else if (ev.key === "Escape") { ev.preventDefault(); closeEditor(false); }
  ev.stopPropagation();
});
$("edit").addEventListener("blur", () => closeEditor(true));
$("edit").addEventListener("input", ev => {   // 改行したら入力欄を広げる
  const ta = ev.target, it = get(S.editing); if (!it) return;
  const lines = ta.value.split("\n").length, size = it.fontSize * S.zoom;
  ta.style.height = Math.max(parseFloat(ta.style.height), lines * size * 1.25 + 6) + "px";
});

// ------------------------------------------------------------------ キーボード・ボタン
function delSel() {
  if (!S.sel.length) return;
  pushHist();
  const ids = new Set(S.sel);
  S.doc.items = S.doc.items.filter(i => !ids.has(i.id) && !(i.type === "edge" && (ids.has(i.from.id) || ids.has(i.to && i.to.id))));
  S.sel = []; commit();
}
function copySel() {
  const ids = new Set(S.sel);
  const picked = S.doc.items.filter(i => ids.has(i.id) || (i.type === "edge" && ids.has(i.from.id) && ids.has(i.to.id)));
  const shapeIds = new Set(picked.filter(isShape).map(i => i.id));
  const items = picked.map(i => {
    const c = JSON.parse(JSON.stringify(i));
    if (!isShape(c)) {          // コピーしない図形につながった端は、図形から外した自由な点にする
      const real = get(i.id), tmp = JSON.parse(JSON.stringify(real));
      S.doc.items.push(tmp); tmp.id = -1;          // 位置の計算だけに使う
      try { detachEnds(tmp, shapeIds); } finally { S.doc.items.pop(); }
      Object.assign(c, { from: tmp.from, to: tmp.to });
      for (const k of ["c1", "c2", "mx", "my"]) if (tmp[k] !== undefined) c[k] = tmp[k];
    }
    return c;
  });
  S.clip = items.length ? JSON.stringify(items) : S.clip;
}
function paste() {
  if (!S.clip) return;
  pushHist();
  const items = JSON.parse(S.clip), map = {}, off = S.doc.grid * 2;
  for (const it of items) map[it.id] = S.doc.nextId++;
  const fixEnd = end => end.id != null ? (map[end.id] ? { ...end, id: map[end.id] } : end) : { x: end.x + off, y: end.y + off };
  for (const it of items) {
    it.id = map[it.id];
    if (isShape(it)) { it.x += off; it.y += off; }
    else { it.from = fixEnd(it.from); it.to = fixEnd(it.to); if (it.points) it.points = it.points.map(q => ({ x: q.x + off, y: q.y + off })); }
    S.doc.items.push(it);
  }
  S.sel = items.map(i => i.id);
  S.clip = JSON.stringify(items);
  commit();
}
function nudge(dx, dy) {
  const sel = selItems().filter(isShape);
  if (!sel.length) return;
  pushHist();
  for (const s of sel) { s.x += dx; s.y += dy; }
  commit();
}
document.addEventListener("keyup", ev => {
  if (ev.key === " ") { S.space = false; }
  updateCursor(ev);
});
window.addEventListener("blur", () => { S.space = false; updateCursor(); });
document.addEventListener("keydown", ev => {
  if (S.editing != null || ["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName) || ev.target.isContentEditable) return;
  if (document.querySelector("dialog[open], .pop.open")) return;
  if (ev.key === " ") { ev.preventDefault(); S.space = true; updateCursor(ev); return; }
  if (ev.key === "Meta" || ev.key === "Control" || ev.key === "Alt") { updateCursor(ev); return; }
  const mod = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  if (mod && k === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if (mod && k === "y") { ev.preventDefault(); redo(); }
  else if (mod && k === "c") { copySel(); }
  else if (mod && k === "v") { ev.preventDefault(); paste(); }
  else if (mod && k === "d") { ev.preventDefault(); copySel(); paste(); }
  else if (mod && k === "a") { ev.preventDefault(); S.sel = S.doc.items.map(i => i.id); render(); }
  else if (k === "+" || k === "=" || k === ";") { ev.preventDefault(); zoomStep(1); }
  else if (k === "-") { ev.preventDefault(); zoomStep(-1); }
  else if (k === "0") { ev.preventDefault(); setZoom(1); }
  else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); delSel(); }
  else if (ev.key === "Escape") { S.draft = null; S.drag = null; S.sel = []; setTool("select"); }
  else if (ev.key === "Enter" && S.sel.length === 1) { ev.preventDefault(); openEditor(get(S.sel[0])); }
  else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    const st = ev.altKey ? 1 : S.doc.grid;
    nudge(ev.key === "ArrowLeft" ? -st : ev.key === "ArrowRight" ? st : 0, ev.key === "ArrowUp" ? -st : ev.key === "ArrowDown" ? st : 0);
  } else if (!mod) {
    const t = TOOLS.find(t => t[2].toLowerCase() === k);
    if (t) setTool(t[0]);
  }
});

function setTool(t) { S.tool = t; S.draft = null; render(); updateCursor(); }
const ICON = {
  select: '<path d="M6 3l12 9-5.5 1L15 19l-2.5 1.2-2.6-6L6 17z" fill="currentColor"/>',
  ellipse: '<ellipse cx="13" cy="11" rx="10" ry="7" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  rect: '<rect x="3" y="4" width="20" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  note: '<rect x="3" y="3" width="20" height="16" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 8h12M7 12h9" stroke="currentColor" stroke-width="1.5"/>',
  text: '<path d="M6 5h14M13 5v13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  straight: '<path d="M3 17L21 5M21 5h-6M21 5v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  curve: '<path d="M3 18C5 6 15 4 21 8M21 8l-6-1.5M21 8l-2 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  elbow: '<path d="M3 5h10v12h8M21 17l-4-3.5M21 17l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svgIcon = (body, vb = "0 0 26 22") => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
function gateIcon(kind) {   // 実際の形(gatePrims)を小さく描いたアイコン
  const prims = gatePrims({ kind, x: 1, y: 1, w: 58, h: 38, lw: 2.4, fill: "none" });
  const body = prims.map(p => p.k === "ellipse"
    ? `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="none" stroke="currentColor" stroke-width="2.4"/>`
    : `<path d="${dStr(p.cmds)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`).join("");
  return svgIcon(body, "0 0 60 40");
}
const TOOL_LABEL = { select: "選択", ellipse: "楕円", rect: "四角", note: "注釈", text: "文字", straight: "直線", curve: "曲線", elbow: "直角線" };
function buildToolbar() {
  const pal = $("palette");
  const btn = (tool, label, icon, extra) => {
    const b = document.createElement("button");
    b.className = "tool"; b.dataset.tool = tool; if (extra) b.dataset.gate = extra;
    const t = TOOLS.find(t => t[0] === tool);
    b.title = extra ? `${GATE_NAMES[extra]}(クリックして画面に置く)` : `${label}(${t[2]} キー)\n${t[3]}`;
    b.innerHTML = icon + `<span>${label}</span>`;
    b.onclick = () => { if (extra) S.gateKind = extra; setTool(tool); };
    return b;
  };
  const title = t => { const d = document.createElement("div"); d.className = "ptitle"; d.textContent = t; pal.appendChild(d); };
  pal.appendChild(btn("select", "選択", svgIcon(ICON.select)));
  title("図形");
  for (const t of ["ellipse", "rect", "note", "text"]) pal.appendChild(btn(t, TOOL_LABEL[t], svgIcon(ICON[t])));
  title("線・矢印");
  for (const t of ["straight", "curve", "elbow"]) pal.appendChild(btn(t, TOOL_LABEL[t], svgIcon(ICON[t])));
  title("論理ゲート");
  const g = document.createElement("div"); g.className = "gates"; pal.appendChild(g);
  for (const k of Object.keys(GATE_NAMES)) g.appendChild(btn("gate", k === "buf" ? "BUF" : GATE_NAMES[k], gateIcon(k), k));

  $("g_show").onchange = e => { S.doc.showGrid = e.target.checked; commit(); };
  $("g_snap").onchange = e => { S.doc.snap = e.target.checked; commit(); };
  $("g_size").onchange = e => { S.doc.grid = +e.target.value; commit(); };
  $("b_undo").onclick = undo; $("b_redo").onclick = redo;
  $("b_dup").onclick = () => { copySel(); paste(); };
  $("b_del").onclick = delSel;
}

// ------------------------------------------------------------------ 右の設定欄
const SIDE_ICON = {
  arrowNone: '<path d="M2 8h20" stroke="currentColor" stroke-width="2"/>',
  arrowEnd: '<path d="M2 8h18M15 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowBoth: '<path d="M4 8h16M9 3.5 4 8l5 4.5M15 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  straight: '<path d="M2 13 22 3" stroke="currentColor" stroke-width="2" fill="none"/>',
  curve: '<path d="M2 14C6 2 16 2 22 6" stroke="currentColor" stroke-width="2" fill="none"/>',
  elbow: '<path d="M2 3h10v10h10" stroke="currentColor" stroke-width="2" fill="none"/>',
  solid: '<path d="M2 8h20" stroke="currentColor" stroke-width="2"/>',
  dash: '<path d="M2 8h20" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>',
};
const ALIGN_ICON = {
  left: '<path d="M4 3v18M8 7h10M8 15h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  hcenter: '<path d="M12 3v18M6 7h12M8 15h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  right: '<path d="M20 3v18M6 7h10M10 15h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  top: '<path d="M3 4h18M7 8v10M15 8v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  vcenter: '<path d="M3 12h18M7 6v12M15 8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  bottom: '<path d="M3 20h18M7 6v10M15 10v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  hdist: '<path d="M3 4v16M21 4v16M10 8v8M14 8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  vdist: '<path d="M4 3h16M4 21h16M8 10h8M8 14h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
const seg = (key, opts, cur) => `<div class="seg" data-key="${key}">` + opts.map(([v, label, tip]) =>
  `<button data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}" title="${tip || ""}">${label}</button>`).join("") + `</div>`;
const sicon = n => `<svg viewBox="0 0 24 16">${SIDE_ICON[n]}</svg>`;
const aicon = n => `<svg viewBox="0 0 24 24">${ALIGN_ICON[n]}</svg>`;
const KIND_NAME = { ellipse: "楕円", rect: "四角", note: "注釈", text: "文字", gate: "論理ゲート", edge: "矢印・線" };

function underlayHTML() {
  const u = S.doc.underlay;
  if (!u || !u.src) return "";
  return `<div class="sec"><h4>下絵</h4>
    <div class="grid2"><button class="btn" id="u_vis">${u.visible === false ? "表示する" : "隠す"}</button>
    <button class="btn${S.underEdit ? " on" : ""}" id="u_edit" title="下絵をドラッグで動かし、右下の角で大きさを変えます">${S.underEdit ? "✓ 調整を終える" : "位置・大きさ"}</button></div>
    <div style="margin-top:8px" class="row"><span style="font-size:12px;color:var(--muted)">濃さ</span>
    <input type="range" class="slider" id="u_op" min="0.05" max="1" step="0.05" value="${u.opacity ?? 0.4}"></div>
    <button class="btn wide danger" id="u_del" style="margin-top:8px">下絵を外す</button></div>`;
}
function sideHTML(items) {
  if (!items.length) return underlayHTML() + `<div class="empty">
    <b>使い方</b><br>
    ① 左から道具を選んで、画面をクリック<br>
    ② 線は図形から図形へドラッグ<br>
    ③ 図形や線を選ぶと、ここで設定できます<br><br>
    <b>便利な操作</b><br>
    ダブルクリック … 文字を編集<br>
    <span class="kbd">⌘</span>+<span class="kbd">Z</span> 戻す ・ <span class="kbd">⌘</span>+<span class="kbd">D</span> 複製<br>
    <span class="kbd">Delete</span> 削除 ・ 矢印キー 少し動かす<br>
    <span class="kbd">スペース</span>+ドラッグ 画面を動かす<br>
    <span class="kbd">⌘</span>+スクロール / ピンチ 拡大縮小<br>
    <span class="kbd">Shift</span>+クリック 複数を選ぶ<br><br>
    <b>数式</b><br>
    文字の中の <code>$...$</code> は数式になります。<br>
    例:<code>$\\alpha$</code>、<code>$x_1$</code>、<code>$10^{-3}$</code><br>
    くわしくは上の「数式の書き方」</div>`;
  const one = items[0], shapesSel = items.filter(isShape), edgesSel = items.filter(i => !isShape(i));
  const same = k => items.every(i => i[k] === one[k]) ? one[k] : "";
  const kinds = [...new Set(items.map(i => i.type))].map(t => KIND_NAME[t]).join("・");
  let h = `<div class="sec"><h4>${items.length === 1 ? kinds : `${items.length} 個を選択中(${kinds})`}</h4>`;
  if (items.length === 1) h += `<button class="btn wide" id="p_text">✏️ 文字を編集</button>`;
  h += `</div>`;
  h += `<div class="sec"><h4>文字の大きさ</h4><div class="stepper"><button id="fs_minus">−</button><input type="number" id="p_fs" min="6" max="96" value="${same("fontSize")}"><button id="fs_plus">＋</button></div></div>`;
  h += `<div class="sec"><h4>線の太さ</h4>${seg("lw", [[1, "細"], [1.5, "標準"], [2, "太"], [3, "極太"]], same("lw"))}</div>`;
  h += `<div class="sec"><h4>線の種類</h4>${seg("dash", [["0", sicon("solid"), "実線"], ["1", sicon("dash"), "点線"]], items.every(i => i.dash) ? "1" : items.every(i => !i.dash) ? "0" : "")}</div>`;
  if (shapesSel.length) {
    h += `<div class="sec"><h4>塗り</h4>${seg("fill", [["#ffffff", "白でぬる"], ["none", "なし(透明)"]], shapesSel.every(i => i.fill === "none") ? "none" : shapesSel.every(i => i.fill !== "none") ? "#ffffff" : "")}</div>`;
    if (shapesSel.length === 1 && one.type === "gate")
      h += `<div class="sec"><h4>ゲートの種類</h4><select id="p_gate" style="width:100%">${Object.entries(GATE_NAMES).map(([v, l]) => `<option value="${v}" ${v === one.kind ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
  }
  if (edgesSel.length) {
    const arrows = edgesSel.every(e => e.arrow === edgesSel[0].arrow) ? edgesSel[0].arrow : "";
    h += `<div class="sec"><h4>矢印</h4>${seg("arrow", [["none", sicon("arrowNone"), "矢印なし"], ["end", sicon("arrowEnd"), "終点に矢印"], ["both", sicon("arrowBoth"), "両端に矢印"]], arrows)}</div>`;
    if (edgesSel.length === 1) {
      h += `<div class="sec"><h4>線の形</h4>${seg("style", [["straight", sicon("straight"), "直線"], ["curve", sicon("curve"), "曲線"], ["elbow", sicon("elbow"), "直角"]], one.style)}</div>`;
      h += `<div class="sec grid2"><button class="btn" id="p_reverse" title="矢印の向きを反対にします">⇄ 向きを反転</button>`
         + (one.style === "curve" ? `<button class="btn" id="p_curvereset" title="曲がり方を最初の形に戻します">↺ 曲がりを戻す</button>` : `<span></span>`) + `</div>`;
    }
  }
  if (shapesSel.length >= 2) {
    h += `<div class="sec"><h4>整列</h4><div class="grid3">
      ${["left", "hcenter", "right", "top", "vcenter", "bottom"].map(k => `<button class="btn" data-align="${k}" title="${{ left: "左をそろえる", hcenter: "左右の中心をそろえる", right: "右をそろえる", top: "上をそろえる", vcenter: "上下の中心をそろえる", bottom: "下をそろえる" }[k]}">${aicon(k)}</button>`).join("")}
      </div>` + (shapesSel.length >= 3 ? `<div class="grid2" style="margin-top:6px">
      <button class="btn" data-align="hdist" title="横に等間隔で並べる">${aicon("hdist")} 横に等間隔</button>
      <button class="btn" data-align="vdist" title="縦に等間隔で並べる">${aicon("vdist")} 縦に等間隔</button></div>` : "") + `</div>`;
  }
  if (shapesSel.length) {
    h += `<div class="sec"><h4>配置</h4><div class="grid2">
      <button class="btn" id="p_front" title="いちばん前に出す">前面へ</button><button class="btn" id="p_back" title="いちばん後ろに下げる">背面へ</button></div>
      <button class="btn wide" id="p_snap" style="margin-top:6px" title="位置と大きさをグリッドに合わせます">グリッドに合わせる</button></div>`;
  }
  h += `<div class="sec"><button class="btn wide danger" id="p_delete">削除</button></div>`;
  return h;
}
function alignShapes(mode) {
  const sh = selItems().filter(isShape);
  if (sh.length < 2) return;
  pushHist();
  const L = Math.min(...sh.map(s => s.x)), R = Math.max(...sh.map(s => s.x + s.w));
  const T = Math.min(...sh.map(s => s.y)), B = Math.max(...sh.map(s => s.y + s.h));
  if (mode === "left") sh.forEach(s => s.x = L);
  if (mode === "right") sh.forEach(s => s.x = R - s.w);
  if (mode === "hcenter") { const c = (L + R) / 2; sh.forEach(s => s.x = c - s.w / 2); }
  if (mode === "top") sh.forEach(s => s.y = T);
  if (mode === "bottom") sh.forEach(s => s.y = B - s.h);
  if (mode === "vcenter") { const c = (T + B) / 2; sh.forEach(s => s.y = c - s.h / 2); }
  if (mode === "hdist" || mode === "vdist") {        // 中心どうしの間隔をそろえる
    const k = mode === "hdist" ? "x" : "y", sz = mode === "hdist" ? "w" : "h";
    const sorted = sh.slice().sort((a, b) => (a[k] + a[sz] / 2) - (b[k] + b[sz] / 2));
    const c0 = sorted[0][k] + sorted[0][sz] / 2, c1 = sorted[sorted.length - 1][k] + sorted[sorted.length - 1][sz] / 2;
    sorted.forEach((s, i) => s[k] = c0 + (c1 - c0) * i / (sorted.length - 1) - s[sz] / 2);
  }
  commit();
}
function bindSide() {
  const items = selItems();
  const u = S.doc.underlay;
  if ($("u_vis")) $("u_vis").onclick = () => { pushHist(); u.visible = u.visible === false; S.underEdit = false; lastPropsKey = ""; commit(); };
  if ($("u_edit")) $("u_edit").onclick = () => { S.underEdit = !S.underEdit; S.sel = []; lastPropsKey = ""; render(); updateCursor(); };
  if ($("u_op")) $("u_op").oninput = e => { u.opacity = +e.target.value; render(); push(); };
  if ($("u_del")) $("u_del").onclick = () => { pushHist(); delete S.doc.underlay; S.underEdit = false; lastPropsKey = ""; commit(); };
  const set = fn => { pushHist(); items.forEach(fn); commit(); };
  const on = (id, ev, fn) => { const n = $(id); if (n) n.addEventListener(ev, fn); };
  document.querySelectorAll("#side .seg").forEach(sg => sg.querySelectorAll("button").forEach(b => b.onclick = () => {
    const k = sg.dataset.key, v = b.dataset.v;
    if (k === "lw") set(i => i.lw = +v);
    else if (k === "dash") set(i => i.dash = v === "1");
    else if (k === "fill") set(i => { if (isShape(i)) i.fill = v; });
    else if (k === "arrow") set(i => { if (!isShape(i)) i.arrow = v; });
    else if (k === "style") set(i => {
      if (isShape(i) || i.style === v) return;
      i.style = v;
      if (v === "curve" && i.bend == null) i.bend = 40;
      if (v !== "curve") { delete i.mx; delete i.my; delete i.c1; delete i.c2; }
      if (v === "elbow") { const a = refPt(i.from), b2 = refPt(i.to); i.points = Math.abs(a.x - b2.x) > 1 && Math.abs(a.y - b2.y) > 1 ? [{ x: b2.x, y: a.y }] : []; }
      else delete i.points;
    });
  }));
  const fs = d => { const v = Math.max(6, Math.min(96, (+$("p_fs").value || one(items).fontSize || 18) + d)); set(i => i.fontSize = v); };
  on("fs_minus", "click", () => fs(-2)); on("fs_plus", "click", () => fs(2));
  on("p_fs", "change", e => { const v = +e.target.value; if (v >= 6) set(i => i.fontSize = v); });
  on("p_text", "click", () => openEditor(items[0]));
  on("p_gate", "change", e => set(i => { i.kind = e.target.value; }));
  on("p_curvereset", "click", () => set(i => { delete i.mx; delete i.my; delete i.c1; delete i.c2; i.bend = 40; }));
  on("p_reverse", "click", () => set(i => {
    if (isShape(i)) return;
    if (i.c1 && i.c2) [i.c1, i.c2] = [i.c2, i.c1];
    else if (i.style === "curve" && i.mx == null) { const g = edgeGeom(i); i.mx = g.mid.x - g.cm.x; i.my = g.mid.y - g.cm.y; }  // 形を保つ
    [i.from, i.to] = [i.to, i.from];
    if (i.points) i.points = i.points.slice().reverse();
  }));
  on("p_snap", "click", () => set(i => {
    if (!isShape(i)) return;
    const g = S.doc.grid, x1 = Math.round((i.x + i.w) / g) * g, y1 = Math.round((i.y + i.h) / g) * g;
    i.x = Math.round(i.x / g) * g; i.y = Math.round(i.y / g) * g;
    i.w = Math.max(g, x1 - i.x); i.h = Math.max(g, y1 - i.y);
  }));
  on("p_front", "click", () => set(i => { S.doc.items = S.doc.items.filter(x => x !== i); S.doc.items.push(i); }));
  on("p_back", "click", () => set(i => { S.doc.items = S.doc.items.filter(x => x !== i); S.doc.items.unshift(i); }));
  on("p_delete", "click", delSel);
  document.querySelectorAll("#side [data-align]").forEach(b => b.onclick = () => alignShapes(b.dataset.align));
}
const one = items => items[0] || {};
let lastPropsKey = "";
function updateUI() {
  document.querySelectorAll("#palette .tool").forEach(b => b.classList.toggle("on",
    b.dataset.tool === S.tool && (S.tool !== "gate" || b.dataset.gate === S.gateKind)));
  $("g_show").checked = S.doc.showGrid; $("g_snap").checked = S.doc.snap; $("g_size").value = String(S.doc.grid);
  $("b_undo").disabled = !S.hist.length; $("b_redo").disabled = !S.fut.length;
  $("b_dup").disabled = $("b_del").disabled = !S.sel.length;
  $("zpct").textContent = Math.round(S.zoom * 100) + "%";
  const key = JSON.stringify(selItems()) + "|" + (S.doc.underlay ? [S.doc.underlay.visible, !!S.underEdit].join() : "");
  if (key !== lastPropsKey && !S.drag) { lastPropsKey = key; $("side").innerHTML = sideHTML(selItems()); bindSide(); }
  const t = TOOLS.find(t => t[0] === S.tool) || TOOLS[0];
  const name = S.tool === "gate" ? GATE_NAMES[S.gateKind || "and"] : TOOL_LABEL[S.tool];
  if (S.underEdit) { $("hint").innerHTML = `<b style="color:var(--ink)">下絵の調整</b> ・ 下絵をドラッグで移動、右下の角で拡大縮小。終わったら右の「✓ 調整を終える」`; return; }
  if (S.mathErr.length) {
    const er = S.mathErr[0], esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    $("hint").innerHTML = `<b style="color:var(--danger)">⚠ 数式を読めませんでした</b> ・ <code>$${esc(er.tex)}$</code>(${esc(er.msg)})。そのままの文字で表示しています。`;
    return;
  }
  $("hint").innerHTML = `<b style="color:var(--ink)">${name}</b> ・ ` + (S.draft ? "曲がる所をクリック → 終点の図形をクリック(何もない所で終えるならダブルクリック、やめるなら Esc)" : t[3]);
}

// ------------------------------------------------------------------ カーソルの見た目
let curCursor = "";
function setCursor(c) { if (c !== curCursor) { curCursor = c; svg.style.cursor = c; } }
const RESIZE = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
function updateCursor(ev) {
  const d = S.drag;
  if (d) {
    if (d.kind === "pan") return setCursor("grabbing");
    if (d.kind === "move") return setCursor("move");
    if (d.kind === "handle") return setCursor(RESIZE[d.h.k] || (d.h.k === "label" ? "move" : "grabbing"));
    return setCursor("crosshair");
  }
  if (S.space) return setCursor("grab");
  if (S.underEdit) return setCursor("move");
  if (ev && (ev.metaKey || ev.ctrlKey)) return setCursor(ev.altKey ? "zoom-out" : "zoom-in");
  if (S.tool !== "select") return setCursor("crosshair");
  const p = S.mouse, h = handleAt(p);
  if (h) return setCursor(RESIZE[h.k] || (h.k === "label" ? "move" : "grab"));
  setCursor(hitTest(p) ? "move" : "default");
}

// ------------------------------------------------------------------ 拡大・縮小
const wrap = $("wrap");
function setZoom(z, cx, cy) {     // (cx, cy) は画面上で動かさない点(省略すると表示の真ん中)
  closeEditor(true);
  const r = wrap.getBoundingClientRect();
  if (cx == null) { cx = r.left + wrap.clientWidth / 2; cy = r.top + wrap.clientHeight / 2; }
  const ox = cx - r.left, oy = cy - r.top;
  const docX = (wrap.scrollLeft + ox) / S.zoom, docY = (wrap.scrollTop + oy) / S.zoom;
  S.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
  try { localStorage.setItem("diagram_zoom", S.zoom); } catch (e) {}
  render();
  wrap.scrollLeft = docX * S.zoom - ox; wrap.scrollTop = docY * S.zoom - oy;
}
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const zoomStep = dir => setZoom(dir > 0 ? (STEPS.find(v => v > S.zoom + 1e-6) ?? 4) : ([...STEPS].reverse().find(v => v < S.zoom - 1e-6) ?? 0.25));
function zoomFit() {
  const pts = [];
  for (const p of buildPrims()) {
    if (p.k === "ellipse") pts.push({ x: p.cx - p.rx, y: p.cy - p.ry }, { x: p.cx + p.rx, y: p.cy + p.ry });
    else if (p.k === "rect") pts.push({ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h });
    else if (p.k === "path") pts.push(...samplePts(p.cmds));
    else if (p.k === "text") { const b = layout(p.s, p.size, p.ha, p.va).box; pts.push({ x: p.x + b.x, y: p.y + b.y }, { x: p.x + b.x + b.w, y: p.y + b.y + b.h }); }
  }
  const u = S.doc.underlay;
  if (u && u.src && u.visible !== false) pts.push({ x: u.x, y: u.y }, { x: u.x + u.w, y: u.y + u.h });
  if (!pts.length) { setZoom(1); wrap.scrollLeft = wrap.scrollTop = 0; return; }
  const x0 = Math.min(...pts.map(p => p.x)) - 30, x1 = Math.max(...pts.map(p => p.x)) + 30;
  const y0 = Math.min(...pts.map(p => p.y)) - 30, y1 = Math.max(...pts.map(p => p.y)) + 30;
  S.zoom = Math.min(4, Math.max(0.25, Math.floor(Math.min(wrap.clientWidth / (x1 - x0), wrap.clientHeight / (y1 - y0)) * 100) / 100));
  try { localStorage.setItem("diagram_zoom", S.zoom); } catch (e) {}
  render();
  wrap.scrollLeft = x0 * S.zoom; wrap.scrollTop = y0 * S.zoom;
}
$("z_in").onclick = () => zoomStep(1);
$("z_out").onclick = () => zoomStep(-1);
$("z_reset").onclick = () => setZoom(1);
$("z_fit").onclick = zoomFit;
// ⌘ + スクロール / ピンチ で拡大・縮小(サイト全体ではなく、この画面だけ)
wrap.addEventListener("wheel", ev => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  setCursor(ev.deltaY < 0 ? "zoom-in" : "zoom-out");
  setZoom(S.zoom * Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
}, { passive: false });
let gestZoom = 1;   // Safari のピンチ
wrap.addEventListener("gesturestart", ev => { ev.preventDefault(); gestZoom = S.zoom; });
wrap.addEventListener("gesturechange", ev => { ev.preventDefault(); setZoom(gestZoom * ev.scale, ev.clientX, ev.clientY); });

// ------------------------------------------------------------------ 下絵
function loadImage(file) {   // 長い辺を 1568px までに縮めた JPEG にする(保存する図が重くなりすぎないように)
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1568 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve({ src: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
      };
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function placeUnderlay(im) {      // 画面に収まる大きさで左上に置く
  const k = Math.min(1400 / im.w, 900 / im.h, 1.5);
  S.doc.underlay = { src: im.src, x: 40, y: 40, w: im.w * k, h: im.h * k, opacity: 0.4, visible: true };
}
$("b_under").onclick = () => $("f_under").click();
$("f_under").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const im = await loadImage(f);
  pushHist(); placeUnderlay(im); S.sel = []; commit(); zoomFit();
};
// ------------------------------------------------------------------ 呼び出し側とのやりとり
let onChange = () => {};
let pushTimer = null;
function push(now) {          // 変わったことを知らせる(続けて変わるときは、まとめて 1 回)
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; onChange(S.doc); }, now ? 0 : 350);
}
// 知らせるのを待っている変更があれば、すぐに知らせる(画面を閉じる前など)
export function flushChanges() {
  if (S.editing != null) closeEditor(true);
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; onChange(S.doc); }
}
const clone = o => JSON.parse(JSON.stringify(o));

export function initEditor(opts = {}) {
  onChange = opts.onChange || onChange;
  S.mathErr = [];
  buildToolbar();
  render();
  onTextReady(() => { lastPropsKey = ""; render(); });   // フォント・数式の準備ができたら描き直す
  loadFont();
}
// 別の図を開く(戻す・やり直すの履歴は消える)
export function loadDoc(doc) {
  clearTimeout(pushTimer);
  if (S.editing != null) closeEditor(false);
  S.doc = doc ? clone(doc) : newDoc();
  fixDoc();
  Object.assign(S, { sel: [], hist: [], fut: [], draft: null, drag: null, underEdit: false });
  lastPropsKey = "";
  render();
  $("wrap").scrollLeft = $("wrap").scrollTop = 0;
}
// 一時保存から戻すとき:今の図と入れ替える(⌘Z で入れ替える前に戻れる)
export function replaceDoc(doc) {
  closeEditor(true);
  pushHist();
  S.doc = clone(doc);
  fixDoc();
  S.sel = []; S.draft = null; lastPropsKey = "";
  commit();
}
export const getDoc = () => S.doc;
export const getPrims = () => buildPrims();
export { zoomFit };
