// 書き出す前に、仕上がりの見本を小窓で見せる。形式と保存先はその場で選べる。
// 「保存する」を押したときだけ、ファイルを保存する。
// 保存先(Chrome・Edge だけ):ダウンロード / 決めたフォルダ(同じ名前は上書き)/ 毎回選ぶ。
// Safari・Firefox では、これまでどおりダウンロードに保存する。

import { buildSVG, makeBlob, download, safeName, MIME } from "./export.js";
import * as store from "./store.js";
import { $, esc, dialog, toast } from "./ui.js";

const FORMATS = {
  pdf: { label: "PDF", use: "LaTeX に入れるならこれ。拡大しても荒れません" },
  png: { label: "PNG", use: "Word や PowerPoint に貼るとき(300 dpi の画像)" },
  svg: { label: "SVG", use: "拡大しても荒れません。あとで手直しするとき" },
};
const canPick = "showDirectoryPicker" in window && "showSaveFilePicker" in window;
const cm = pt => (pt / 72 * 2.54).toFixed(1);
// 前回の形式と保存先(このブラウザだけで覚える小さな設定)
const pref = {
  get: (k, d) => { try { return localStorage.getItem(`export_${k}`) || d; } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(`export_${k}`, v); } catch (e) {} },
};

// fmt:最初に選んでおく形式(省略すると前回の形式)、note:見本の下に出す説明、onShown:小窓を出すときに呼ぶ
export async function exportWithPreview(fmt, prims, name, box, note = "", onShown = () => {}) {
  const r = await buildSVG(prims, box);   // 書き出すものと同じ絵(文字は線にしたもの)
  let dir = null;
  if (canPick) { try { dir = (await store.getSetting("exportDir")) || null; } catch (e) {} }
  onShown();
  if (!r) return false;
  const url = URL.createObjectURL(new Blob([r.svg], { type: MIME.svg }));
  const base = safeName(name);
  let cur = FORMATS[fmt] ? fmt : pref.get("fmt", "pdf");
  if (!FORMATS[cur]) cur = "pdf";
  let dest = canPick ? pref.get("dest", "download") : "download";
  if (dest === "folder" && !dir) dest = "download";

  const body = `<div class="xprev"><img src="${url}" alt="書き出す図の見本"></div>
    <div class="xrow"><span class="xlbl">形式</span><div class="seg xfmt">${Object.entries(FORMATS).map(([k, f]) => `<button data-f="${k}">${f.label}</button>`).join("")}</div></div>` +
    (canPick ? `<div class="xrow"><span class="xlbl">保存先</span><div class="seg xdest">
      <button data-d="download">ダウンロード</button><button data-d="folder" id="x_folder"></button><button data-d="ask">毎回選ぶ</button></div>
      <button class="linkbtn" id="x_rechoose">別のフォルダにする</button></div>` : "") +
    `<table class="xinfo">
      <tr><th>ファイル名</th><td id="x_fname"></td></tr>
      <tr><th>大きさ</th><td>${cm(r.w)} × ${cm(r.h)} cm<span id="x_px"></span></td></tr>
      <tr><th>保存先</th><td id="x_where"></td></tr>
      <tr><th>使い道</th><td id="x_use"></td></tr>
    </table>` + (note ? `<p class="sub" style="margin:8px 0 0">${esc(note)}</p>` : "");
  const answer = dialog("書き出す", body, [{ label: "やめる", value: false }, { label: "⬇ 保存する", cls: "primary", value: true }]);
  $("dlg").classList.add("wide");

  const update = () => {
    $("dlg_b").querySelectorAll(".xfmt button").forEach(b => b.classList.toggle("on", b.dataset.f === cur));
    $("dlg_b").querySelectorAll(".xdest button").forEach(b => b.classList.toggle("on", b.dataset.d === dest));
    if ($("x_folder")) $("x_folder").textContent = dir ? `📁 ${dir.name}` : "📁 フォルダを選ぶ…";
    if ($("x_rechoose")) $("x_rechoose").hidden = !(dest === "folder" && dir);
    $("x_fname").textContent = `${base}.${cur}`;
    $("x_px").textContent = cur === "png" ? `(${Math.ceil(r.w * 300 / 72)} × ${Math.ceil(r.h * 300 / 72)} ピクセル)` : "";
    $("x_where").textContent = dest === "folder" ? `「${dir.name}」フォルダ(同じ名前のファイルは上書きします)`
      : dest === "ask" ? "保存するときに、場所と名前を選びます" : "ダウンロードフォルダ";
    $("x_use").textContent = FORMATS[cur].use;
  };
  // フォルダを選ぶ(ボタンを押したその場で、Chrome のフォルダ選びの画面を出す)
  const chooseFolder = async () => {
    try {
      dir = await window.showDirectoryPicker({ id: "graph-tool-export", mode: "readwrite" });
      try { await store.setSetting("exportDir", dir); } catch (e) {}
      dest = "folder";
    } catch (e) { /* やめたときは何もしない */ }
    update();
  };
  $("dlg_b").querySelectorAll(".xfmt button").forEach(b => b.onclick = () => { cur = b.dataset.f; update(); });
  $("dlg_b").querySelectorAll(".xdest button").forEach(b => b.onclick = () => {
    if (b.dataset.d === "folder" && !dir) return chooseFolder();
    dest = b.dataset.d; update();
  });
  if ($("x_rechoose")) $("x_rechoose").onclick = chooseFolder;
  update();

  const ok = await answer;
  $("dlg").classList.remove("wide");
  URL.revokeObjectURL(url);
  if (!ok) return false;
  pref.set("fmt", cur); if (canPick) pref.set("dest", dest);
  const filename = `${base}.${cur}`;

  // 保存先の許可・場所を先に決める(ボタンを押した直後でないと、ブラウザが聞いてくれないため)
  let handle = null, where = "";
  if (dest === "folder") {
    let perm = await dir.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await dir.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") { toast("フォルダへの保存が許可されなかったので、ダウンロードに保存します"); }
    else {
      let existed = false;
      try { await dir.getFileHandle(filename); existed = true; } catch (e) {}
      handle = await dir.getFileHandle(filename, { create: true });
      where = `「${dir.name}」フォルダに ${filename} を${existed ? "上書き" : ""}保存しました`;
    }
  } else if (dest === "ask") {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: filename, id: "graph-tool-export",
        types: [{ description: FORMATS[cur].label, accept: { [MIME[cur]]: [`.${cur}`] } }] });
      where = `${handle.name} を保存しました`;
    } catch (e) { if (e && e.name === "AbortError") return false; throw e; }
  }
  const blob = await makeBlob(cur, r);
  if (handle) {
    const w = await handle.createWritable();
    await w.write(blob); await w.close();
    toast(`💾 ${where}`);
  } else download(blob, filename);
  return true;
}
