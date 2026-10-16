// 書き出す前に、仕上がりの見本を小窓で見せる。形式はその場で選び直せる。
// 「保存する」を押したときだけ、ファイルを保存する。

import { buildSVG, exportPNG, exportSVG, exportPDF, safeName } from "./export.js";
import { $, esc, dialog } from "./ui.js";

const FORMATS = {
  pdf: { label: "PDF", use: "LaTeX に入れるならこれ。拡大しても荒れません", run: exportPDF },
  png: { label: "PNG", use: "Word や PowerPoint に貼るとき(300 dpi の画像)", run: exportPNG },
  svg: { label: "SVG", use: "拡大しても荒れません。あとで手直しするとき", run: exportSVG },
};
const cm = pt => (pt / 72 * 2.54).toFixed(1);

// fmt:最初に選んでおく形式、note:見本の下に出す説明(省略可)、onShown:見本の準備ができて小窓を出すときに呼ぶ
export async function exportWithPreview(fmt, prims, name, box, note = "", onShown = () => {}) {
  const r = await buildSVG(prims, box);   // 書き出すものと同じ絵(文字は線にしたもの)
  onShown();
  if (!r) return false;
  const url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
  const base = safeName(name);
  let cur = FORMATS[fmt] ? fmt : "pdf";
  const body = `<div class="xprev"><img src="${url}" alt="書き出す図の見本"></div>
    <div class="seg xfmt">${Object.entries(FORMATS).map(([k, f]) => `<button data-f="${k}">${f.label}</button>`).join("")}</div>
    <table class="xinfo">
      <tr><th>ファイル名</th><td id="x_fname"></td></tr>
      <tr><th>大きさ</th><td>${cm(r.w)} × ${cm(r.h)} cm<span id="x_px"></span></td></tr>
      <tr><th>使い道</th><td id="x_use"></td></tr>
    </table>` + (note ? `<p class="sub" style="margin:8px 0 0">${esc(note)}</p>` : "");
  const answer = dialog("書き出す前の確認", body,
    [{ label: "やめる", value: false }, { label: "⬇ 保存する", cls: "primary", value: true }]);
  $("dlg").classList.add("wide");
  const update = () => {
    $("dlg_b").querySelectorAll(".xfmt button").forEach(b => b.classList.toggle("on", b.dataset.f === cur));
    $("x_fname").textContent = `${base}.${cur}`;
    $("x_px").textContent = cur === "png" ? `(${Math.ceil(r.w * 300 / 72)} × ${Math.ceil(r.h * 300 / 72)} ピクセル)` : "";
    $("x_use").textContent = FORMATS[cur].use;
  };
  $("dlg_b").querySelectorAll(".xfmt button").forEach(b => b.onclick = () => { cur = b.dataset.f; update(); });
  update();
  const ok = await answer;
  $("dlg").classList.remove("wide");
  URL.revokeObjectURL(url);
  if (!ok) return false;
  await FORMATS[cur].run(prims, name, box);
  return true;
}
