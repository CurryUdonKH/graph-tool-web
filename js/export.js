// 図を PNG / SVG / PDF に書き出す(すべてブラウザの中で行う)。
// 入力は「描く図形の一覧(prims)」(くわしくは prims.js)。
// 画面の 1 px を 1 pt として書き出す(手元版の matplotlib と同じ大きさ)。

import { ready } from "./text.js";
import { primsBounds, primsMarkup } from "./prims.js";

const MARGIN = 12;    // 描いたもののまわりの余白(pt)

const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL(src, import.meta.url).href;
    s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error(`${src} を読み込めませんでした`)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

// ファイル名に使えない記号は _ に、空白は - にする(LaTeX の \includegraphics で困らないように)
export function safeName(name, fallback = "figure") {
  return String(name || "").replace(/[\\/:*?"<>|]/g, "_").trim().replace(/\s+/g, "-") || fallback;
}

const f2 = v => Math.round(v * 100) / 100;

// 1 つの SVG ファイルとして完結した文字列を作る(文字は輪郭の線にする)
// box を渡すと、その範囲をそのまま書き出す(大きさを cm で決めた図など)。省略すると描いた範囲 + 余白
export async function buildSVG(prims, box) {
  const texts = prims.filter(p => p.k === "text");
  await ready(texts.map(p => p.s), texts.map(p => p.font || "gothic"));
  const r = box || primsBounds(prims);
  if (!r) return null;
  const b = box ? box : { x: r.x - MARGIN, y: r.y - MARGIN, w: r.w + 2 * MARGIN, h: r.h + 2 * MARGIN };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(b.w)}pt" height="${f2(b.h)}pt" viewBox="${f2(b.x)} ${f2(b.y)} ${f2(b.w)} ${f2(b.h)}">${primsMarkup(prims, true)}</svg>`;
  return { svg, w: b.w, h: b.h };
}

export const MIME = { pdf: "application/pdf", png: "image/png", svg: "image/svg+xml" };

// ダウンロードフォルダに保存する
export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 書き出すファイルの中身を作る。r は buildSVG() の結果。PNG は 300 dpi(1 pt = 300/72 ピクセル)、背景は白
export async function makeBlob(fmt, r, dpi = 300) {
  if (fmt === "svg") return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + r.svg], { type: MIME.svg });
  if (fmt === "png") {
    const k = dpi / 72, img = new Image();
    const url = URL.createObjectURL(new Blob([r.svg], { type: MIME.svg }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("画像にできませんでした")); img.src = url; });
      const c = document.createElement("canvas");
      c.width = Math.ceil(r.w * k); c.height = Math.ceil(r.h * k);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, MIME.png));
    } finally { URL.revokeObjectURL(url); }
  }
  // PDF
  await loadScript("../vendor/jspdf.umd.min.js");
  await loadScript("../vendor/svg2pdf.umd.min.js");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: [r.w, r.h], orientation: r.w > r.h ? "landscape" : "portrait", compress: true });
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-99999px;top:0;visibility:hidden";
  holder.innerHTML = r.svg;
  document.body.appendChild(holder);
  try { await pdf.svg(holder.firstElementChild, { x: 0, y: 0, width: r.w, height: r.h }); }
  finally { holder.remove(); }
  return pdf.output("blob");
}
