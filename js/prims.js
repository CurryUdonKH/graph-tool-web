// 「描く図形の一覧(prims)」を SVG にする。作図・散布図・書き出しで共通。
//   { k: "ellipse", cx, cy, rx, ry }   { k: "rect", x, y, w, h }   { k: "path", cmds: [["M", x, y], ["L", ...], ["C", ...], ["Z"]] }
//   どれも lw(線の太さ)、stroke(線の色、なしは "none"。省略で黒)、fill(塗り。省略でなし)、dash(点線)を持てる
//   { k: "text", x, y, s, size, ha, va, color, rot, font }   rot は (x, y) を中心に回す角度(度)、font は text.js の FONTS の名前
// 単位は pt(画面では 1 px)。

import { layout, textMarkup, textOutlineMarkup } from "./text.js";

const f2 = v => Math.round(v * 100) / 100;
export const dStr = cmds => cmds.map(c => c[0] + c.slice(1).map(f2).join(" ")).join(" ");

// 曲線を細かい点にする(はみ出しの範囲を調べる・当たり判定に使う)
export function pathPoints(cmds) {
  const pts = []; let cur = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c[0] === "M" || c[0] === "L") { cur = { x: c[1], y: c[2] }; pts.push(cur); }
    else if (c[0] === "Q" || c[0] === "C") {
      const p0 = cur, q = c[0] === "Q";
      for (let t = 0.05; t <= 1.0001; t += 0.05) {
        const u = 1 - t;
        pts.push(q ? { x: u * u * p0.x + 2 * u * t * c[1] + t * t * c[3], y: u * u * p0.y + 2 * u * t * c[2] + t * t * c[4] }
                   : { x: u ** 3 * p0.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5],
                       y: u ** 3 * p0.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6] });
      }
      cur = q ? { x: c[3], y: c[4] } : { x: c[5], y: c[6] };
    }
  }
  return pts;
}

// 文字が占める四角の 4 つの角(回転も考える)
function textCorners(p) {
  const b = layout(p.s, p.size, p.ha, p.va, p.font, p.styles).box;
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
  const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => ({ x: p.x + x * c - y * s, y: p.y + x * s + y * c }));
}

// 描いたものが入る範囲(線の太さも含む)
export function primsBounds(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, pad = 0) => { x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad); x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad); };
  for (const p of prims) {
    const pad = p.stroke === "none" ? 0 : (p.lw || 0) / 2;
    if (p.k === "ellipse") { add(p.cx - p.rx, p.cy - p.ry, pad); add(p.cx + p.rx, p.cy + p.ry, pad); }
    else if (p.k === "rect") { add(p.x, p.y, pad); add(p.x + p.w, p.y + p.h, pad); }
    else if (p.k === "path") for (const q of pathPoints(p.cmds)) add(q.x, q.y, pad);
    else if (p.k === "text") for (const q of textCorners(p)) add(q.x, q.y);
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// outline = true なら文字を輪郭の線にする(書き出し用。先に text.js の ready() を待つこと)
export function primsMarkup(prims, outline = false) {
  let h = "";
  for (const p of prims) {
    if (p.k === "text") {
      const L = layout(p.s, p.size, p.ha, p.va, p.font, p.styles);
      h += (outline ? textOutlineMarkup : textMarkup)(L, p.x, p.y, p.color || "#000", p.rot || 0);
      continue;
    }
    const stroke = p.stroke || "#000";
    const st = stroke === "none" ? `stroke="none"` :
      `stroke="${stroke}" stroke-width="${p.lw}" stroke-linecap="${p.cap || "round"}" stroke-linejoin="round"`
      + (p.dash ? ` stroke-dasharray="${typeof p.dash === "string" ? p.dash : `${f2(p.lw * 5)} ${f2(p.lw * 3)}`}"` : "");
    const fill = ` fill="${p.fill || "none"}"`;
    if (p.k === "ellipse") h += `<ellipse cx="${f2(p.cx)}" cy="${f2(p.cy)}" rx="${f2(p.rx)}" ry="${f2(p.ry)}" ${st}${fill}/>`;
    else if (p.k === "rect") h += `<rect x="${f2(p.x)}" y="${f2(p.y)}" width="${f2(p.w)}" height="${f2(p.h)}" ${st}${fill}/>`;
    else if (p.k === "path") h += `<path d="${dStr(p.cmds)}" ${st}${fill}/>`;
  }
  return h;
}
