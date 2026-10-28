import { snapToGuides } from "./snap.mjs";
import { isWire, migrateWireTypes } from "./wiretypes.mjs";
import { remapStyles } from "./textstyles.mjs";
// 図の作成エディタ(ブラウザ版)
// 楕円・四角・注釈・文字と、直線/曲線/直角の矢印、論理ゲート・配線・接続点をマウスで置く。
// 手元版(Streamlit のカスタムコンポーネント)の描画・操作をそのまま使い、
// 変更のたびに onChange(doc) で知らせる(保存は呼び出し側が IndexedDB に行う)。
// 文字は text.js で並べる($...$ は MathJax の数式になる)。

import { layout, textMarkup, onTextReady, loadFont } from "../text.js";

// ------------------------------------------------------------------ 状態
const TOOLS = [
  ["select", "↖ 選択", "V", "クリックで選択、ドラッグで移動。空いた所をドラッグすると範囲で選択。ダブルクリックで文字を編集。"],
  ["ellipse", "◯ 楕円", "E", "クリックで置く(ドラッグで大きさを決める)。状態遷移図の「状態」に。"],
  ["rect", "▭ 四角", "R", "クリックで置く(ドラッグで大きさを決める)。ブロック図の「ブロック」に。"],
  ["trap", "⏢ 台形", "Z", "クリックで置く(ドラッグで大きさを決める)。右の欄で、短い辺の向きと長さを変えられます。"],
  ["poly", "⬡ 多角形", "P", "クリックで置く(ドラッグで大きさを決める)。右の欄で角の数(3〜12)を変えられます。3 で三角形、4 でひし形。"],
  ["note", "▤ 注釈", "N", "説明を書く枠。クリックで置き、「直線」ツールで指し示す線を引けます。"],
  ["text", "A 文字", "T", "枠のない文字。クリックで置く。"],
  ["dot", "● 接続点", "", "配線が分かれる所に置く黒い点。クリックした所のグリッドの点に置きます。点から線を引いたり、線の端を点につないだりできます。"],
  ["gate", "", "G", "クリックで論理ゲートを置く。入力は左の辺、出力は右の辺につなぎます(線の端がグリッドの点に合います)。"],
  ["straight", "→ 直線", "L", "図形から図形へドラッグ。同じ図形の上で離すと自分に戻る矢印(ループ)になります。"],
  ["curve", "⤻ 曲線", "C", "図形から図形へドラッグ。選ぶと出る真ん中の ● で全体のふくらみ、◇ でその側の曲がり方を変えられます(両端は動きません)。両端の ○ は図形から離して置くこともできます。同じ図形の上で離すと、自分に戻る矢印になります。"],
  ["wire", "⌐ 配線", "K", "端子・接続点・配線の途中をクリック → 行き先をクリックすると、縦横の線が自動で引かれます。何もない所をクリックすると、そこを通ります。配線の途中で始めたり終えたりすると、● ができて分岐します。"],
  ["elbow", "┘ 直角", "W", "始点をクリック → 曲がる所をクリック → 終点の図形をクリック(何もない所で終えるならダブルクリック)。線は縦か横だけになります。"],
];
const DEF = {
  ellipse: { w: 160, h: 80, text: "状態", fontSize: 22, lw: 1.5, fill: "#ffffff" },
  rect:    { w: 160, h: 80, text: "ブロック", fontSize: 22, lw: 2, fill: "#ffffff" },
  trap:    { w: 160, h: 80, text: "", fontSize: 22, lw: 2, fill: "#ffffff", trapDir: "top", inset: 0.2 },
  poly:    { w: 120, h: 120, text: "", fontSize: 22, lw: 2, fill: "#ffffff", sides: 6 },
  note:    { w: 240, h: 80, text: "注釈", fontSize: 18, lw: 1, fill: "#ffffff" },
  text:    { w: 120, h: 40, text: "文字", fontSize: 18, lw: 1, fill: "none" },
  gate:    { w: 120, h: 80, text: "", fontSize: 16, lw: 2, fill: "#ffffff" },
  dot:     { w: 10, h: 10, text: "", fontSize: 12, lw: 1, fill: "#000000" },
};
const W = 1600, H = 1000;

const S = {
  doc: newDoc(), sel: [], tool: "select", hist: [], fut: [],
  drag: null, draft: null, guides: [], editing: null, clip: null, mouse: { x: 0, y: 0 }, zoom: 1,
};
try { S.zoom = Math.min(4, Math.max(0.25, +localStorage.getItem("diagram_zoom") || 1)); } catch (e) {}
const px = v => v / S.zoom;   // 画面上で同じ大きさに見えるように(つまみ・当たり判定など)
function newDoc() { return { grid: 20, snap: true, snapEdge: true, showGrid: true, W, H, items: [], nextId: 1 }; }
const LINE_LW = 1.5;   // 新しく作る線の標準の太さ
function fixDoc() {
  const d = S.doc;
  d.W = d.W || W; d.H = d.H || H; d.grid = d.grid || 20;
  if (d.snap === undefined) d.snap = true;
  if (d.snapEdge === undefined) d.snapEdge = true;
  if (d.showGrid === undefined) d.showGrid = true;
  d.items = d.items || [];
  migrateWireTypes(d.items);
  d.nextId = Math.max(d.nextId || 1, ...d.items.map(i => i.id + 1), 1);
  // 前の形の D-FF(端子が高さの 3/8・5/8)を、小さい形(1/3・2/3、80×120)にする。真ん中の位置は保つ
  for (const s of d.items) {
    if (s.type !== "gate" || s.kind !== "dff" || s.dffv === 2) continue;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    s.w = 80; s.h = 120; s.x = Math.round((cx - 40) / 20) * 20; s.y = Math.round((cy - 60) / 20) * 20; s.dffv = 2;
    for (const e of d.items) {
      if (e.type !== "edge") continue;
      for (const k of ["from", "to"]) {
        const end = e[k];
        if (end.id !== s.id || end.ax == null) continue;
        if (Math.abs(end.ay - 0.375) < 1e-6) end.ay = 1 / 3;
        if (Math.abs(end.ay - 0.625) < 1e-6) end.ay = 2 / 3;
      }
    }
  }
  // 前の形(足を増やすと記号が縦にのびた)のゲートを、記号の大きさは元のままで足だけ増えた形にする
  for (const s of d.items) {
    if (s.type !== "gate" || !(s.nin > 2) || s.ninv === 2) continue;
    const n = s.nin, u = s.h / (2 * n), cy = s.y + s.h / 2;   // 前の形では入力 1 本あたり 2 目盛り
    const offs = gateInOffs(n), units = Math.max(4, 2 * Math.max(...offs.map(Math.abs)) + 1);
    s.h = units * u; s.y = cy - s.h / 2; s.ninv = 2;
    for (const e of d.items) {
      if (e.type !== "edge") continue;
      for (const k of ["from", "to"]) {
        const end = e[k];
        if (end.id !== s.id || end.ax !== 0) continue;
        const idx = Math.max(0, Math.min(n - 1, Math.round(end.ay * n - 0.5)));
        end.ay = 0.5 + offs[idx] / units;   // 上から何本目かは変えない
      }
    }
  }
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

// 台形・多角形の頂点(図形の枠いっぱいに広げる)
const isPoly = s => s.type === "trap" || s.type === "poly";
function shapePoly(s) {
  const { x, y, w, h } = s;
  if (s.type === "trap") {
    const k = Math.min(0.45, Math.max(0, s.inset ?? 0.2)), dx = w * k, dy = h * k;
    switch (s.trapDir) {
      case "bottom": return [{ x, y }, { x: x + w, y }, { x: x + w - dx, y: y + h }, { x: x + dx, y: y + h }];
      case "left":   return [{ x, y: y + dy }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h - dy }];
      case "right":  return [{ x, y }, { x: x + w, y: y + dy }, { x: x + w, y: y + h - dy }, { x, y: y + h }];
      default:       return [{ x: x + dx, y }, { x: x + w - dx, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    }
  }
  const n = Math.max(3, Math.min(12, s.sides || 6));
  const raw = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return { x: Math.cos(a), y: Math.sin(a) }; });
  const x0 = Math.min(...raw.map(p => p.x)), x1 = Math.max(...raw.map(p => p.x)), y0 = Math.min(...raw.map(p => p.y)), y1 = Math.max(...raw.map(p => p.y));
  return raw.map(p => ({ x: x + (p.x - x0) / (x1 - x0) * w, y: y + (p.y - y0) / (y1 - y0) * h }));
}
function segHit(a, b, c, d) {   // 線分 a→b と c→d が交わる所の、a→b での割合 t(交わらなければ null)
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
function inPoly(p, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
function nearestOnPoly(p, pts) {   // 輪郭の上で p にいちばん近い点
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)), q = { x: a.x + vx * t, y: a.y + vy * t, a, b, t };
    const d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
function boundary(s, t) { // 図形 s の輪郭上で、中心から t の方向にある点
  const c = ctr(s), dx = t.x - c.x, dy = t.y - c.y, rx = s.w / 2, ry = s.h / 2;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: c.x, y: c.y - ry };
  let k;
  if (s.type === "ellipse" || s.type === "dot") k = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  else if (isPoly(s)) {   // 中心から遠くへ伸ばした線が輪郭に当たる所
    const pts = shapePoly(s), L = (s.w + s.h) / Math.hypot(dx, dy), far = { x: c.x + dx * L, y: c.y + dy * L };
    let tb = 1;
    for (let i = 0; i < pts.length; i++) { const t2 = segHit(c, far, pts[i], pts[(i + 1) % pts.length]); if (t2 != null && t2 < tb) tb = t2; }
    return { x: c.x + (far.x - c.x) * tb, y: c.y + (far.y - c.y) * tb };
  }
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
  if (s.type === "ellipse" || s.type === "dot") {
    const c = ctr(s), rx = s.w / 2, ry = s.h / 2, ox = (from.x - c.x) / rx, oy = (from.y - c.y) / ry, vx = dx / rx, vy = dy / ry;
    const A = vx * vx + vy * vy, B = 2 * (ox * vx + oy * vy), C = ox * ox + oy * oy - 1, D = B * B - 4 * A * C;
    if (C <= 0 || A < 1e-9 || D < 0) return null;            // 始まりが図形の中なら何もしない
    t = (-B - Math.sqrt(D)) / (2 * A);
  } else if (isPoly(s)) {
    const pts = shapePoly(s);
    if (inPoly(from, pts)) return null;
    for (let i = 0; i < pts.length; i++) { const t2 = segHit(from, to, pts[i], pts[(i + 1) % pts.length]); if (t2 != null && (t == null || t2 < t)) t = t2; }
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
  if (s.type === "dot") return ctr(s);   // 接続点・曲がり角では、線を点の中心まで伸ばす(すき間を作らない)
  if (s.type === "gate" && end.ax != null) return { x: s.x + end.ax * s.w, y: s.y + end.ay * s.h };   // 端子はその位置そのもの
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
    if (s.type === "dot") {           // 小さいので、少し広めに当たりをとる
      if (dist(p, ctr(s)) <= Math.max(s.w / 2, px(7))) return s;
    } else if (s.type === "ellipse") {
      const c = ctr(s);
      if (((p.x - c.x) / (s.w / 2)) ** 2 + ((p.y - c.y) / (s.h / 2)) ** 2 <= 1) return s;
    } else if (isPoly(s)) {
      if (inPoly(p, shapePoly(s))) return s;
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
  if (!S.doc.snapEdge) return snapP(p);
  const s = nearShape(p, exclude);
  if (!s) return snapP(p);
  if (s.type === "dot") return { id: s.id, ax: 0.5, ay: 0.5 };
  if (s.type === "gate") {        // 論理ゲートは、いちばん近い端子につなぐ
    const pin = gatePins(s).reduce((a, b) => dist(p, { x: s.x + a.ax * s.w, y: s.y + a.ay * s.h }) <= dist(p, { x: s.x + b.ax * s.w, y: s.y + b.ay * s.h }) ? a : b);
    return { id: s.id, ...pin };
  }
  if (s.type === "ellipse") {
    // 輪郭の近く → 輪郭の上のその位置に固定(角度は 15° きざみ)。真ん中の方 → 向きに合わせて自動
    const b = boundary(s, p);
    if (shapeAt(p) === s && dist(p, b) > px(EDGE_BAND + 4)) return { id: s.id };
    const c = ctr(s);
    let a = Math.atan2((b.y - c.y) / (s.h / 2), (b.x - c.x) / (s.w / 2));
    if (S.doc.snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    return { id: s.id, ang: a };
  }
  if (isPoly(s)) {   // 真ん中の方 → 向きに合わせて自動。輪郭の近く → いちばん近い所(角・辺の真ん中に近ければそこ)
    const q = nearestOnPoly(p, shapePoly(s));
    if (shapeAt(p) === s && dist(p, q) > px(EDGE_BAND + 4)) return { id: s.id };
    let at = q;
    for (const k of [0, 1, 0.5]) { const r = { x: q.a.x + (q.b.x - q.a.x) * k, y: q.a.y + (q.b.y - q.a.y) * k }; if (dist(r, q) < px(10)) { at = r; break; } }
    return { id: s.id, ax: (at.x - s.x) / s.w, ay: (at.y - s.y) / s.h };
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
  const b = layout(e.label, e.fontSize, "center", "center", "gothic", e.textStyles).box;
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
  if (s.type === "dot") return { id: s.id, ax: 0.5, ay: 0.5 };
  if (s.type === "gate") {        // 論理ゲートは、いちばん近い端子につなぐ
    const pin = gatePins(s).reduce((p, q) => dist(b, { x: s.x + p.ax * s.w, y: s.y + p.ay * s.h }) <= dist(b, { x: s.x + q.ax * s.w, y: s.y + q.ay * s.h }) ? p : q);
    return { id: s.id, ...pin };
  }
  if (isPoly(s)) return { id: s.id, ax: (b.x - s.x) / s.w, ay: (b.y - s.y) / s.h };
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
// 矢印の先っぽ。head が "fill" なら塗った三角、それ以外は開いた形(線 2 本)
function headCmds(tip, from, lw, head) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), sp = head === "fill" ? 0.36 : 0.42, L = 9 + lw * 3;
  const c = [["M", tip.x - L * Math.cos(a - sp), tip.y - L * Math.sin(a - sp)], ["L", tip.x, tip.y],
             ["L", tip.x - L * Math.cos(a + sp), tip.y - L * Math.sin(a + sp)]];
  return head === "fill" ? [...c, ["Z"]] : c;
}
// 新しく引く矢印は、最後に選んだ矢じりの形にする
const lastHead = () => { try { return localStorage.getItem("diagram_head") === "fill" ? { head: "fill" } : {}; } catch (e) { return {}; } };
const headPrim = (e, tip, from) => ({ k: "path", cmds: headCmds(tip, from, e.lw, e.head), lw: e.lw, fill: e.head === "fill" ? "#000000" : null });

// ------------------------------------------------------------------ 論理ゲートの形
// 右向き。入力は左の辺(2 入力なら高さの 1/4 と 3/4、1 入力なら真ん中)、出力は右の辺の真ん中。
const GATE_NAMES = { and: "AND", or: "OR", not: "NOT", nand: "NAND", nor: "NOR", xor: "XOR", xnor: "XNOR", buf: "バッファ", dff: "D-FF" };
// D フリップフロップの端子(図形の左上からの割合):左 d・clock、右 q、上 set、下 reset
// 高さを 3 等分した所に d・q と clock を置く(標準 80×120 = グリッド 4×6 マスで、端子がすべてグリッドに乗る)
const DFF_PINS = [{ ax: 0, ay: 1 / 3, name: "d" }, { ax: 0, ay: 2 / 3, name: "clock" }, { ax: 1, ay: 1 / 3, name: "q" },
                  { ax: 0.5, ay: 0, name: "set" }, { ax: 0.5, ay: 1, name: "reset" }];
// 入力の数(NOT・バッファは 1、AND などは s.nin 本。決めていなければ 2)
const gateIns = s => ["not", "buf"].includes(s.kind) ? 1 : Math.max(2, s.nin || 2);
const multiIn = s => !["not", "buf", "dff"].includes(s.kind);
// 入力の位置:出力(真ん中)から上下に何目盛りか。目盛り u は記号の高さの 1/4(標準でグリッド 1 マス)
// 奇数本は真ん中から、偶数本は真ん中をあけて 1 目盛りずつ並べる(2 本なら ±1 → 今までと同じ 1/4・3/4)
function gateInOffs(n) {
  const out = [];
  if (n % 2) for (let k = -(n - 1) / 2; k <= (n - 1) / 2; k++) out.push(k);
  else for (let k = -n / 2; k <= n / 2; k++) if (k) out.push(k);
  return out;
}
// 図形の高さが目盛り何個分か。記号の本体は 4 目盛りのまま。足が本体の外まで出るときだけ、その分だけ図形の枠を広げる
const gateUnits = s => { const m = Math.max(...gateInOffs(gateIns(s)).map(Math.abs)); return Math.max(4, 2 * m + 1); };
// 入力端子の高さ(割合)
const gateInYs = s => multiIn(s) ? gateInOffs(gateIns(s)).map(k => 0.5 + k / gateUnits(s)) : [0.5];
function gatePins(s) {   // 端子の位置(図形の左上からの割合)。入力は左の辺、出力は右の辺
  if (s.kind === "dff") return DFF_PINS.map(({ ax, ay }) => ({ ax, ay }));
  return [...gateInYs(s).map(v => ({ ax: 0, ay: v })), { ax: 1, ay: 0.5 }];
}
// 入力の数を n にする。記号の大きさと出力の位置はそのままで、足だけが増減する。
// つないである線は同じ高さの足があればそのまま、なければ近い空いた足へ、それもなければその場所に端を残す
function setGateInputs(s, n) {
  if (n === gateIns(s) || !multiIn(s)) return;
  const u = s.h / gateUnits(s), cy = s.y + s.h / 2;
  const attached = [];
  for (const e of edges()) for (const k of ["from", "to"])
    if (e[k].id === s.id && e[k].ax === 0) attached.push({ e, k, y: s.y + e[k].ay * s.h });
  s.nin = n; s.ninv = 2;
  s.h = gateUnits(s) * u; s.y = cy - s.h / 2;
  const free = gateInOffs(n).map(k => cy + k * u);
  attached.sort((a, b) => Math.abs(a.y - cy) - Math.abs(b.y - cy));   // 真ん中に近い線から決める
  const same = attached.filter(a => free.some(y => Math.abs(y - a.y) < 0.5));
  for (const a of [...same, ...attached.filter(a => !same.includes(a))]) {
    if (!free.length) { a.e[a.k] = { x: Math.round(s.x), y: Math.round(a.y) }; a.e.wire = true; continue; }
    const y = free.reduce((p, q) => Math.abs(q - a.y) < Math.abs(p - a.y) ? q : p);
    free.splice(free.indexOf(y), 1);
    a.e[a.k] = { id: s.id, ax: 0, ay: (y - s.y) / s.h };
  }
}
// 端子がすべてグリッドの点に乗る大きさのきざみ(幅, 高さ)
function gateSizeStep(s) {
  const g = S.doc.grid;
  if (s.kind === "dff") return [2 * g, 3 * g];
  if (!multiIn(s)) return [g, 2 * g];
  return [g, gateUnits(s) * g];   // 目盛り 1 つがグリッドのマスの整数倍
}
function fitGate(s, anchor) {   // 大きさをきざみに合わせ、端子がグリッドに乗る位置に置く。anchor は動かさない角({x, y, right, bottom})
  const [sw, sh] = gateSizeStep(s);
  s.w = Math.max(sw, Math.round(s.w / sw) * sw);
  s.h = Math.max(sh, Math.round(s.h / sh) * sh);
  if (anchor) { s.x = anchor.right ? anchor.x - s.w : anchor.x; s.y = anchor.bottom ? anchor.y - s.h : anchor.y; }
  const g = S.doc.grid, off = gatePinOffset(s);
  s.x = Math.round(s.x / g) * g;
  s.y = Math.round((s.y + off) / g) * g - off;
}
const gatePinOffset = s => s.kind === "dff" ? 0 : Math.min(...gateInYs(s)) * s.h;   // 上から最初の端子までの距離(D-FF は上の set)
function dffPrims(s) {   // D フリップフロップ:箱、端子の線、clock の三角、set / reset の ○
  const { x, y, w, h, lw } = s, L = Math.min(20, w / 5, h / 6);   // 端子の線の長さ
  const bx0 = x + L, bx1 = x + w - L, by0 = y + L, by1 = y + h - L, cx = x + w / 2, r = Math.min(6, L / 2.5);
  const out = [{ k: "rect", x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, lw, fill: s.fill === "none" ? null : s.fill, dash: !!s.dash }];
  const line = (x1, y1, x2, y2) => out.push({ k: "path", cmds: [["M", x1, y1], ["L", x2, y2]], lw });
  const yd = y + h / 3, yc = y + 2 * h / 3;
  line(x, yd, bx0, yd);                       // d
  line(x, yc, bx0, yc);                       // clock
  const t = Math.min(10, (bx1 - bx0) / 5);    // clock の三角
  out.push({ k: "path", cmds: [["M", bx0, yc - t * 0.8], ["L", bx0 + t * 1.3, yc], ["L", bx0, yc + t * 0.8]], lw });
  line(bx1, yd, x + w, yd);                   // q
  out.push({ k: "ellipse", cx, cy: by0 - r, rx: r, ry: r, lw, fill: "#ffffff" });   // set の ○
  line(cx, y, cx, by0 - 2 * r);
  out.push({ k: "ellipse", cx, cy: by1 + r, rx: r, ry: r, lw, fill: "#ffffff" });   // reset の ○
  line(cx, by1 + 2 * r, cx, y + h);
  return out;
}
function gatePrims(s) {
  if (s.kind === "dff") return dffPrims(s);
  const k = s.kind || "and", x = s.x, w = s.w, cy = s.y + s.h / 2;
  // 記号の本体は 4 目盛りの高さで真ん中に置く(足を増やしても形は変わらない)
  const h = multiIn(s) ? 4 * s.h / gateUnits(s) : s.h, y = cy - h / 2;
  const bx0 = x + 0.22 * w, bubble = ["nand", "nor", "xnor", "not"].includes(k), r = Math.min(0.05 * w, 0.1 * h);
  const bx1 = x + 0.8 * w - (bubble ? 2 * r : 0), bw = bx1 - bx0, out = [], lw = s.lw;
  const line = (x1, y1, x2, y2) => out.push({ k: "path", cmds: [["M", x1, y1], ["L", x2, y2]], lw });
  const inputs = gateInYs(s);
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
  for (const v of inputs) {
    const py = s.y + v * s.h, bv = (py - y) / h;   // bv:本体の上から何割の高さか
    line(x, py, bv > 1e-6 && bv < 1 - 1e-6 ? leadEnd(bv) : bx0, py);
  }
  // 足が本体の角か外にあるときは、本体の後ろを上下へまっすぐのばして、足をそこにつなぐ
  const top = s.y + Math.min(...inputs) * s.h, bot = s.y + Math.max(...inputs) * s.h, ext = (h / 4) * 0.5;
  if (top <= y + 1e-6) line(bx0, top - ext, bx0, y);
  if (bot >= y + h - 1e-6) line(bx0, y + h, bx0, bot + ext);
  out.unshift({ k: "path", cmds: body, lw, fill: s.fill === "none" ? null : s.fill, dash: !!s.dash });
  if (bubble) out.push({ k: "ellipse", cx: bx1 + r, cy, rx: r, ry: r, lw, fill: "#ffffff" });
  line(bx1 + (bubble ? 2 * r : 0), cy, x + w, cy);
  return out;
}

// ------------------------------------------------------------------ 描く図形の一覧(Python にも送る)
// 接続点につながっている線の本数。2 本だけ(ただの曲がり角・つなぎ目)のときは ● を描かない
const dotDegree = id => edges().reduce((n, e) => n + (e.from.id === id) + (e.to.id === id), 0);
const hiddenDot = s => s.type === "dot" && dotDegree(s.id) === 2;
function textAlign(s) {   // 文字の寄せ方(横, 縦)。決めていなければ、注釈は左上・それ以外は真ん中
  return [s.align || (s.type === "note" ? "left" : "center"), s.valign || (s.type === "note" ? "top" : "middle")];
}
function buildPrims() {
  const out = [];
  for (const s of shapes()) {
    if (hiddenDot(s)) continue;               // 分岐していない所の ● は書き出さない
    const c = ctr(s), base = { lw: s.lw, dash: !!s.dash, fill: s.fill === "none" ? null : s.fill };
    if (s.type === "ellipse" || s.type === "dot") out.push({ k: "ellipse", cx: c.x, cy: c.y, rx: s.w / 2, ry: s.h / 2, ...base });
    else if (s.type === "gate") out.push(...gatePrims(s));
    else if (isPoly(s)) out.push({ k: "path", cmds: [...shapePoly(s).map((q, i) => [i ? "L" : "M", q.x, q.y]), ["Z"]], ...base });
    else if (s.type !== "text") out.push({ k: "rect", x: s.x, y: s.y, w: s.w, h: s.h, ...base });
    if (s.text) {
      const [al, va] = textAlign(s);
      // 寄せる側の余白:楕円は丸い分だけ内側へ、それ以外は少しだけ
      const ix = s.type === "ellipse" || isPoly(s) ? s.w * 0.2 : 8, iy = s.type === "ellipse" || isPoly(s) ? s.h * 0.16 : 6;
      const cx = s.type === "gate" ? s.x + s.w * 0.47 : c.x;
      const x = al === "left" ? s.x + ix : al === "right" ? s.x + s.w - ix : cx;
      const y = va === "top" ? s.y + iy : va === "bottom" ? s.y + s.h - iy : c.y;
      out.push({ k: "text", x, y, s: s.text, size: s.fontSize, ha: al, va: va === "middle" ? "center" : va, styles: s.textStyles, src: s.id });
    }
  }
  for (const e of edges()) {
    if (!edgeOk(e)) continue;
    const g = edgeGeom(e);
    out.push({ k: "path", cmds: g.cmds, lw: e.lw, dash: !!e.dash });
    if (e.arrow !== "none") out.push(headPrim(e, g.end, g.endFrom));
    if (e.arrow === "both") out.push(headPrim(e, g.start, g.startFrom));
    if (e.label) out.push({ k: "text", x: g.label.x, y: g.label.y, s: e.label, size: e.fontSize, ha: "center", va: "center", styles: e.textStyles, src: e.id });
  }
  // 端子の位置での分岐点:くっついて重なった端子どうしも 1 本のつながりとして数え、3 つ以上つながっていれば ● を描く
  const key = q => `${Math.round(q.x)},${Math.round(q.y)}`, spots = new Map();
  for (const s of shapes().filter(o => o.type === "gate"))
    for (const pn of gatePins(s)) {
      const q = { x: s.x + pn.ax * s.w, y: s.y + pn.ay * s.h }, k = key(q);
      if (!spots.has(k)) spots.set(k, { q, n: 0 });
      spots.get(k).n++;
    }
  for (const e of edges()) {
    if (!isWire(e) || !edgeOk(e)) continue;
    const g = edgeGeom(e);
    for (const q of [g.start, g.end]) { const sp = spots.get(key(q)); if (sp) sp.n++; }
  }
  for (const { q, n } of spots.values()) {
    if (n < 3 || shapes().some(o => o.type === "dot" && dist(ctr(o), q) < 1)) continue;
    out.push({ k: "ellipse", cx: q.x, cy: q.y, rx: DEF.dot.w / 2, ry: DEF.dot.h / 2, lw: 1, fill: "#000000" });
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
  const L = layout(p.s, p.size, p.ha, p.va, "gothic", p.styles);
  for (const er of L.errors) if (!S.mathErr.some(x => x.tex === er.tex)) S.mathErr.push(er);
  el("g", {}, parent).innerHTML = textMarkup(L, p.x, p.y);
}
// 描ける広さ:決めた大きさ(W×H)より、描いたものの右下に余白を足した所や、見えている所が広ければそこまで広げる。
// 右や下へ図形を動かすと、そのぶんグリッドも続く(図には保存しない。書き出す範囲は描いたものだけ)
function viewSize() {
  const d = S.doc, wr = $("wrap");
  let mx = 0, my = 0;
  const add = (x, y) => { if (x > mx) mx = x; if (y > my) my = y; };
  for (const it of d.items) {
    if (isShape(it)) add(it.x + it.w, it.y + it.h);
    else { for (const e of [it.from, it.to]) if (e && e.id == null) add(e.x, e.y); for (const q of it.points || []) add(q.x, q.y); }
  }
  const step = d.grid * 5, up = v => Math.ceil(v / step) * step;
  // 見えている所ぴったりまで(切り上げると、縮小したときにいらないスクロールバーが出るため)
  return { w: Math.max(up(Math.max(d.W, mx + 800)), wr ? Math.floor(wr.clientWidth / S.zoom) : 0),
           h: Math.max(up(Math.max(d.H, my + 600)), wr ? Math.floor(wr.clientHeight / S.zoom) : 0) };
}
function render() {
  svg.innerHTML = "";
  S.mathErr = [];
  const d = S.doc, vs = viewSize();
  S.vw = vs.w; S.vh = vs.h;
  svg.setAttribute("width", vs.w * S.zoom); svg.setAttribute("height", vs.h * S.zoom);
  svg.setAttribute("viewBox", `0 0 ${vs.w} ${vs.h}`);
  if (d.showGrid) {
    const defs = el("defs", {});
    const pat = el("pattern", { id: "grid", width: d.grid * 5, height: d.grid * 5, patternUnits: "userSpaceOnUse" }, defs);
    for (let i = 0; i < 5; i++) {
      const v = i * d.grid, c = i === 0 ? "#dcdcd8" : "#efefec";
      el("line", { x1: v, y1: 0, x2: v, y2: d.grid * 5, stroke: c, "stroke-width": 1 }, pat);
      el("line", { x1: 0, y1: v, x2: d.grid * 5, y2: v, stroke: c, "stroke-width": 1 }, pat);
    }
    el("rect", { x: 0, y: 0, width: vs.w, height: vs.h, fill: "url(#grid)" });
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
        if (it.label) el("circle", { cx: g.label.x, cy: g.label.y, r: px(4), fill: "#eda100", stroke: "#fff", "stroke-width": px(1) });
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
  if (S.wdraft) {
    const pts = wirePts(), tg = wireTarget(S.mouse);
    el("polyline", { points: pts.map(p => `${p.x},${p.y}`).join(" "), fill: "none", stroke: A, "stroke-width": 2, "stroke-dasharray": "5 4" });
    if (tg.end && tg.end.id != null) { const q = refPt(tg.end); el("circle", { cx: q.x, cy: q.y, r: px(8), fill: "none", stroke: "#1baf7a", "stroke-width": px(2.5) }); }
    if (tg.wire) { el("circle", { cx: tg.pt.x, cy: tg.pt.y, r: px(11), fill: "none", stroke: "#1baf7a", "stroke-width": px(2) });
                   el("circle", { cx: tg.pt.x, cy: tg.pt.y, r: px(5), fill: "#1baf7a" }); }
  }
  if (!S.drag && !S.wdraft && !S.draft && S.tool === "wire") {   // ここから分岐できる、の目印
    const w = wireAt(S.mouse), pin = S.tool === "wire" && !w ? pinAt(S.mouse) : null;
    if (pin) { const q = refPt(pin); el("circle", { cx: q.x, cy: q.y, r: px(8), fill: "none", stroke: "#1baf7a", "stroke-width": px(2.5) }); }
    if (w) {
      el("circle", { cx: w.q.x, cy: w.q.y, r: px(11), fill: "none", stroke: "#1baf7a", "stroke-width": px(2) });
      el("circle", { cx: w.q.x, cy: w.q.y, r: px(5), fill: "#1baf7a" });
    }
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
  const b = layout(e.label, e.fontSize, "center", "center", "gothic", e.textStyles).box;
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
  if (it.label && dist(g.label, p) < px(7)) return { k: "label", item: it, g };
  return null;
}

// ------------------------------------------------------------------ 履歴
function pushHist() { S.hist.push(JSON.stringify(S.doc)); if (S.hist.length > 200) S.hist.shift(); S.fut = []; }
function undo() { if (!S.hist.length) return; S.fut.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.hist.pop()); afterJump(); }
function redo() { if (!S.fut.length) return; S.hist.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.fut.pop()); afterJump(); }
function afterJump() { S.sel = S.sel.filter(get); render(); push(); }
// 直角線(配線)が斜めにならないように直す。両端の近くの曲がり角をずらし、それでもだめなら引き直す
const aligned = (a, b) => Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
function detachWireEnds() {   // 配線の端が文字・四角・楕円などにつながっていたら、その場の点として外す
  for (const e of edges()) {
    if (!isWire(e) || !edgeOk(e)) continue;
    const g = edgeGeom(e);
    for (const [k, pt] of [["from", g.start], ["to", g.end]]) {
      const sh = e[k].id != null ? get(e[k].id) : null;
      if (sh && !["gate", "dot"].includes(sh.type)) { e[k] = { x: Math.round(pt.x), y: Math.round(pt.y) }; e.wire = true; }
    }
  }
}
function autoAttach() {   // 見た目でつながっている端(● の中心・ゲートの端子にぴったり)を、本当につなぐ
  for (const e of edges()) {
    if (!isWire(e)) continue;
    for (const k of ["from", "to"]) {
      const end = e[k];
      if (end.id != null) continue;
      for (const sh of shapes()) {
        if (sh.type === "dot" && dist(ctr(sh), end) < 1.5) { e[k] = { id: sh.id, ax: 0.5, ay: 0.5 }; break; }
        if (sh.type === "gate") {
          const pin = gatePins(sh).find(pn => dist({ x: sh.x + pn.ax * sh.w, y: sh.y + pn.ay * sh.h }, end) < 1.5);
          if (pin) { e[k] = { id: sh.id, ...pin }; break; }
        }
      }
    }
  }
}
function normalizeWires(clean) {
  for (const e of edges()) {
    if (e.style !== "elbow" || !edgeOk(e)) continue;
    const a = refPt(e.from), b = refPt(e.to), c = (e.points || []).map(o => ({ ...o }));
    const all = () => [a, ...c, b];
    if (all().every((q, i, arr) => i === 0 || aligned(arr[i - 1], q))) {
      if (clean && c.length) e.points = simplify(a, c, b);   // 操作が終わったら、重なった角や一直線上の余分な角を片付ける
      continue;
    }
    if (c.length) {
      if (!aligned(a, c[0])) {                       // 始点側の角:次の区間の向きを保ったまま、始点にそろえる
        const nx = c[1] || b;
        if (Math.abs(c[0].x - nx.x) < 0.5) c[0].y = a.y; else c[0].x = a.x;
      }
      const L = c.length - 1;
      if (!aligned(c[L], b)) {                       // 終点側の角
        const pv = c[L - 1] || a;
        if (Math.abs(c[L].x - pv.x) < 0.5) c[L].y = b.y; else c[L].x = b.x;
      }
    }
    const ok = all().every((q, i, arr) => i === 0 || aligned(arr[i - 1], q));
    e.points = simplify(a, ok ? c : routeWire(e.from, e.to, a, b), b);
  }
}
// 配線を「直線の区間」の集まりにする:曲がり角では線を分けて見えない ● でつなぐ(クリックするとその直線だけ選ばれる)
// 分岐点の ● は自動で足したり消したりする
function restructureWires() {
  const dotAt = q => shapes().find(o => o.type === "dot" && dist(ctr(o), q) < 0.5);
  const newDot = q => { const d = { id: S.doc.nextId++, type: "dot", ...DEF.dot, x: q.x - DEF.dot.w / 2, y: q.y - DEF.dot.h / 2, auto: true };
                        S.doc.items.unshift(d); return d; };
  const at = d => ({ id: d.id, ax: 0.5, ay: 0.5 });
  const piece = (src, from, to) => ({ id: S.doc.nextId++, type: "edge", style: "elbow", from, to, points: [], label: "",
                                     fontSize: src.fontSize, lw: src.lw, arrow: "none", dash: !!src.dash, wire: true });
  const removeItem = it => { S.doc.items = S.doc.items.filter(x => x !== it); };
  const attachedTo = id => edges().filter(e => e.from.id === id || e.to.id === id);
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    // (a) 曲がり角で分ける
    for (const e of edges()) {
      if (!isWire(e) || !edgeOk(e) || !(e.points && e.points.length)) continue;
      const dots = e.points.map(c => dotAt(c) || newDot(c)), to0 = e.to;
      e.points = []; e.wire = true; e.to = at(dots[0]);
      for (let k = 1; k < dots.length; k++) S.doc.items.push(piece(e, at(dots[k - 1]), at(dots[k])));
      S.doc.items.push(piece(e, at(dots[dots.length - 1]), to0));
      changed = true; break;
    }
    if (changed) continue;
    // (b) 線の端が別の配線の途中にぴったり乗っていたら、そこに分岐点を作ってつなぐ
    for (const e of edges()) {
      if (!isWire(e)) continue;
      for (const k of ["from", "to"]) {
        if (e[k].id != null) continue;
        const q = { x: e[k].x, y: e[k].y };
        const other = edges().find(o => o !== e && isWire(o) && edgeOk(o) && !(o.points && o.points.length) && (() => {
          const g = edgeGeom(o); return distSeg(q, g.pts[0], g.pts[1]) < 0.5 && dist(q, g.start) > 0.5 && dist(q, g.end) > 0.5; })());
        if (!other) continue;
        const g = edgeGeom(other), a2 = splitWire({ e: other, i: 0, q: { ...q }, d: 0 });
        get(a2.id).auto = true; e[k] = a2; changed = true; break;
      }
      if (changed) break;
    }
    if (changed) continue;
    // (b2) 線の端どうし・線の端と接続点が、ぴったり重なっているのにつながっていなければ、点でつなぐ
    //      (見た目は 1 本でも中で分かれていると、スライドで半分だけ動いてしまうため)
    for (const e of edges()) {
      if (!isWire(e)) continue;
      for (const k of ["from", "to"]) {
        if (e[k].id != null) continue;
        const q = { x: e[k].x, y: e[k].y }, dot = dotAt(q);
        if (dot) { e[k] = at(dot); changed = true; break; }
        let mate = null;
        for (const o of edges()) {
          if (!isWire(o)) continue;
          for (const k2 of ["from", "to"]) if ((o !== e || k2 !== k) && o[k2].id == null && dist(o[k2], q) < 0.5) mate = [o, k2];
        }
        if (!mate || mate[0] === e) continue;   // 同じ線の両端が重なる(長さ 0)ときは (c) にまかせる
        const nd = newDot(q);
        e[k] = at(nd); mate[0][mate[1]] = at(nd); changed = true; break;
      }
      if (changed) break;
    }
    if (changed) continue;
    // (c) 長さ 0 の配線を片付ける(重なった点をまとめる)
    for (const e of edges()) {
      if (!isWire(e) || !edgeOk(e) || dist(refPt(e.from), refPt(e.to)) > 0.5) continue;
      const da = e.from.id != null && get(e.from.id).type === "dot" ? get(e.from.id) : null;
      const db = e.to.id != null && get(e.to.id).type === "dot" ? get(e.to.id) : null;
      removeItem(e);
      if (da && db && da !== db) {           // 2 つの点を 1 つに
        for (const o of attachedTo(db.id)) { if (o.from.id === db.id) o.from = at(da); if (o.to.id === db.id) o.to = at(da); }
        removeItem(db);
      } else if (da && e.to.id != null && !db) { // 点と端子 → 点につながった線を端子へ
        for (const o of attachedTo(da.id)) { if (o.from.id === da.id) o.from = { ...e.to }; if (o.to.id === da.id) o.to = { ...e.to }; }
        removeItem(da);
      } else if (db && e.from.id != null && !da) {
        for (const o of attachedTo(db.id)) { if (o.from.id === db.id) o.from = { ...e.from }; if (o.to.id === db.id) o.to = { ...e.from }; }
        removeItem(db);
      }
      changed = true; break;
    }
    if (changed) continue;
    // (d) 分岐点の自動削除:つながりが 1 本以下 → 消す / 2 本で一直線 → 1 本にまとめる
    for (const d of shapes().filter(o => o.type === "dot")) {
      const es = attachedTo(d.id), c = ctr(d);
      if (es.length === 0) { if (d.auto) { removeItem(d); changed = true; break; } continue; }   // 自分で置いた点はそのまま
      if (es.length === 1) {
        const e = es[0];
        if (e.from.id === d.id) e.from = { x: c.x, y: c.y }; if (e.to.id === d.id) e.to = { x: c.x, y: c.y };
        removeItem(d); changed = true; break;
      }
      if (es.length === 2 && es.every(e => isWire(e) && !(e.points && e.points.length)) &&
          es[0].lw === es[1].lw && !!es[0].dash === !!es[1].dash) {
        const far = e => e.from.id === d.id ? e.to : e.from, o1 = refPt(far(es[0])), o2 = refPt(far(es[1]));
        const vert = Math.abs(o1.x - c.x) < 0.5 && Math.abs(o2.x - c.x) < 0.5 && (o1.y - c.y) * (o2.y - c.y) < 0;
        const horiz = Math.abs(o1.y - c.y) < 0.5 && Math.abs(o2.y - c.y) < 0.5 && (o1.x - c.x) * (o2.x - c.x) < 0;
        if (vert || horiz) {
          const [e1, e2] = es;
          if (e1.from.id === d.id) e1.from = { ...far(e2) }; else e1.to = { ...far(e2) };
          if (e2.label && !e1.label) e1.label = e2.label;
          removeItem(e2); removeItem(d); changed = true; break;
        }
      }
    }
    if (!changed) break;
  }
  S.sel = S.sel.filter(get);
}
function commit() { detachWireEnds(); autoAttach(); normalizeWires(true); restructureWires(); render(); push(); }   // つなぎ直しは操作が終わったときだけ

// ------------------------------------------------------------------ マウス
const ptOf = ev => { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) / S.zoom, y: (ev.clientY - r.top) / S.zoom }; };
// ---- 配線:途中からの分岐と、縦横の自動ルート
// 配線かどうか:「配線」で引いた線と、ゲートや接続点につながった矢印なしの直角線
// 配線かどうか:「配線」で引いた線と、矢印のない直線・直角線(曲線や矢印つきの線は図形の縁につなぐ「矢印」扱い)
function pinAt(p) {    // 「配線」の道具でつなげる所:論理ゲートの端子と接続点だけ(四角や楕円の縁には吸い付かない)
  let best = null, bd = px(12);
  for (const s of shapes()) {
    if (s.type === "dot") {
      const d = dist(p, ctr(s));
      if (d < Math.max(s.w / 2 + px(4), px(10)) && d < bd) { bd = d; best = { id: s.id, ax: 0.5, ay: 0.5 }; }
    } else if (s.type === "gate") {
      for (const pin of gatePins(s)) {
        const d = dist(p, { x: s.x + pin.ax * s.w, y: s.y + pin.ay * s.h });
        if (d < bd) { bd = d; best = { id: s.id, ...pin }; }
      }
    }
  }
  return best;
}
function wireAt(p) {   // p のすぐ近くを通る配線(直線・直角線)と、その上のいちばん近い点
  const ns = S.tool === "wire" ? pinAt(p) : (shapeAt(p) || shapes().find(o => dist(p, boundary(o, p)) < px(6)));
  if (ns) return null;                          // 端子(図形)のすぐそばでは、そちらを優先
  let best = null;
  for (const e of edges().filter(e => isWire(e) && edgeOk(e))) {
    if (e.style === "curve") continue;
    const pts = edgeGeom(e).pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      if (!L) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
      let q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(p, q);
      if (d > px(12) || (best && d >= best.d)) continue;   // 線から画面で 12px 以内なら拾う
      // 縦や横の区間では、区間にそった位置をグリッドに合わせる(区間の外には出さない)
      if (Math.abs(dy) < 0.5) q.x = Math.min(Math.max(a.x, b.x), Math.max(Math.min(a.x, b.x), snapV(q.x)));
      else if (Math.abs(dx) < 0.5) q.y = Math.min(Math.max(a.y, b.y), Math.max(Math.min(a.y, b.y), snapV(q.y)));
      best = { e, i, q, d };
    }
  }
  return best;
}
function splitWire(hit) {   // 配線を hit.q で 2 本に分け、そこに接続点を置く。接続点への取り付け位置を返す
  const { e, i, q } = hit, wps = (e.points || []).map(o => ({ ...o }));
  const g0 = edgeGeom(e);
  for (const [k, pt] of [["from", g0.start], ["to", g0.end]]) {   // 線の端なら分けずに、端をそのままつなぐ
    if (dist(pt, q) > 0.5) continue;
    if (e[k].id != null) return { ...e[k] };                      // もう何かにつながっている端
    const dot = { id: S.doc.nextId++, type: "dot", ...DEF.dot, x: q.x - DEF.dot.w / 2, y: q.y - DEF.dot.h / 2 };
    S.doc.items.unshift(dot);
    e[k] = { id: dot.id, ax: 0.5, ay: 0.5 };
    return { ...e[k] };
  }
  const dot = { id: S.doc.nextId++, type: "dot", ...DEF.dot, x: q.x - DEF.dot.w / 2, y: q.y - DEF.dot.h / 2 };
  const at = { id: dot.id, ax: 0.5, ay: 0.5 };
  const e2 = JSON.parse(JSON.stringify(e));
  e2.id = S.doc.nextId++; e2.from = at; e2.label = "";
  if (e.style === "elbow") {   // 分けた点と重なる曲がり角は消す(長さ 0 の区間を残さない)
    e.points = wps.slice(0, i).filter(o => dist(o, q) > 0.5); e2.points = wps.slice(i).filter(o => dist(o, q) > 0.5);
  }
  e2.arrow = e.arrow === "both" ? "end" : e.arrow;   // 矢印の頭は終点側に残す
  e.arrow = e.arrow === "both" ? "none" : (e.arrow === "end" ? "none" : e.arrow);
  e.to = at;
  S.doc.items.unshift(dot);                          // 点は線の下に描く(線は点の中心で止まる)
  S.doc.items.push(e2);
  return at;
}
function startPoint(p) {    // 線の始点:配線の途中(分岐)> 図形(端子)> 自由な点(図形のすぐそばでは図形が優先)
  if (S.tool === "wire") {
    const w = wireAt(p);
    if (w) { if (!S.histPushed) pushHist(); S.histPushed = true; return splitWire(w); }
    return pinAt(p) || snapP(p);
  }   // 配線:端子・接続点、なければグリッドの点
  return endpointAt(p);
}
function endDir(end) {      // 端が横向きに出入りするか(true)、縦か(false)。決まっていなければ null
  if (end.id == null) return null;
  const s = get(end.id);
  if (!s || s.type === "dot") return null;
  if (end.ang != null) return Math.abs(Math.cos(end.ang)) > 0.7;
  if (end.ax === 0 || end.ax === 1) return true;
  if (end.ay === 0 || end.ay === 1) return false;
  return null;
}
function pinDir(end) {      // 端子が外へ向いている向き(ゲートの端子だけ)。それ以外は null
  const sh = end && end.id != null ? get(end.id) : null;
  if (!sh || sh.type !== "gate" || end.ax == null) return null;
  if (end.ax === 0) return { x: -1, y: 0 };
  if (end.ax === 1) return { x: 1, y: 0 };
  if (end.ay === 0) return { x: 0, y: -1 };
  if (end.ay === 1) return { x: 0, y: 1 };
  return null;
}
// 端子から端子への道筋:端子からまず外へ少し出て、行き先が後ろ側ならゲートの上か下(左か右)を回り込む
function routeWire(fromEnd, toEnd, P, T) {
  P = P || refPt(fromEnd); T = T || refPt(toEnd);
  const dP = pinDir(fromEnd), dT = pinDir(toEnd), g = S.doc.grid;
  if (!dP && !dT) return route(P, T, endDir(fromEnd), endDir(toEnd));
  // 片方だけが端子(もう片方はただの点や ●)のときは、回り込まずに素直な L 字・Z 字にする
  if (!dP || !dT) return route(P, T, dP ? dP.x !== 0 : endDir(fromEnd), dT ? dT.x !== 0 : endDir(toEnd));
  const S1 = dP ? { x: P.x + dP.x * g, y: P.y + dP.y * g } : P, T1 = dT ? { x: T.x + dT.x * g, y: T.y + dT.y * g } : T;
  const hP = dP ? dP.x !== 0 : null, hT = dT ? dT.x !== 0 : null;
  // 後ろ側かどうかは端子そのものの位置で決める(出しろで決めると、間が狭いときに誤って回り込む)
  // 間が 0(同じ縦や横の線の上)でも「前」とみなす。本当に後ろ側のときだけ回り込む
  const ahead = (T.x - P.x) * dP.x + (T.y - P.y) * dP.y >= 0;         // 行き先が端子の向いている側(または真横)にある
  const fromOutside = (P.x - T.x) * dT.x + (P.y - T.y) * dT.y >= 0;   // 相手の端子にも外側(または真横)から入れる
  let mid;
  if (ahead && fromOutside) {
    // 出しろを取っても行き過ぎないなら取る。間が狭いときは出しろなしで素直につなぐ
    if ((T1.x - S1.x) * dP.x + (T1.y - S1.y) * dP.y >= 0) mid = route(S1, T1, hP, hT);
    else return route(P, T, hP, hT);
  }
  else {                       // 回り込む:2 つの図形の間のすき間、なければ両方の外側を通る
    const boxes = [fromEnd, toEnd].map(e => e && e.id != null ? get(e.id) : null).filter(Boolean);
    const horiz = hP != null ? hP : hT;
    if (horiz) {
      const [a, b] = [P.y, T.y].sort((m, n) => m - n);
      const gapTop = Math.max(...boxes.map(o => o.y + o.h <= (a + b) / 2 ? o.y + o.h : -Infinity), a);
      const gapBot = Math.min(...boxes.map(o => o.y >= (a + b) / 2 ? o.y : Infinity), b);
      let my = snapV((a + b) / 2);
      const blocked = boxes.some(o => my > o.y - 1 && my < o.y + o.h + 1);
      if (blocked || gapBot - gapTop < 2 * g) my = snapV(Math.max(...boxes.map(o => o.y + o.h))) + g;   // 下を回る
      mid = [{ x: S1.x, y: my }, { x: T1.x, y: my }];
    } else {
      const [a, b] = [P.x, T.x].sort((m, n) => m - n);
      let mx = snapV((a + b) / 2);
      const blocked = boxes.some(o => mx > o.x - 1 && mx < o.x + o.w + 1);
      if (blocked) mx = snapV(Math.max(...boxes.map(o => o.x + o.w))) + g;   // 右を回る
      mid = [{ x: mx, y: S1.y }, { x: mx, y: T1.y }];
    }
  }
  return simplify(P, [...(dP ? [S1] : []), ...mid, ...(dT ? [T1] : [])], T);
}
function route(P, T, startH, endH) {   // P から T への縦横の曲がり角
  if (Math.abs(P.x - T.x) < 1 || Math.abs(P.y - T.y) < 1) return [];
  if (startH == null) startH = endH != null ? endH : Math.abs(T.x - P.x) >= Math.abs(T.y - P.y);
  if (endH == null) endH = startH;
  if (startH && endH) { const mx = snapV((P.x + T.x) / 2); return [{ x: mx, y: P.y }, { x: mx, y: T.y }]; }
  if (!startH && !endH) { const my = snapV((P.y + T.y) / 2); return [{ x: P.x, y: my }, { x: T.x, y: my }]; }
  return startH ? [{ x: T.x, y: P.y }] : [{ x: P.x, y: T.y }];
}
// まっすぐを優先:マウスが基準点 ref と同じ高さ(または同じ横位置)の近くなら、グリッドの隣にずらさずそろえる
const STRAIGHT_BAND = 14;
function straightSnap(p, ref) {
  const q = snapP(p);
  if (!ref) return q;
  const dy = Math.abs(p.y - ref.y), dx = Math.abs(p.x - ref.x);
  const band = Math.max(px(STRAIGHT_BAND), S.doc.grid * 0.75);   // 拡大していても、グリッドの 3/4 までは「まっすぐ」
  if (dy < band && dy <= dx) q.y = ref.y;
  else if (dx < band) q.x = ref.x;
  return q;
}
function wireTarget(p) {    // 配線の行き先の候補(マウスの位置):配線の途中 / 端子 / グリッドの点
  const w = wireAt(p);
  if (w) return { wire: w, pt: w.q, dir: null };
  const pin = pinAt(p);   // 四角や楕円の縁には吸い付かない
  if (pin) return { end: pin, pt: refPt(pin), dir: endDir(pin) };
  let ref = null;            // 描いている途中なら、最後の点からまっすぐ伸ばすのを優先
  if (S.wdraft) { const fixed = [refPt(S.wdraft.from), ...S.wdraft.pts]; ref = fixed[fixed.length - 1]; }
  const q = straightSnap(p, ref); return { end: q, pt: q, dir: null };
}
function wirePts() {        // 配線を描いている途中の点(プレビュー用)
  const d = S.wdraft, start = refPt(d.from), fixed = [start, ...d.pts], last = fixed[fixed.length - 1];
  const tg = wireTarget(S.mouse);
  const corners = !d.pts.length && tg.end ? routeWire(d.from, tg.end, start, tg.pt) : route(last, tg.pt, d.pts.length ? null : endDir(d.from), tg.dir);
  return [...fixed, ...corners, tg.pt];
}
function finishWire(tg) {
  const d = S.wdraft; S.wdraft = null;
  if (!S.histPushed) pushHist();
  S.histPushed = false;
  const to = tg.wire ? splitWire(tg.wire) : tg.end;
  const start = refPt(d.from), last = d.pts.length ? d.pts[d.pts.length - 1] : start, T = refPt(to);
  const corners = d.pts.length ? [...d.pts, ...route(last, T, null, endDir(to))] : routeWire(d.from, to, start, T);
  if (to.id == null && d.from.id == null && dist(start, T) < 1) { render(); return; }
  const e = { id: S.doc.nextId++, type: "edge", style: "elbow", from: d.from, to, points: simplify(start, corners, T),
              label: "", fontSize: 18, lw: LINE_LW, arrow: "none", dash: false, wire: true };
  S.doc.items.push(e);
  S.sel = [e.id]; S.tool = "select";
  commit(); updateCursor();
}

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
      const it = hit.item;
      // 折れ線(直角線・配線)と、図形につながった線は、つかんだ区間をスライド(端は残して伸び縮み)
      // どこにもつながっていない線(折れ線ならそのひとまとまり)は全体を移動。つながっている線は区間をスライド
      // ⌥ を押しながらなら、つながっていても外して移動
      const chain = !isShape(it) && isWire(it) ? wireChain(it) : null;
      const freeLine = !isShape(it) && (chain ? chain.free : (it.from.id == null && it.to.id == null));
      const slide = !isShape(it) && S.sel.length === 1 && !freeLine && !ev.altKey && (it.style === "elbow" || it.from.id != null || it.to.id != null);
      if (hit.label && S.sel.length === 1) { pushHist(); S.drag = { kind: "handle", h: { k: "label", item: it, g: edgeGeom(it) }, moved: false }; }
      else if (slide && segDragStart(it, p)) { /* つながった線は、端を残して伸び縮みさせる */ }
      else {
        pushHist();
        const ids = chain && S.sel.length === 1 ? [...chain.edges, ...chain.dots] : null;   // 折れ線はまとめて動かす(⌥ のときは端子から外して)
        S.drag = { kind: "move", start: p, orig: JSON.stringify(S.doc), moved: false, ids };
      }
    } else {
      if (!ev.shiftKey) S.sel = [];
      S.drag = { kind: "box", start: p };
    }
  } else if (DEF[t]) {
    S.drag = { kind: "create", start: snapP(p) };
  } else if (t === "straight" || t === "curve") {
    S.histPushed = false;
    S.drag = { kind: "edge", from: t === "straight" ? startPoint(p) : endpointAt(p), start: p };
  } else if (t === "wire") {
    if (!S.wdraft) { S.histPushed = false; S.wdraft = { from: startPoint(p), pts: [] }; }
    else {
      const tg = wireTarget(p);
      const startShape = S.wdraft.from.id;
      const sameEnd = tg.end && tg.end.id != null && tg.end.id === startShape && tg.end.ax === S.wdraft.from.ax && tg.end.ay === S.wdraft.from.ay;
      if (sameEnd && !S.wdraft.pts.length) { /* 始点をもう一度クリック → 何もしない */ }
      else if (tg.wire || (tg.end && tg.end.id != null)) finishWire(tg);
      else { const pts = wirePts(); S.wdraft.pts.push(...pts.slice(S.wdraft.pts.length + 1)); }   // そこを通る
    }
  } else if (t === "elbow") {
    if (!S.draft) { S.histPushed = false; S.draft = { from: startPoint(p), pts: [] }; }
    else {
      const s = S.doc.snapEdge ? nearShape(p) : null;
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
  if (!S.drag && !S.draft && !S.wdraft && S.tool === "select") { updateUI(); return; }
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
      const inBox = q => q.x >= b.x - 0.5 && q.y >= b.y - 0.5 && q.x <= b.x + b.w + 0.5 && q.y <= b.y + b.h + 0.5;
      const es = edges().filter(e => {
        if (!edgeOk(e)) return false;
        // 線全体が囲みの中に入っていれば選ぶ(配線・どこにもつながっていない線も)
        const g = edgeGeom(e), pts = g.pts || samplePts(g.cmds);
        if (pts.every(inBox)) return true;
        // 両端とも選んだ図形につながっている矢印も選ぶ
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
  if (!d.moved) { const prev = S.hist.pop(); if (d.kind === "seg" && prev) S.doc = JSON.parse(prev); render(); return; }
  commit();
});
// ダブルクリック:クリックのたびに図を描き直すので、ブラウザの dblclick は届かない。自分で判定する。
function onDouble(p) {
  if (S.wdraft) {
    if (S.wdraft.pts.length) { const last = S.wdraft.pts.pop(); finishWire({ end: { x: last.x, y: last.y }, pt: last, dir: null }); return; }
    S.wdraft = null;
    if (S.histPushed) { S.histPushed = false; undo(); S.fut.pop(); }
  }
  if (S.tool === "wire") { render(); return; }   // 配線中のダブルクリックで、下の文字が編集にならないように
  if (S.draft && S.draft.pts.length) { finishElbow(snapP(orth([refPt(S.draft.from), ...S.draft.pts].slice(-1)[0], p))); return; }
  S.draft = null;   // 直角の線を描き始めただけなら、やめて文字の編集にする
  S.drag = null;
  const hit = hitTest(p);   // どの道具を選んでいても、ダブルクリックで文字を編集できる
  if (hit) { S.tool = "select"; S.sel = [hit.item.id]; render(); openEditor(hit.item); }
  else render();
}

// ---- つながった線をつかんで動かす:端はそのまま、つかんだ所だけ動かして前後を伸び縮みさせる
// 曲がり角(線が 2 本だけの見えない点)でつながった配線のひとまとまり
function wireChain(e) {
  const es = new Set([e.id]), ds = new Set(), todo = [e];
  while (todo.length) {
    const cur = todo.pop();
    for (const end of [cur.from, cur.to]) {
      const sh = end.id != null ? get(end.id) : null;
      if (!sh || !hiddenDot(sh) || ds.has(sh.id)) continue;
      ds.add(sh.id);
      for (const o of edges()) if (!es.has(o.id) && (o.from.id === sh.id || o.to.id === sh.id) && isWire(o)) { es.add(o.id); todo.push(o); }
    }
  }
  const all = [...es].map(get);
  const freeEnds = all.every(x => [x.from, x.to].every(end => end.id == null || ds.has(end.id)));   // 端子や分岐点につながっていない
  return { edges: [...es], dots: [...ds], free: freeEnds };
}
function segDragStart(e, p) {
  const g = edgeGeom(e);
  if (e.style === "curve") {                    // 曲線:つかんだ所に合わせて曲がり方を変える(両端は動かない)
    pushHist(); freezeEnds(e);
    const g2 = edgeGeom(e);
    S.drag = { kind: "seg", e, curve: true, start: p, mid0: g2.mid, c1: e.c1 && { ...e.c1 }, c2: e.c2 && { ...e.c2 }, moved: false };
    return true;
  }
  const pts = g.pts;
  let bi = -1, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) { const d = distSeg(p, pts[i], pts[i + 1]); if (d < bd) { bd = d; bi = i; } }
  if (bi < 0) return false;
  const A = pts[bi], B = pts[bi + 1];
  const horiz = Math.abs(A.y - B.y) < 0.5, vert = Math.abs(A.x - B.x) < 0.5;
  if (!horiz && !vert) return false;             // 斜めの直線は今までどおり
  pushHist();
  // 端が接続点なら、点ごと動かす(点につながったほかの線が伸び縮みする)
  const dotOf = end => { const sh = end.id != null ? get(end.id) : null; return sh && sh.type === "dot" ? { id: sh.id, x: sh.x, y: sh.y } : null; };
  S.drag = { kind: "seg", e, i: bi, horiz, start: p, pts0: pts.map(q => ({ ...q })), from0: { ...e.from }, to0: { ...e.to },
             style0: e.style, dotA: bi === 0 ? dotOf(e.from) : null, dotB: bi === pts.length - 2 ? dotOf(e.to) : null, moved: false };
  return true;
}
function segDragMove(d, p) {
  const e = d.e;
  if (d.curve) {
    const ddx = p.x - d.start.x, ddy = p.y - d.start.y;
    if (d.c1 && d.c2) {
      const k = 4 / 3;
      e.c1 = { dx: d.c1.dx + ddx * k, dy: d.c1.dy + ddy * k }; e.c2 = { dx: d.c2.dx + ddx * k, dy: d.c2.dy + ddy * k };
    } else {
      const g = edgeGeom(e);
      e.mx = d.mid0.x + ddx - g.cm.x; e.my = d.mid0.y + ddy - g.cm.y;
    }
    return;
  }
  const raw = d.horiz ? p.y - d.start.y : p.x - d.start.x;
  const delta = S.doc.snap ? Math.round(raw / S.doc.grid) * S.doc.grid : Math.round(raw);
  const P = d.pts0, n = P.length, i = d.i, A = P[i], B = P[i + 1];
  const shift = q => d.horiz ? { x: q.x, y: q.y + delta } : { x: q.x + delta, y: q.y };
  let corners = P.slice(1, n - 1).map(q => ({ ...q }));
  if (i > 0) corners[i - 1] = shift(corners[i - 1]);
  if (i + 1 < n - 1) corners[i] = shift(corners[i]);
  const len = dist(A, B), dir = len ? { x: (B.x - A.x) / len, y: (B.y - A.y) / len } : { x: 1, y: 0 };
  const stub = Math.min(S.doc.grid, len / 2);
  e.from = { ...d.from0 }; e.to = { ...d.to0 };
  for (const dt of [d.dotA, d.dotB]) {           // 接続点は線と一緒に動かす
    if (!dt) continue;
    const sh = get(dt.id), q = shift(dt);
    sh.x = q.x; sh.y = q.y;
  }
  if (i === 0) {
    if (d.dotA) { /* 点ごと動いたので、角は足さない */ }
    else if (d.from0.id != null) {                       // 端子につながった始点は動かさず、すぐ横に曲がり角を足す
      const sA = { x: A.x + dir.x * stub, y: A.y + dir.y * stub };
      corners = [sA, shift(sA), ...corners];
    } else e.from = shift(d.from0);
  }
  if (i + 1 === n - 1) {
    if (d.dotB) { /* 点ごと動いた */ }
    else if (d.to0.id != null) {
      const sB = { x: B.x - dir.x * stub, y: B.y - dir.y * stub };
      corners = [...corners, shift(sB), sB];
    } else e.to = shift(d.to0);
  }
  e.style = "elbow";
  e.points = delta === 0 && d.style0 !== "elbow" ? [] : simplify(refPt(e.from), corners, refPt(e.to));
  if (delta === 0 && d.style0 === "straight") e.style = "straight";
}
function dragMove(d, p) { if (d.kind === "seg") { d.moved = true; segDragMove(d, p); normalizeWires(); return; } dragMoveInner(d, p); if (d.kind !== "pan") normalizeWires(); }
function dragMoveInner(d, p) {
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
      const moving = d.ids || S.sel;
      const keep = new Set(moving.filter(id => isShape(get(id))));
      for (const id of moving) { const it = get(id); if (it && !isShape(it)) detachEnds(it, keep); }
      d.orig = JSON.stringify(S.doc);          // 外したあとの位置を基準に動かす
    }
    d.moved = true;
    const orig = JSON.parse(d.orig), O = id => orig.items.find(i => i.id === id);
    const sel = new Set(d.ids || S.sel), selShapes = orig.items.filter(i => sel.has(i.id) && isShape(i));
    let dx = dx0, dy = dy0;
    S.guides = [];
    if (selShapes.length) {      // 先頭の図形の左上をグリッドに合わせる(大きさもグリッドの倍数なので、四辺ともグリッドに乗る)
      const s0 = selShapes[0];
      let tx = snapV(s0.x + dx), ty = snapV(s0.y + dy);
      if (s0.type === "dot") { tx = snapV(s0.x + dx + s0.w / 2) - s0.w / 2; ty = snapV(s0.y + dy + s0.h / 2) - s0.h / 2; }
      if (s0.type === "gate") { const off = gatePinOffset(s0); ty = snapV(s0.y + dy + off) - off; }
      // 縁への吸着はグリッドと独立。近い縁や中心があれば優先する。
      if (S.doc.snapEdge) {
        const result = snapToGuides({ x: s0.x + dx, y: s0.y + dy }, { x: tx, y: ty }, s0,
          shapes().filter(s => !sel.has(s.id)), px(7));
        tx = result.x; ty = result.y;
        if (result.guideX != null) S.guides.push({ x1: result.guideX, y1: 0, x2: result.guideX, y2: S.vh || S.doc.H });
        if (result.guideY != null) S.guides.push({ x1: 0, y1: result.guideY, x2: S.vw || S.doc.W, y2: result.guideY });
      }
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
    // 配線は曲がり角で分かれている(見えない ● でつながっている)。選んだ図形につながった区間が横なら、
    // その先の曲がり角も一緒に上下に(縦なら左右に)動かして、区間の向きを保つ。
    // (こうしないと、動かすたびに区間が斜めになって新しい曲がり角ができ、折れ曲がる所が毎回変わってしまう)
    const corner = id => {   // 自動でできた、線が 2 本だけの曲がり角(選んでいないもの)
      const s = id != null ? get(id) : null;
      return s && s.type === "dot" && s.auto && !sel.has(id) && edges().filter(x => x.from.id === id || x.to.id === id).length === 2 ? s : null;
    };
    for (const e of edges()) {
      if (!isWire(e) || sel.has(e.id) || (e.points || []).length) continue;
      for (const [mine, other] of [["from", "to"], ["to", "from"]]) {
        if (!sel.has(e[mine].id)) continue;
        const dot = corner(e[other].id), oe = O(e.id), od = dot && O(dot.id);
        if (!dot || !oe || !od) continue;
        const pa = refPtIn(orig, oe[mine]), pb = refPtIn(orig, oe[other]);
        if (Math.abs(pa.y - pb.y) < 0.5 && Math.abs(pa.x - pb.x) >= 0.5) dot.y = od.y + dy;        // 横の区間 → 角を上下に
        else if (Math.abs(pa.x - pb.x) < 0.5 && Math.abs(pa.y - pb.y) >= 0.5) dot.x = od.x + dx;   // 縦の区間 → 角を左右に
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
      if (it.type === "gate") fitGate(it, { x: d.fixed.x, y: d.fixed.y, right: h.k.includes("w"), bottom: h.k.includes("n") });
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
      const ns = S.doc.snapEdge ? nearShape(p) : null;   // 輪郭の吸着はグリッドと別に切り替える
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
      let end;
      if (isWire(it)) {   // 配線は端子・●・グリッドだけ(文字や四角は無視)。となりの点からまっすぐ伸ばすのを優先
        if (!d.nb) { const pts = edgeGeom(it).pts; d.nb = h.k === "start" ? { ...pts[1] } : { ...pts[pts.length - 2] }; }
        end = pinAt(p) || straightSnap(p, d.nb);
      } else end = endpointAt(p);
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
  const under = t === "dot" ? shapes().find(o => o.type === "dot" && dist(ctr(o), snapP(a)) < 1)   // 線の上にも置ける
    : box.w < 15 && box.h < 15 ? (shapeAt(S.mouse) || hitTest(S.mouse)?.item) : null;
  if (under) { S.sel = [under.id]; render(); return; }   // 既にある図形の上をクリックしたら選ぶだけ
  if (t === "dot") {             // 配線の途中に置いたら、そこで線を分けてつなぐ(端の上なら、あとで autoAttach がつなぐ)
    const c = snapP(a), hit = wireAt(c);
    if (hit && dist(hit.q, c) < 1) {
      const g = edgeGeom(hit.e);
      if (dist(hit.q, g.start) > 1 && dist(hit.q, g.end) > 1) {
        pushHist(); const at = splitWire(hit); S.sel = [at.id]; setTool("select"); commit(); return;
      }
    }
  }
  pushHist();
  const s = { id: S.doc.nextId++, type: t, ...def };
  if (t === "gate") { s.kind = S.gateKind || "and"; if (s.kind === "dff") s.dffv = 2; }
  const fit = v => S.doc.snap ? Math.max(S.doc.grid, Math.round(v / S.doc.grid) * S.doc.grid) : v;
  if (t === "dot") { const c = snapP(a); s.x = c.x - s.w / 2; s.y = c.y - s.h / 2; }
  else if (t === "gate") {        // 端子がグリッドの点に乗るように置く
    s.w = s.kind === "dff" ? 80 : fit(def.w); s.h = s.kind === "dff" ? 120 : def.h;   // D-FF は縦長(80×120)
    s.x = a.x - s.w / 2; s.y = a.y - s.h / 2;
    fitGate(s);
  }
  else if (box.w >= 15 && box.h >= 15) Object.assign(s, box);
  else { s.w = fit(def.w); s.h = fit(def.h); s.x = snapV(a.x - s.w / 2); s.y = snapV(a.y - s.h / 2); }
  S.doc.items.push(s);
  S.sel = [s.id]; setTool("select");
  commit();
  if (t !== "gate" && t !== "dot") openEditor(s);
}
function createEdge(from, to, start, p) {
  if (dist(start, p) < 10) { if (S.histPushed) { S.histPushed = false; undo(); S.fut.pop(); } else render(); return; }   // クリックしただけ(分岐も取り消す)
  if (!S.histPushed) pushHist();
  S.histPushed = false;
  const e = { id: S.doc.nextId++, type: "edge", style: S.tool, from, to, label: "", fontSize: 18, lw: LINE_LW, arrow: "end", dash: false, ...lastHead() };
  if (S.tool === "curve") e.bend = 40;
  if (from.id != null && from.id === to.id) makeLoop(e);
  e.wire = false;   // 「直線」「曲線」は、接続先や矢印の有無にかかわらず通常の線
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
  if (!S.histPushed) pushHist();
  S.histPushed = false;
  const e = { id: S.doc.nextId++, type: "edge", style: "elbow", from: d.from, to, points: simplify(refPt(d.from), pts, refPt(to)), label: "", fontSize: 18, lw: LINE_LW, arrow: "end", dash: false, wire: false, ...lastHead() };
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
    height: h * z + "px", fontSize: size * z + "px", textAlign: isShape(it) ? textAlign(it)[0] : "center" });
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
    if (v !== cur) { pushHist(); it.textStyles = remapStyles(cur || "", v, it.textStyles); if (isShape(it)) it.text = v; else it.label = v; commit(); return; }
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

// 文字の挿入・削除で書式の位置を動かし、変わっていない部分を保つ。

function openFormatEditor(it) {
  if (!it) return;
  const dlg = $("format_dialog"), ta = $("format_text"), preview = $("format_preview"), message = $("format_message");
  const oldText = (isShape(it) ? it.text : it.label) || "";
  let previous = oldText, styles = Array.from({ length: oldText.length }, (_, i) => it.textStyles?.[i] || null), start = 0, end = oldText.length;
  ta.value = oldText; message.textContent = "文字を選んでから、書式を選んでください。";
  preview.style.fontSize = it.fontSize + "px";
  function remember() {
    start = ta.selectionStart; end = ta.selectionEnd;
    const selected = styles.slice(start, end), first = selected[0] || {};
    dlg.querySelectorAll("[data-format]").forEach(b => {
      if (b.dataset.format !== "clear") b.setAttribute("aria-pressed", String(selected.length > 0 && selected.every(st => !!st?.[b.dataset.format])));
    });
    $("format_color").value = first.color || "#000000";
    $("format_size").value = first.size || it.fontSize;
    $("format_script").value = first.script || "normal";
  }
  function drawPreview() {
    preview.replaceChildren();
    for (let i = 0; i < ta.value.length;) {
      const cp = ta.value.codePointAt(i), ch = String.fromCodePoint(cp), st = styles[i] || {}, n = document.createElement("span");
      n.textContent = ch; n.style.color = st.color || "#000000"; n.style.fontWeight = st.bold ? "bold" : "normal";
      n.style.fontStyle = st.italic ? "italic" : "normal"; n.style.textDecoration = [st.underline ? "underline" : "", st.strike ? "line-through" : ""].filter(Boolean).join(" ");
      if (st.size) n.style.fontSize = st.size + "px";
      if (st.script === "super" || st.script === "sub") { n.style.verticalAlign = st.script === "super" ? "super" : "sub"; n.style.fontSize = (st.size || it.fontSize) * .72 + "px"; }
      preview.appendChild(n); i += ch.length;
    }
  }
  function apply(key, value) {
    if (start === end) { message.textContent = "先に、書式を変えたい文字を選んでください。"; ta.focus(); return; }
    // 数式はひとまとまりとして描くため、数式の一部を選んだ場合も数式全体に適用する。
    let open = -1;
    for (let i = 0; i < ta.value.length; i++) {
      if (ta.value[i] === "\\") { i++; continue; }
      if (ta.value[i] !== "$") continue;
      if (open < 0) open = i;
      else { if (start < i + 1 && end > open) { start = Math.min(start, open); end = Math.max(end, i + 1); } open = -1; }
    }
    const selected = styles.slice(start, end), toggle = value === "toggle" ? !selected.every(s => s?.[key]) : value;
    for (let i = start; i < end; i++) {
      if (key === "clear") styles[i] = null;
      else { const obj = { ...(styles[i] || {}) }; if (toggle === null || toggle === false || toggle === "normal") delete obj[key]; else obj[key] = toggle; styles[i] = Object.keys(obj).length ? obj : null; }
    }
    message.textContent = "選んだ文字に書式を設定しました。数式は全体に適用されます。"; drawPreview(); ta.focus(); ta.setSelectionRange(start, end); remember();
  }
  ta.onselect = ta.onkeyup = ta.onmouseup = remember;
  ta.oninput = () => { styles = remapStyles(previous, ta.value, styles); if (styles.length !== ta.value.length) styles = Array.from({ length: ta.value.length }, (_, i) => styles[i] || null); previous = ta.value; remember(); drawPreview(); };
  dlg.querySelectorAll("[data-format]").forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => apply(b.dataset.format, b.dataset.format === "clear" ? null : "toggle"); });
  $("format_color").onchange = e => apply("color", e.target.value);
  $("format_size").onchange = e => { const n = Number(e.target.value); if (n >= 6 && n <= 96) apply("size", n); else message.textContent = "文字の大きさは 6〜96 で指定してください。"; };
  $("format_script").onchange = e => apply("script", e.target.value);
  $("format_cancel").onclick = () => dlg.close();
  $("format_save").onclick = () => {
    const value = ta.value.replace(/\s+$/, ""); styles = styles.slice(0, value.length);
    const savedStyles = styles.some(Boolean) ? styles : [];
    const originalStyles = Array.isArray(it.textStyles) && it.textStyles.some(Boolean) ? it.textStyles : [];
    if (value !== oldText || JSON.stringify(savedStyles) !== JSON.stringify(originalStyles)) {
      pushHist(); if (isShape(it)) it.text = value; else it.label = value;
      it.textStyles = savedStyles; commit();
    }
    dlg.close();
  };
  drawPreview(); dlg.showModal(); ta.focus(); ta.setSelectionRange(0, oldText.length); remember();
}

// ------------------------------------------------------------------ キーボード・ボタン
function delSel() {
  if (!S.sel.length) return;
  pushHist();
  const ids = new Set(S.sel);
  // 配線は残す:消す図形(ゲート・● など)につながっていた端を、その場所の点にする
  for (const e of edges()) {
    if (ids.has(e.id) || !isWire(e) || !edgeOk(e)) continue;
    const g = edgeGeom(e);
    if (ids.has(e.from.id)) e.from = { x: Math.round(g.start.x), y: Math.round(g.start.y) };
    if (ids.has(e.to.id)) e.to = { x: Math.round(g.end.x), y: Math.round(g.end.y) };
  }
  // 矢印(配線でない線)は、今までどおりつながっていた図形と一緒に消す
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
  else if (mod && (k === "]" || k === "}")) { ev.preventDefault(); restack(ev.shiftKey ? "front" : "up"); }
  else if (mod && (k === "[" || k === "{")) { ev.preventDefault(); restack(ev.shiftKey ? "back" : "down"); }
  else if (mod && k === "a") { ev.preventDefault(); S.sel = S.doc.items.map(i => i.id); render(); }
  else if (k === "+" || k === "=" || k === ";") { ev.preventDefault(); zoomStep(1); }
  else if (k === "-") { ev.preventDefault(); zoomStep(-1); }
  else if (k === "0") { ev.preventDefault(); setZoom(1); }
  else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); delSel(); }
  else if (ev.key === "Escape") { if (S.histPushed) { S.histPushed = false; S.wdraft = null; S.draft = null; undo(); S.fut.pop(); } S.wdraft = null; S.draft = null; S.drag = null; S.sel = []; setTool("select"); }
  else if (ev.key === "Enter" && S.sel.length === 1) { ev.preventDefault(); openEditor(get(S.sel[0])); }
  else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    const st = ev.altKey && !S.doc.snap ? 1 : S.doc.grid;   // 吸着がオンのときはグリッドの幅でだけ動く
    nudge(ev.key === "ArrowLeft" ? -st : ev.key === "ArrowRight" ? st : 0, ev.key === "ArrowUp" ? -st : ev.key === "ArrowDown" ? st : 0);
  } else if (!mod) {
    const t = TOOLS.find(t => t[2].toLowerCase() === k);
    if (t) setTool(t[0]);
  }
});

function setTool(t) { if (S.histPushed) { S.histPushed = false; S.wdraft = null; S.draft = null; undo(); S.fut.pop(); } S.tool = t; S.draft = null; S.wdraft = null; render(); updateCursor(); }
const ICON = {
  select: '<path d="M6 3l12 9-5.5 1L15 19l-2.5 1.2-2.6-6L6 17z" fill="currentColor"/>',
  ellipse: '<ellipse cx="13" cy="11" rx="10" ry="7" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  rect: '<rect x="3" y="4" width="20" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  trap: '<path d="M8 4h10l5 14H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  poly: '<path d="M13 2l8.5 4.75v9.5L13 21l-8.5-4.75v-9.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  note: '<rect x="3" y="3" width="20" height="16" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 8h12M7 12h9" stroke="currentColor" stroke-width="1.5"/>',
  text: '<path d="M6 5h14M13 5v13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  straight: '<path d="M3 17L21 5M21 5h-6M21 5v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  curve: '<path d="M3 18C3 6 20 3 20 16.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 12.5 20 17.5 24.5 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  elbow: '<path d="M3 5h10v12h8M21 17l-4-3.5M21 17l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  dot: '<path d="M2 11h22M13 11v9" stroke="currentColor" stroke-width="1.6"/><circle cx="13" cy="11" r="3.4" fill="currentColor"/>',
  wire: '<path d="M2 5h8v12h14" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="2.5" cy="5" r="2" fill="currentColor"/><circle cx="23" cy="17" r="2" fill="currentColor"/><path d="M10 11h6" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="11" r="2.2" fill="currentColor"/>',
};
const svgIcon = (body, vb = "0 0 26 22") => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
function gateIcon(kind) {   // 実際の形(gatePrims)を小さく描いたアイコン
  const prims = gatePrims(kind === "dff" ? { kind, x: 15, y: 1, w: 30, h: 38, lw: 2.4, fill: "none" }
                                          : { kind, x: 1, y: 1, w: 58, h: 38, lw: 2.4, fill: "none" });
  const body = prims.map(p => p.k === "ellipse"
    ? `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="none" stroke="currentColor" stroke-width="2.4"/>`
    : p.k === "rect" ? `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="currentColor" stroke-width="2.4"/>`
    : `<path d="${dStr(p.cmds)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`).join("");
  return svgIcon(body, "0 0 60 40");
}
const TOOL_LABEL = { select: "選択", ellipse: "楕円", rect: "四角", trap: "台形", poly: "多角形", note: "注釈", text: "文字", straight: "直線", curve: "曲線", elbow: "直角線", dot: "接続点", wire: "配線" };
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
  for (const t of ["ellipse", "rect", "trap", "poly", "note", "text"]) pal.appendChild(btn(t, TOOL_LABEL[t], svgIcon(ICON[t])));
  title("線・矢印");
  // 接続点(●)は、配線の途中から分岐すると自動でできるので、道具の欄には出さない
  for (const t of ["wire", "straight", "curve", "elbow"]) pal.appendChild(btn(t, TOOL_LABEL[t], svgIcon(ICON[t])));
  title("論理ゲート");
  const g = document.createElement("div"); g.className = "gates"; pal.appendChild(g);
  for (const k of Object.keys(GATE_NAMES)) g.appendChild(btn("gate", k === "buf" ? "BUF" : GATE_NAMES[k], gateIcon(k), k));

  $("g_show").onchange = e => { S.doc.showGrid = e.target.checked; commit(); };
  $("g_snap").onchange = e => { S.doc.snap = e.target.checked; commit(); };
  $("g_edge_snap").onchange = e => { S.doc.snapEdge = e.target.checked; commit(); };
  $("g_size").onchange = e => { S.doc.grid = +e.target.value; commit(); };
  $("b_undo").onclick = undo; $("b_redo").onclick = redo;
  $("b_dup").onclick = () => { copySel(); paste(); };
  $("b_del").onclick = delSel;
}

// ------------------------------------------------------------------ 右の設定欄
const SIDE_ICON = {
  arrowNone: '<path d="M2 8h20" stroke="currentColor" stroke-width="2"/>',
  arrowEnd: '<path d="M2 8h18M15 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  headOpen: '<path d="M2 8h19M14 3l7 5-7 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  headFill: '<path d="M2 8h13" stroke="currentColor" stroke-width="2"/><path d="M13 3l9 5-9 5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
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
const KIND_NAME = { ellipse: "楕円", rect: "四角", trap: "台形", poly: "多角形", note: "注釈", text: "文字", gate: "論理ゲート", dot: "接続点", edge: "矢印・線" };

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
function dotsHTML(items) {
  const cur = items.every(i => i.w === items[0].w) ? items[0].w : "";
  const pale = items.length === 1 && hiddenDot(items[0]);
  return `<div class="sec"><h4>${items.length === 1 ? "接続点" : `${items.length} 個の接続点を選択中`}</h4>
    ${pale ? `<div style="font-size:11.5px;color:var(--muted);line-height:1.6">線が 2 本だけつながっている(分岐していない)ので、● は書き出す図には描かれません。3 本以上つながると黒い ● になります。</div>` : ""}</div>
    <div class="sec"><h4>点の大きさ</h4>${seg("dotsize", [[6, "小"], [10, "中"], [14, "大"]], cur)}</div>
    <div class="sec"><button class="btn wide danger" id="p_delete">削除</button></div>`;
}
function sideHTML(items) {
  if (items.length && items.every(i => i.type === "dot")) return dotsHTML(items);
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
    くわしくは右上の「？ → 数式の書き方」</div>`;
  const one = items[0], shapesSel = items.filter(isShape), edgesSel = items.filter(i => !isShape(i));
  const same = k => items.every(i => i[k] === one[k]) ? one[k] : "";
  const kinds = [...new Set(items.map(i => isWire(i) ? "配線" : KIND_NAME[i.type]))].join("・");
  let h = `<div class="sec"><h4>${items.length === 1 ? kinds : `${items.length} 個を選択中(${kinds})`}</h4>`;
  if (items.length === 1) h += `<button class="btn wide" id="p_text">✏️ 文字を編集</button><button class="btn wide" id="p_format" style="margin-top:8px">文字の書式を設定</button>`;
  h += `</div>`;
  if (shapesSel.length) {
    const al = shapesSel.every(i => textAlign(i)[0] === textAlign(shapesSel[0])[0]) ? textAlign(shapesSel[0])[0] : "";
    const va = shapesSel.every(i => textAlign(i)[1] === textAlign(shapesSel[0])[1]) ? textAlign(shapesSel[0])[1] : "";
    h += `<div class="sec"><h4>文字の位置</h4>${seg("align", [["left", "左寄せ"], ["center", "中央"], ["right", "右寄せ"]], al)}
      <div style="height:6px"></div>${seg("valign", [["top", "上"], ["middle", "中"], ["bottom", "下"]], va)}</div>`;
  }
  h += `<div class="sec"><h4>文字の大きさ</h4><div class="stepper"><button id="fs_minus">−</button><input type="number" id="p_fs" min="6" max="96" value="${same("fontSize")}"><button id="fs_plus">＋</button></div></div>`;
  h += `<div class="sec"><h4>線の太さ</h4>${seg("lw", [[1, "細"], [1.5, "標準"], [2, "太"], [3, "極太"]], same("lw"))}
    <div class="row" style="margin-top:6px"><div class="stepper"><button id="lw_minus" title="0.25 pt 細くする">−</button><input type="number" id="p_lw" min="0.25" max="20" step="0.25" value="${same("lw")}" title="線の太さ(pt)。書き出した図でもこの太さになります"><button id="lw_plus" title="0.25 pt 太くする">＋</button></div>
    <span style="font-size:12px;color:var(--muted)">pt(ポイント)</span></div></div>`;
  h += `<div class="sec"><h4>線の種類</h4>${seg("dash", [["0", sicon("solid"), "実線"], ["1", sicon("dash"), "点線"]], items.every(i => i.dash) ? "1" : items.every(i => !i.dash) ? "0" : "")}</div>`;
  if (shapesSel.length) {
    h += `<div class="sec"><h4>塗り</h4>${seg("fill", [["#ffffff", "白でぬる"], ["none", "なし(透明)"]], shapesSel.every(i => i.fill === "none") ? "none" : shapesSel.every(i => i.fill !== "none") ? "#ffffff" : "")}</div>`;
    const k = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";
    h += `<div class="sec"><h4>重なりの順番</h4><div class="grid2">
      <button class="btn" data-stack="front" title="いちばん前に出す(${k}Shift+])">⇈ 最前面へ</button><button class="btn" data-stack="up" title="1 つ前に出す(${k}])">↑ 1 つ前へ</button>
      <button class="btn" data-stack="back" title="いちばん後ろに下げる(${k}Shift+[)">⇊ 最背面へ</button><button class="btn" data-stack="down" title="1 つ後ろに下げる(${k}[)">↓ 1 つ後ろへ</button></div></div>`;
    if (shapesSel.every(i => i.type === "trap")) {
      const dir = same("trapDir") || "", ins = shapesSel.every(i => (i.inset ?? 0.2) === (one.inset ?? 0.2)) ? one.inset ?? 0.2 : 0.2;
      h += `<div class="sec"><h4>短い辺</h4>${seg("trapdir", [["top", "上"], ["bottom", "下"], ["left", "左"], ["right", "右"]], dir)}
        <div style="margin-top:8px" class="row"><span style="font-size:12px;color:var(--muted)" title="右にするほど短い辺が短くなります">縮め方</span>
        <input type="range" class="slider" id="p_inset" min="0" max="0.45" step="0.05" value="${ins}"></div></div>`;
    }
    if (shapesSel.every(i => i.type === "poly"))
      h += `<div class="sec"><h4>角の数</h4><div class="stepper"><button id="sides_minus">−</button><input type="number" id="p_sides" min="3" max="12" value="${same("sides")}"><button id="sides_plus">＋</button></div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:5px">3 で三角形、4 でひし形、6 で六角形</div></div>`;
    if (shapesSel.length === 1 && one.type === "gate")
      h += `<div class="sec"><h4>ゲートの種類</h4><select id="p_gate" style="width:100%">${Object.entries(GATE_NAMES).map(([v, l]) => `<option value="${v}" ${v === one.kind ? "selected" : ""}>${l}</option>`).join("")}</select></div>`
         + (["not", "buf", "dff"].includes(one.kind) ? "" : `<div class="sec"><h4>入力の数</h4><div class="stepper"><button id="nin_minus" title="入力を 1 本減らす">−</button><input type="number" id="p_nin" min="2" max="8" value="${gateIns(one)}"><button id="nin_plus" title="入力を 1 本増やす">＋</button></div></div>`);
  }
  if (edgesSel.length && !edgesSel.some(isWire)) {
    const arrows = edgesSel.every(e => e.arrow === edgesSel[0].arrow) ? edgesSel[0].arrow : "";
    h += `<div class="sec"><h4>矢印</h4>${seg("arrow", [["none", sicon("arrowNone"), "矢印なし"], ["end", sicon("arrowEnd"), "終点に矢印"], ["both", sicon("arrowBoth"), "両端に矢印"]], arrows)}`;
    const heads = edgesSel.filter(e => e.arrow !== "none");
    if (heads.length) {
      const hd = heads.every(e => (e.head === "fill") === (heads[0].head === "fill")) ? (heads[0].head === "fill" ? "fill" : "open") : "";
      h += `<div style="height:6px"></div>${seg("head", [["open", sicon("headOpen") + " 開いた形", "線 2 本の矢じり"], ["fill", sicon("headFill") + " 三角", "塗りつぶした三角の矢じり"]], hd)}`;
    }
    h += `</div>`;
    if (edgesSel.length === 1) {
      h += `<div class="sec"><h4>線の形</h4>${seg("style", [["straight", sicon("straight"), "直線"], ["curve", sicon("curve"), "曲線"], ["elbow", sicon("elbow"), "直角"]], one.style)}</div>`;
      h += `<div class="sec grid2"><button class="btn" id="p_reverse" title="矢印の向きを反対にします">⇄ 向きを反転</button>`
         + (one.style === "curve" ? `<button class="btn" id="p_curvereset" title="曲がり方を最初の形に戻します">↺ 曲がりを戻す</button>` : `<span></span>`) + `</div>`;
    }
  }
  if (edgesSel.length === 1 && isWire(edgesSel[0])) h += `<div class="sec"><button class="btn wide" id="p_branch">⑂ この配線から分岐する</button></div>`;
  if (shapesSel.length >= 2) {
    h += `<div class="sec"><h4>整列</h4><div class="grid3">
      ${["left", "hcenter", "right", "top", "vcenter", "bottom"].map(k => `<button class="btn" data-align="${k}" title="${{ left: "左をそろえる", hcenter: "左右の中心をそろえる", right: "右をそろえる", top: "上をそろえる", vcenter: "上下の中心をそろえる", bottom: "下をそろえる" }[k]}">${aicon(k)}</button>`).join("")}
      </div>` + (shapesSel.length >= 3 ? `<div class="grid2" style="margin-top:6px">
      <button class="btn" data-align="hdist" title="横に等間隔で並べる">${aicon("hdist")} 横に等間隔</button>
      <button class="btn" data-align="vdist" title="縦に等間隔で並べる">${aicon("vdist")} 縦に等間隔</button></div>` : "") + `</div>`;
  }
  if (shapesSel.length) {
    h += `<div class="sec"><button class="btn wide" id="p_snap" title="位置と大きさをグリッドに合わせます">グリッドに合わせる</button></div>`;
  }
  h += `<div class="sec"><button class="btn wide danger" id="p_delete">削除</button></div>`;
  return h;
}
// 図形の重なりの順番を変える(線・矢印はいつも図形より前に描く)。
// 1 つずつ動かすときは、重なっている図形を 1 つ越えるまで動かす(重なっていない図形と入れ替えても見た目が変わらないため)
function restack(mode) {
  const sel = new Set(selItems().filter(isShape));
  if (!sel.size) return;
  const all = S.doc.items, pos = all.map((it, k) => isShape(it) ? k : -1).filter(k => k >= 0);
  let order = pos.map(k => all[k]);
  if (mode === "front") order = [...order.filter(i => !sel.has(i)), ...order.filter(i => sel.has(i))];
  else if (mode === "back") order = [...order.filter(i => sel.has(i)), ...order.filter(i => !sel.has(i))];
  else {
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const up = mode === "up";
    if (!up) order.reverse();
    for (let j = order.length - 1; j >= 0; j--) {        // 前の方にあるものから動かす
      const it = order[j];
      if (!sel.has(it)) continue;
      let t = j + 1;
      while (t < order.length && (sel.has(order[t]) || !hit(it, order[t]))) t++;
      if (t >= order.length) continue;
      order.splice(j, 1); order.splice(t, 0, it);
    }
    if (!up) order.reverse();
  }
  if (order.every((it, j) => all[pos[j]] === it)) return;   // もう端にある
  pushHist();
  const next = all.slice(); pos.forEach((k, j) => next[k] = order[j]); S.doc.items = next;
  commit();
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
    if (k === "dotsize") set(i => { const c = ctr(i); i.w = i.h = +v; i.x = c.x - i.w / 2; i.y = c.y - i.h / 2; });
    else if (k === "lw") set(i => i.lw = +v);
    else if (k === "head") {
      try { localStorage.setItem("diagram_head", v); } catch (e) {}
      set(i => { if (!isShape(i)) { if (v === "fill") i.head = "fill"; else delete i.head; } });
    }
    else if (k === "trapdir") set(i => { if (i.type === "trap") i.trapDir = v; });
    else if (k === "dash") set(i => i.dash = v === "1");
    else if (k === "align") set(i => { if (isShape(i)) i.align = v; });
    else if (k === "valign") set(i => { if (isShape(i)) i.valign = v; });
    else if (k === "fill") set(i => { if (isShape(i)) i.fill = v; });
    else if (k === "arrow") set(i => { if (!isShape(i) && !isWire(i)) i.arrow = v; });
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
  on("p_format", "pointerdown", e => { if (S.editing != null) e.preventDefault(); });
  on("p_format", "click", () => { if (S.editing != null) closeEditor(true); openFormatEditor(items[0]); });
  on("p_inset", "input", e => { items.forEach(i => { if (i.type === "trap") i.inset = +e.target.value; }); render(); });
  on("p_inset", "pointerdown", () => pushHist());
  on("p_inset", "change", () => commit());
  const sides = n => { n = Math.max(3, Math.min(12, n)); set(i => { if (i.type === "poly") i.sides = n; }); };
  on("sides_minus", "click", () => sides((+$("p_sides").value || 6) - 1)); on("sides_plus", "click", () => sides((+$("p_sides").value || 6) + 1));
  on("p_sides", "change", e => sides(+e.target.value || 6));
  on("p_branch", "click", () => { S.sel = []; setTool("wire"); });
  on("p_gate", "change", e => set(i => {
    const was = i.kind; i.kind = e.target.value;
    if (i.kind === "dff" && was !== "dff") { i.w = 80; i.h = 120; i.dffv = 2; }
    if (i.kind !== "dff" && was === "dff") { i.w = 120; i.h = 80; }
  }));
  const nin = n => { const g = items[0]; n = Math.max(2, Math.min(8, n)); if (!g || n === gateIns(g)) return; pushHist(); setGateInputs(g, n); commit(); };
  on("nin_minus", "click", () => nin(gateIns(items[0]) - 1)); on("nin_plus", "click", () => nin(gateIns(items[0]) + 1));
  on("p_nin", "change", e => nin(+e.target.value || 2));
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
    if (i.type === "gate") { fitGate(i); return; }   // 大きさも端子がグリッドに乗るように直す
    if (i.type === "dot") { const c = snapP(ctr(i)); i.x = c.x - i.w / 2; i.y = c.y - i.h / 2; return; }
    const g = S.doc.grid, x1 = Math.round((i.x + i.w) / g) * g, y1 = Math.round((i.y + i.h) / g) * g;
    i.x = Math.round(i.x / g) * g; i.y = Math.round(i.y / g) * g;
    i.w = Math.max(g, x1 - i.x); i.h = Math.max(g, y1 - i.y);
  }));
  document.querySelectorAll("#side [data-stack]").forEach(b => b.onclick = () => restack(b.dataset.stack));
  const lw = d => { const v = Math.round(Math.max(0.25, Math.min(20, (+$("p_lw").value || one(items).lw || 1.5) + d)) * 100) / 100; set(i => i.lw = v); };
  on("lw_minus", "click", () => lw(-0.25)); on("lw_plus", "click", () => lw(0.25));
  on("p_lw", "change", e => { const v = +e.target.value; if (v > 0) set(i => i.lw = Math.min(20, v)); });
  on("p_delete", "click", delSel);
  document.querySelectorAll("#side [data-align]").forEach(b => b.onclick = () => alignShapes(b.dataset.align));
}
const one = items => items[0] || {};
let lastPropsKey = "";
function updateUI() {
  document.querySelectorAll("#palette .tool").forEach(b => b.classList.toggle("on",
    b.dataset.tool === S.tool && (S.tool !== "gate" || b.dataset.gate === S.gateKind)));
  $("g_show").checked = S.doc.showGrid; $("g_snap").checked = S.doc.snap; $("g_edge_snap").checked = S.doc.snapEdge; $("g_size").value = String(S.doc.grid);
  $("b_undo").disabled = !S.hist.length; $("b_redo").disabled = !S.fut.length;
  $("b_dup").disabled = $("b_del").disabled = !S.sel.length;
  $("zpct").textContent = Math.round(S.zoom * 100) + "%";
  const key = JSON.stringify(selItems()) + "|" + (S.doc.underlay ? [S.doc.underlay.visible, !!S.underEdit].join() : "");
  if (key !== lastPropsKey && !S.drag) { lastPropsKey = key; $("side").innerHTML = sideHTML(selItems()); bindSide(); }
  if (S.mathErr.length) {   // 数式の書き間違いを下の帯に出す
    const er = S.mathErr[0], esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    $("hint").innerHTML = `<b style="color:var(--danger)">⚠ 数式を読めませんでした</b> ・ <code>$${esc(er.tex)}$</code>(${esc(er.msg)})。そのままの文字で表示しています。`;
    return;
  }
  if (S.tool === "select" && !S.drag && wireAt(S.mouse)) {
    $("hint").innerHTML = `<b style="color:var(--ink)">選択</b> ・ つながっていない線はそのまま移動、つながっている線はスライドして伸び縮み(⌥ を押しながらなら外して移動)。<b>この線から分岐するには、左の「配線」を選んで線の上をクリック</b>(緑の輪が出ます)`; return;
  }
  const t = TOOLS.find(t => t[0] === S.tool) || TOOLS[0];
  const name = S.tool === "gate" ? GATE_NAMES[S.gateKind || "and"] : TOOL_LABEL[S.tool];
  if (S.underEdit) { $("hint").innerHTML = `<b style="color:var(--ink)">下絵の調整</b> ・ 下絵をドラッグで移動、右下の角で拡大縮小。終わったら右の「✓ 調整を終える」`; return; }
  if (S.wdraft) { $("hint").innerHTML = `<b style="color:var(--ink)">配線</b> ・ 行き先(端子・接続点・配線の途中)をクリック。何もない所をクリックするとそこを通ります。ダブルクリックでその場で終わり、Esc でやめる`; return; }
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
    if (d.kind === "seg") return setCursor(d.curve ? "grabbing" : d.horiz ? "ns-resize" : "ew-resize");
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
let resizeT = null;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 100); });
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
// 開いた図を、今の形にそろえる(前の形の配線・ゲートを直し、つながりを整える)
function tidyLoaded() {
  fixDoc();
  detachWireEnds(); autoAttach(); normalizeWires(true); restructureWires();
}

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
  tidyLoaded();
  Object.assign(S, { sel: [], hist: [], fut: [], draft: null, wdraft: null, drag: null, underEdit: false });
  lastPropsKey = "";
  render();
  $("wrap").scrollLeft = $("wrap").scrollTop = 0;
}
// 一時保存から戻すときや、別の図を取り込むとき:今の図と入れ替える(⌘Z で入れ替える前に戻れる)
export function replaceDoc(doc) {
  closeEditor(true);
  pushHist();
  S.doc = clone(doc);
  tidyLoaded();
  S.sel = []; S.draft = null; S.wdraft = null; lastPropsKey = "";
  commit();
}
export const getDoc = () => S.doc;
export const getPrims = () => buildPrims();
export { zoomFit };
