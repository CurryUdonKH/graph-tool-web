// どのページでも使う小さな部品:お知らせ・小窓・開閉メニュー・バックアップ・数式の書き方

import * as store from "./store.js";

export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const pad = n => String(n).padStart(2, "0");
export const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
export const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const hms = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// prefix1, prefix2, … のうち、まだ使われていないいちばん小さい番号の名前(短く、LaTeX でも扱いやすい。手元版と同じ)
export function nextName(prefix, used) {
  const set = new Set(used);
  let n = 1;
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export const mdhm = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

let toastTimer = null;
export function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
// 名前の横の小さな表示(「✓ 保存済み 12:34」など)。tip はマウスを乗せたときに出る説明
export function setStatus(msg, warn, tip = "") { const s = $("d_status"); s.textContent = msg; s.title = tip; s.classList.toggle("warn", !!warn); }

// 小窓を出して、押したボタンの値を返す
export function dialog(title, bodyHTML, buttons = [{ label: "閉じる", value: null }]) {
  const d = $("dlg");
  $("dlg_t").textContent = title;
  $("dlg_b").innerHTML = bodyHTML;
  $("dlg_a").innerHTML = "";
  return new Promise(resolve => {
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = "btn" + (b.cls ? " " + b.cls : "");
      el.textContent = b.label;
      el.onclick = () => { d.close(); resolve(b.value); };
      $("dlg_a").appendChild(el);
    }
    d.onclose = () => resolve(null);
    d.showModal();
  });
}

// 開閉メニュー
export function bindPop(btnId, popId, onOpen) {
  const btn = $(btnId), pop = $(popId);
  btn.addEventListener("click", ev => {
    ev.stopPropagation();
    const open = !pop.classList.contains("open");
    closePops();
    if (open) { onOpen && onOpen(); pop.classList.add("open"); }
  });
}
export const closePops = () => document.querySelectorAll(".pop.open").forEach(p => p.classList.remove("open"));
document.addEventListener("mousedown", ev => { if (!ev.target.closest(".popwrap")) closePops(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape") closePops(); });
// メニューの項目を押したら、メニューを閉じる
document.addEventListener("click", ev => { if (ev.target.closest(".pop .item")) setTimeout(closePops, 0); });

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------------------------------------------------------------- バックアップ(作図・散布図をまとめて)
export async function backupOut() {
  const data = await store.exportBackup();
  const n = data.diagrams.length + data.graphs.length;
  if (!n) { toast("まだ保存した図やグラフがありません"); return; }
  download(new Blob([JSON.stringify(data)], { type: "application/json" }), `graph-tool-backup-${stamp()}.json`);
  toast(`⬇ 図 ${data.diagrams.length} 個・散布図 ${data.graphs.length} 個をバックアップしました`);
}
export async function backupIn(file) {
  try {
    const r = await store.importBackup(JSON.parse(await file.text()));
    dialog("バックアップを読み込みました", `<p>${r.added} 個 読み込みました。` +
      (r.skipped ? `<br>${r.skipped} 個は、こちらに同じか新しいものがあったので読み込みませんでした。` : "") + `</p><p>「開く」の一覧から選べます。</p>`);
    return true;
  } catch (e) {
    dialog("読み込めませんでした", `<p>${esc(e.message || e)}</p>`);
    return false;
  }
}

export const MATH_HELP = `
<p>文字の中で <code>$</code> と <code>$</code> で囲んだ部分が <b>数式(LaTeX の書き方)</b> になります。</p>
<table><tr><th>書くもの</th><th>表示</th></tr>
<tr><td><code>$10^{-3}$</code></td><td>指数</td></tr>
<tr><td><code>$x_1$</code>、<code>$T_{\\mathrm{max}}$</code></td><td>下付き文字</td></tr>
<tr><td><code>$\\alpha$ $\\beta$ $\\gamma$ $\\Delta$ $\\mu$ $\\Omega$</code></td><td>ギリシャ文字</td></tr>
<tr><td><code>$\\log_{10} I$</code>、<code>$\\ln x$</code>、<code>$e^{-t/\\tau}$</code></td><td>log・指数関数</td></tr>
<tr><td><code>$\\sqrt{x}$</code>、<code>$\\frac{a}{b}$</code></td><td>ルート・分数</td></tr>
<tr><td><code>$\\times$ $\\pm$ $^\\circ$ $\\leq$</code></td><td>× ± ° ≦</td></tr>
<tr><td><code>$\\overline{A}$</code>、<code>$\\bar{Q}$</code></td><td>上線(論理回路の否定など)</td></tr>
<tr><td><code>$\\mathrm{m\\,s^{-1}}$</code></td><td>立体(単位は立体で書くのが普通)</td></tr></table>
<ul><li>例:<code>電流 $I$ [$\\mu$A]</code>、<code>$\\Delta T$ [K]</code>、<code>吸光度 $\\log_{10}(I_0/I)$</code></li>
<li>日本語は <code>$</code> の外に書きます</li>
<li><code>$</code> そのものを書きたいときは <code>\\$</code> と書きます</li>
<li>書き間違いがあると知らせが出て、そのままの文字で表示されます</li></ul>`;

export const ABOUT = `
<p>作った図やグラフは、<b>このブラウザの中</b>に自動で保存されます。インターネットの向こう(サーバー)には送られません。読み込んだ Excel / CSV も同じです。</p>
<ul><li>別のパソコンや、別のブラウザ(Safari と Chrome など)では見えません</li>
<li>ブラウザの「履歴とサイトデータの消去」をすると消えることがあります</li>
<li>大事なものは、ときどき「ファイル → バックアップを書き出す」でファイルに残してください(作図と散布図がまとめて入ります)。<br>
別のパソコンでは「バックアップを読み込む」で戻せます</li></ul>`;

// 上の帯の「ファイル」「書き出す」「？」メニュー。onImported は読み込んだあとに一覧を新しくするため
export function bindMoreMenu({ beforeBackup, onImported } = {}) {
  bindPop("d_more", "p_more");
  if ($("d_file")) bindPop("d_file", "p_file");
  if ($("d_export")) bindPop("d_export", "p_export");
  $("m_math").onclick = () => { closePops(); dialog("数式の書き方", MATH_HELP); };
  $("m_about").onclick = () => { closePops(); dialog("保存について", ABOUT); };
  $("m_backup").onclick = async () => { closePops(); if (beforeBackup) await beforeBackup(); backupOut(); };
  $("m_restore").onclick = () => { closePops(); $("f_backup").click(); };
  $("f_backup").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (f && await backupIn(f) && onImported) onImported();
  };
}
