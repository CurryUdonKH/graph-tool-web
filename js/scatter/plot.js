// 散布図を「描く図形の一覧(prims)」にする。画面表示も書き出しも、これを描く(prims.js)。
// 見た目は手元版(matplotlib の設定)に合わせている:上と右の枠なし、目盛りは外向き、グリッドは薄い灰色。

import { layout } from "../text.js";

// 色は順番固定(1 番目=青, 2 番目=オレンジ, 3 番目=緑系 ...)。色覚の多様性に配慮した並び
export const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"];

const AXIS_COLOR = "#888888", GRID_COLOR = "#e5e5e5", TICK = 3.5, MINOR_TICK = 2;
const MS = Math.sqrt(45);     // 点の大きさ(matplotlib の s=45 と同じ面積)
const MINUS = "−";

// ---------------------------------------------------------------- 点の形
export function markerPrim(kind, x, y, color, hollow, ms = MS) {
  const style = hollow ? { fill: "#ffffff", stroke: color, lw: 1.2 } : { fill: color, stroke: "#ffffff", lw: 1.2 };
  const r = ms / 2;
  if (kind === "o") return { k: "ellipse", cx: x, cy: y, rx: r, ry: r, ...style };
  const poly = pts => ({ k: "path", cmds: [...pts.map((p, i) => [i ? "L" : "M", x + p[0], y + p[1]]), ["Z"]], ...style, cap: "butt" });
  const star = (n, ro, ri, rot) => Array.from({ length: n * 2 }, (_, i) => {
    const a = rot + i * Math.PI / n, rr = i % 2 ? ri : ro;
    return [rr * Math.cos(a), rr * Math.sin(a)];
  });
  const plus = (w, l, rot) => {      // 太い十字(w = 腕の半分の太さ、l = 腕の長さ)
    const base = [[-w, -l], [w, -l], [w, -w], [l, -w], [l, w], [w, w], [w, l], [-w, l], [-w, w], [-l, w], [-l, -w], [-w, -w]];
    const c = Math.cos(rot), s = Math.sin(rot);
    return base.map(([px, py]) => [px * c - py * s, px * s + py * c]);
  };
  switch (kind) {
    case "s": { const h = r * 0.88; return poly([[-h, -h], [h, -h], [h, h], [-h, h]]); }
    case "^": return poly([[0, -r * 1.15], [r * 1.05, r * 0.65], [-r * 1.05, r * 0.65]]);
    case "v": return poly([[0, r * 1.15], [r * 1.05, -r * 0.65], [-r * 1.05, -r * 0.65]]);
    case "D": { const h = r * 1.15; return poly([[0, -h], [h, 0], [0, h], [-h, 0]]); }
    case "P": return poly(plus(r * 0.38, r * 1.05, 0));
    case "X": return poly(plus(r * 0.36, r * 1.15, Math.PI / 4));
    case "*": return poly(star(5, r * 1.3, r * 0.55, -Math.PI / 2));
    default: return { k: "ellipse", cx: x, cy: y, rx: r, ry: r, ...style };
  }
}

// ---------------------------------------------------------------- 範囲と目盛り
// データが全部入る範囲(5% の余白つき。対数は 1.5 倍の余白)
export function dataRange(values, log) {
  let v = values.filter(Number.isFinite);
  if (log) v = v.filter(x => x > 0);
  if (!v.length) return log ? [1, 10] : [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  if (log) return [lo / 1.5, hi * 1.5];
  const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 1;
  return [lo - pad, hi + pad];
}

function linearTicks(lo, hi, maxN) {
  const span = hi - lo;
  if (!(span > 0)) return { ticks: [lo], step: 1 };
  const raw = span / maxN, mag = 10 ** Math.floor(Math.log10(raw));
  let step = mag * 10;
  for (const m of [1, 2, 2.5, 5, 10]) {
    const s = m * mag;
    if (Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1 <= maxN + 1) { step = s; break; }
  }
  const ticks = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) {
    const v = k * step;
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, step };
}

const fixMinus = s => s.replace(/^-/, MINUS);
function fracDigits(v) {     // 小数点以下に何桁あるか(誤差を丸めて)
  const s = String(parseFloat(v.toPrecision(12)));
  if (s.includes("e")) { const [m, e] = s.split("e"); return Math.max(0, (m.split(".")[1] || "").length - Number(e)); }
  return (s.split(".")[1] || "").length;
}
// 有効数字 n 桁で、指数を使わずに書く(例:n=3 で 1.20、0.00450、1230)
export function sigFormat(v, n) {
  if (v === 0) return "0";
  const d = n - 1 - Math.floor(Math.log10(Math.abs(v)));
  if (d >= 0) return v.toFixed(Math.min(d, 20));
  const k = 10 ** -d;
  return String(Math.round(v / k) * k);
}

// 1 本の軸の目盛りを決める。o = { log, fmt: "auto"|"dec"|"sig", digits }, sci = 指数表記(× 10ⁿ)
function axisTicks(lo, hi, o, sci, maxN) {
  if (o.log) {
    const k0 = Math.ceil(Math.log10(lo) - 1e-9), k1 = Math.floor(Math.log10(hi) + 1e-9);
    const major = [], minor = [];
    if (k1 - k0 >= 1) {
      // 10ⁿ の目盛り。桁が多すぎるときは間引く
      const every = Math.max(1, Math.ceil((k1 - k0 + 1) / maxN));
      for (let k = k0; k <= k1; k++) if ((k - k0) % every === 0) major.push({ v: 10 ** k, s: `$10^{${k}}$` });
      for (let k = Math.floor(Math.log10(lo)); k <= k1; k++)
        for (let m = 2; m <= 9; m++) { const v = m * 10 ** k; if (v >= lo && v <= hi) minor.push(v); }
    } else {
      // 1 桁の中に収まるとき:1, 2, 5 × 10ⁿ に数字を書く
      for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++)
        for (let m = 1; m <= 9; m++) {
          const v = m * 10 ** k;
          if (v < lo * (1 - 1e-9) || v > hi * (1 + 1e-9)) continue;
          if ([1, 2, 5].includes(m)) major.push({ v, s: fixMinus(String(parseFloat(v.toPrecision(6)))) }); else minor.push(v);
        }
    }
    return { major, minor, offset: "" };
  }
  const { ticks, step } = linearTicks(lo, hi, maxN);
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi));
  const oom = maxAbs ? Math.floor(Math.log10(maxAbs)) : 0;
  const useSci = (sci || (o.fmt === "auto" && (oom >= 6 || oom <= -5))) && oom !== 0;
  if (useSci) {
    const k = 10 ** oom;
    const dec = o.fmt === "dec" ? o.digits : o.fmt === "sig" ? Math.max(o.digits - 1, 0)   // 10ⁿ の前の数字は 1〜10 なので、有効数字 n 桁 = 小数点以下 n−1 桁
      : Math.max(0, ...ticks.map(v => fracDigits(v / k)));
    return { major: ticks.map(v => ({ v, s: fixMinus((v / k).toFixed(dec)) })), minor: [], offset: `$\\times 10^{${oom}}$` };
  }
  let fmt;
  if (o.fmt === "dec") fmt = v => v.toFixed(o.digits);
  else if (o.fmt === "sig") fmt = v => sigFormat(v, o.digits);
  else { const dec = Math.max(0, ...ticks.map(fracDigits)); fmt = v => v.toFixed(Math.min(dec, 20)); }
  return { major: ticks.map(v => ({ v, s: fixMinus(fmt(v)) })), minor: [], offset: "" };
}

// ---------------------------------------------------------------- 線を枠の中だけにする
function clipPolyline(pts, b) {
  const out = []; let cur = [];
  const inside = p => p.x >= b.x - 1e-6 && p.x <= b.x + b.w + 1e-6 && p.y >= b.y - 1e-6 && p.y <= b.y + b.h + 1e-6;
  for (let i = 1; i < pts.length; i++) {
    let p = pts[i - 1], q = pts[i];
    // Liang–Barsky
    let t0 = 0, t1 = 1; const dx = q.x - p.x, dy = q.y - p.y; let ok = true;
    for (const [pp, qq] of [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]]) {
      if (Math.abs(pp) < 1e-12) { if (qq < 0) { ok = false; break; } continue; }
      const r = qq / pp;
      if (pp < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const a = { x: p.x + dx * t0, y: p.y + dy * t0 }, c = { x: p.x + dx * t1, y: p.y + dy * t1 };
    if (!cur.length) cur.push(a);
    cur.push(c);
    if (t1 < 1 && !inside(q)) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- 線の種類(白黒印刷で区別する)
// matplotlib の "-", "--", "-.", ":" と同じ長さの比(線の太さ倍)
export const DASHES = { solid: "", dashed: [3.7, 1.6], dashdot: [6.4, 1.6, 1, 1.6], dotted: [1, 1.65] };
export const LINESTYLES = ["solid", "dashed", "dashdot", "dotted", "solid", "dashed", "dashdot", "dotted"];
const dashFor = (name, lw) => { const d = DASHES[name]; return d ? d.map(v => Math.round(v * lw * 100) / 100).join(" ") : ""; };

// ---------------------------------------------------------------- 全体
// opt = { W, H, fontSize, font, report, series, fits, xlabel, ylabel, title, legend, grid, sci, axes: { x: { log, range, fmt, digits }, y: {...} } }
//   report = true:四方を黒い枠で囲み、目盛りは内向きで上下左右に付ける見た目(今は使っていない)。false:散布図(上と右の枠なし、目盛りは外向き)
//   series: [{ xs, ys, label, color, marker(なしは null), inside(白抜きにしない点は true), line(なし/"solid"/"dashed"...), yerr, mfc(点の中の色), ms }]
//   fits:   [{ slope, intercept, x0, x1, color, dash, lw }]
export function buildScatter(opt) { return buildPlot(opt); }
export function buildPlot(opt) {
  const fs = opt.fontSize || 11, W = opt.W || 504, H = opt.H || 331, font = opt.font || "gothic", report = !!opt.report;
  const axisColor = report ? "#000000" : AXIS_COLOR, axisLw = report ? 1.0 : 0.8;
  const prims = [];
  const T = (o) => prims.push({ k: "text", size: fs, font, ...o });
  const ax = { x: opt.axes.x, y: opt.axes.y };
  const allX = opt.series.flatMap(s => s.xs);
  const allY = opt.series.flatMap(s => s.yerr ? s.ys.flatMap((y, i) => Number.isFinite(s.yerr[i]) ? [y - Math.abs(s.yerr[i]), y + Math.abs(s.yerr[i])] : [y]) : s.ys);
  const lim = {
    x: ax.x.range || dataRange(allX, ax.x.log),
    y: ax.y.range || dataRange(allY, ax.y.log),
  };
  const lineH = fs * 1.25;
  const tickOut = report ? 0 : TICK;          // 外向きの目盛りの分だけ、数字を離す
  const gap = report ? 3.5 : 3;
  // 目盛りの数は軸の長さで決める(先に大まかな長さで)
  const tx = axisTicks(lim.x[0], lim.x[1], ax.x, opt.sci, Math.max(3, Math.min(9, Math.round((W - 90) / (fs * 4.5)))));
  const ty = axisTicks(lim.y[0], lim.y[1], ax.y, opt.sci, Math.max(3, Math.min(9, Math.round((H - 70) / (fs * 3.2)))));
  const box = s => layout(s, fs, "center", "center", font).box;
  const yTickW = Math.max(0, ...ty.major.map(t => box(t.s).w));
  const xTickH = Math.max(lineH, ...tx.major.map(t => box(t.s).h));
  const ylabH = opt.ylabel ? box(opt.ylabel).h : 0, xlabH = opt.xlabel ? box(opt.xlabel).h : 0;
  const titleH = opt.title ? layout(opt.title, fs * 1.2, "center", "center", font).box.h : 0;
  const offH = ty.offset ? lineH : 0;
  const lastX = tx.major.length ? box(tx.major[tx.major.length - 1].s).w : 0;
  const left = 6 + (ylabH ? ylabH + 6 : 0) + yTickW + gap + tickOut;
  const bottom = 4 + (xlabH ? xlabH + 4 : 0) + xTickH + gap + tickOut + (tx.offset ? lineH : 0);
  const top = 8 + (titleH ? titleH + 8 : 0) + Math.max(offH, lineH / 2);
  const right = 10 + Math.max(lastX / 2, 0);
  const P = { x: left, y: top, w: Math.max(40, W - left - right), h: Math.max(40, H - top - bottom) };

  const map = (a, v) => {
    const [lo, hi] = lim[a], log = ax[a].log;
    const t = log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo);
    return a === "x" ? P.x + t * P.w : P.y + P.h - t * P.h;
  };
  const inRange = (a, v) => Number.isFinite(v) && (!ax[a].log || v > 0) && v >= Math.min(...lim[a]) - 1e-12 * Math.abs(lim[a][1]) && v <= Math.max(...lim[a]) + 1e-12 * Math.abs(lim[a][1]);
  const pathOf = pts => pts.map((p, i) => [i ? "L" : "M", p.x, p.y]);

  // グリッド
  if (opt.grid) {
    for (const t of tx.major) if (inRange("x", t.v)) { const x = map("x", t.v); prims.push({ k: "path", cmds: [["M", x, P.y], ["L", x, P.y + P.h]], lw: 0.8, stroke: GRID_COLOR, cap: "butt" }); }
    for (const t of ty.major) if (inRange("y", t.v)) { const y = map("y", t.v); prims.push({ k: "path", cmds: [["M", P.x, y], ["L", P.x + P.w, y]], lw: 0.8, stroke: GRID_COLOR, cap: "butt" }); }
  }
  // 近似直線(点より後ろ)
  const linePts = [];
  for (const f of opt.fits || []) {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const xv = ax.x.log ? 10 ** (Math.log10(f.x0) + (Math.log10(f.x1) - Math.log10(f.x0)) * i / 200) : f.x0 + (f.x1 - f.x0) * i / 200;
      const yv = f.intercept + f.slope * xv;
      if (ax.y.log && yv <= 0) { pts.push(null); continue; }
      pts.push({ x: map("x", xv), y: map("y", yv) });
    }
    // 対数で 0 以下になる所は線を切る
    const runs = [[]];
    for (const p of pts) { if (p) runs[runs.length - 1].push(p); else if (runs[runs.length - 1].length) runs.push([]); }
    const lw = f.lw || 1.5;
    for (const run of runs) for (const seg of clipPolyline(run, P)) {
      prims.push({ k: "path", cmds: pathOf(seg), lw, stroke: f.color, cap: "butt", dash: f.dash ? dashFor(f.dash, lw) : "" });
      linePts.push(...seg);
    }
  }
  // データの線・誤差棒・点
  const placed = [];
  opt.series.forEach(s => {
    const vis = [];
    for (let i = 0; i < s.xs.length; i++) {
      const xv = s.xs[i], yv = s.ys[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || (ax.x.log && xv <= 0) || (ax.y.log && yv <= 0)) continue;
      vis.push({ i, x: map("x", xv), y: map("y", yv) });
    }
    if (s.line) {
      const lw = s.lw || 1.5;
      for (const seg of clipPolyline(vis, P)) {
        prims.push({ k: "path", cmds: pathOf(seg), lw, stroke: s.color, cap: s.line === "solid" ? "round" : "butt", dash: dashFor(s.line, lw) });
        linePts.push(...seg);
      }
    }
    if (s.yerr) for (const v of vis) {
      const e = Math.abs(s.yerr[v.i]);
      if (!Number.isFinite(e) || e === 0 || !inRange("x", s.xs[v.i])) continue;
      const yv = s.ys[v.i], lo = ax.y.log && yv - e <= 0 ? lim.y[0] : yv - e;
      const seg = clipPolyline([{ x: v.x, y: map("y", lo) }, { x: v.x, y: map("y", yv + e) }], P);
      for (const sg of seg) prims.push({ k: "path", cmds: pathOf(sg), lw: 1, stroke: s.color, cap: "butt" });
      for (const yy of [lo, yv + e]) if (inRange("y", yy)) { const y = map("y", yy); prims.push({ k: "path", cmds: [["M", v.x - 3, y], ["L", v.x + 3, y]], lw: 1, stroke: s.color, cap: "butt" }); }
    }
    if (s.marker) for (const v of vis) {
      if (!inRange("x", s.xs[v.i]) || !inRange("y", s.ys[v.i])) continue;
      placed.push(v);
      if (s.mfc) { const m = markerPrim(s.marker, v.x, v.y, s.color, false, s.ms || 6); m.fill = s.mfc; m.stroke = s.color; m.lw = 1; prims.push(m); }
      else prims.push(markerPrim(s.marker, v.x, v.y, s.color, s.inside && !s.inside[v.i]));
    } else placed.push(...vis.filter(v => v.x >= P.x && v.x <= P.x + P.w && v.y >= P.y && v.y <= P.y + P.h));
  });
  // 枠と目盛り
  const axisLine = cmds => prims.push({ k: "path", cmds, lw: axisLw, stroke: axisColor, cap: "square" });
  if (report) prims.push({ k: "rect", x: P.x, y: P.y, w: P.w, h: P.h, lw: axisLw, stroke: axisColor });
  else {
    axisLine([["M", P.x, P.y], ["L", P.x, P.y + P.h]]);
    axisLine([["M", P.x, P.y + P.h], ["L", P.x + P.w, P.y + P.h]]);
  }
  const tick = (cmds, lw) => prims.push({ k: "path", cmds, lw, stroke: axisColor, cap: "butt" });
  // 目盛りの線:散布図は外向き(左と下)、レポート用は内向き(上下左右)
  const xTick = (x, len, lw) => {
    if (report) { tick([["M", x, P.y + P.h], ["L", x, P.y + P.h - len]], lw); tick([["M", x, P.y], ["L", x, P.y + len]], lw); }
    else tick([["M", x, P.y + P.h], ["L", x, P.y + P.h + len]], lw);
  };
  const yTick = (y, len, lw) => {
    if (report) { tick([["M", P.x, y], ["L", P.x + len, y]], lw); tick([["M", P.x + P.w, y], ["L", P.x + P.w - len, y]], lw); }
    else tick([["M", P.x, y], ["L", P.x - len, y]], lw);
  };
  const tl = report ? 1 : 0.8;
  for (const t of tx.major) {
    if (!inRange("x", t.v)) continue;
    const x = map("x", t.v);
    xTick(x, TICK, tl);
    T({ x, y: P.y + P.h + tickOut + gap, s: t.s, ha: "center", va: "top" });
  }
  for (const v of tx.minor) if (inRange("x", v)) xTick(map("x", v), MINOR_TICK, tl * 0.75);
  for (const t of ty.major) {
    if (!inRange("y", t.v)) continue;
    const y = map("y", t.v);
    yTick(y, TICK, tl);
    T({ x: P.x - tickOut - gap - 1, y, s: t.s, ha: "right", va: "center" });
  }
  for (const v of ty.minor) if (inRange("y", v)) yTick(map("y", v), MINOR_TICK, tl * 0.75);
  // × 10ⁿ(縦軸は左上、横軸は右下)
  if (ty.offset) T({ x: P.x, y: P.y - 4, s: ty.offset, ha: "left", va: "bottom" });
  if (tx.offset) T({ x: P.x + P.w, y: P.y + P.h + tickOut + gap + xTickH + 2, s: tx.offset, ha: "right", va: "top" });
  // ラベル・タイトル
  if (opt.xlabel) T({ x: P.x + P.w / 2, y: P.y + P.h + tickOut + gap + xTickH + 4 + (tx.offset ? lineH : 0), s: opt.xlabel, ha: "center", va: "top" });
  if (opt.ylabel) T({ x: P.x - tickOut - gap - 1 - yTickW - 6, y: P.y + P.h / 2, s: opt.ylabel, ha: "center", va: "bottom", rot: -90 });
  if (opt.title) T({ x: P.x + P.w / 2, y: P.y - 8 - offH, s: opt.title, size: fs * 1.2, ha: "center", va: "bottom" });

  // 凡例(点や線と重ならない場所を選ぶ)
  if (opt.legend && opt.series.length) {
    const hasLine = opt.series.some(s => s.line), sampleW = hasLine ? fs * 2 : MS + 4;
    const rowH = Math.max(lineH, MS + 4), pad = 6;
    const labW = Math.max(...opt.series.map(s => layout(s.label, fs, "left", "center", font).box.w));
    const lw = sampleW + 6 + labW, lh = rowH * opt.series.length;
    const cand = [
      [P.x + P.w - lw - pad, P.y + pad], [P.x + pad, P.y + pad], [P.x + pad, P.y + P.h - lh - pad],
      [P.x + P.w - lw - pad, P.y + P.h - lh - pad], [P.x + (P.w - lw) / 2, P.y + pad], [P.x + (P.w - lw) / 2, P.y + P.h - lh - pad],
    ];
    let best = cand[0], bestN = Infinity;
    for (const [lx, ly] of cand) {
      const hit = q => q.x >= lx - 4 && q.x <= lx + lw + 4 && q.y >= ly - 4 && q.y <= ly + lh + 4;
      const n = placed.filter(hit).length * 3 + linePts.filter(hit).length;
      if (n < bestN) { bestN = n; best = [lx, ly]; }
    }
    opt.series.forEach((s, i) => {
      const cy = best[1] + rowH * (i + 0.5), x0 = best[0], cx = x0 + sampleW / 2;
      if (s.line) prims.push({ k: "path", cmds: [["M", x0, cy], ["L", x0 + sampleW, cy]], lw: s.lw || 1.5, stroke: s.color, cap: "butt", dash: dashFor(s.line, s.lw || 1.5) });
      if (s.marker) {
        if (s.mfc) { const m = markerPrim(s.marker, cx, cy, s.color, false, s.ms || 6); m.fill = s.mfc; m.stroke = s.color; m.lw = 1; prims.push(m); }
        else prims.push(markerPrim(s.marker, cx, cy, s.color, false));
      }
      T({ x: x0 + sampleW + 6, y: cy, s: s.label, ha: "left", va: "center" });
    });
  }
  return { prims, plot: P, lim };
}
