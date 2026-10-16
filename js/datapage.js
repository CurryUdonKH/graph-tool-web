// Excel / CSV を読み込んでグラフを作るページ(散布図)に共通の部分:
// ファイルの読み込みと ⚙ の設定、データの表、軸の設定欄、自動保存・一覧・開く・削除・書き出し。
// ページごとにちがうところ(系列の作り方・グラフ・設定欄の中身)は cfg で受け取る。

import * as store from "./store.js";
import { readRows, guessSkip, buildTable, colLetter, rangeLabel, sheetNames, isExcel, toNumber } from "./scatter/data.js";
import { dataRange } from "./scatter/plot.js";
import { primsMarkup } from "./prims.js";
import { layout, loadFont, onTextReady } from "./text.js";
import { exportWithPreview } from "./exportdialog.js";
import { $, esc, hms, hm, mdhm, nextName, toast, setStatus, dialog, bindMoreMenu } from "./ui.js";

export const clone = o => JSON.parse(JSON.stringify(o));
export const stem = name => name.replace(/\.[^.]+$/, "");
export const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("");
export const numVal = v => v == null || !Number.isFinite(v) ? "" : String(parseFloat(v.toPrecision(10)));
export const num = v => { const n = toNumber(v); return Number.isFinite(n) ? n : null; };
export const defaultAxis = () => ({ log: false, auto: true, min: null, max: null, fmt: "auto", digits: 2 });

// Python の "{:.4g}" と同じ書き方
export function g4(v) {
  if (!Number.isFinite(v)) return v == null || Number.isNaN(v) ? "—" : String(v);
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e < -4 || e >= 4) {
    let [m, ex] = v.toExponential(3).split("e");
    m = m.replace(/\.?0+$/, "");
    const n = Number(ex);
    return `${m}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  return String(Number(v.toPrecision(4)));
}

// 軸の設定から、図に渡す範囲を決める(おかしな値のときは自動にして注意を出す)
export function axisOpt(o, vals, warns, name) {
  const out = { log: o.log, fmt: o.fmt, digits: o.digits, range: null };
  if (o.log && vals.some(v => v <= 0)) warns.push(`${name}:0 以下の値は対数目盛りでは表示されません`);
  if (!o.auto) {
    if (o.min == null || o.max == null) [o.min, o.max] = dataRange(vals, o.log);
    if (!(o.min < o.max)) warns.push(`${name}:最小は最大より小さくしてください`);
    else if (o.log && o.min <= 0) warns.push(`${name}:対数目盛りでは、最小を 0 より大きくしてください`);
    else out.range = [o.min, o.max];
  }
  return out;
}

// cfg = {
//   kind: 保存の種類("graph" など)、noun: 画面での呼び名("グラフ" など)、prefix: 最初の名前の頭("plot" なら plot1、plot2 …)、lastKey: 前回開いていたものを覚える名前
//   store: { list, get, put, del }、defaultState()、fixState(st)(古い保存に足りない設定を足す)
//   computeSeries(page) → { series, warns }(series は xs, ys を持つ)
//   draw(page, series, warns, info) → { prims, W, H, box?(書き出す範囲), html?(グラフの下に出すもの) }
//   panels: { タブの名前: page => HTML }、bind(page, tab, body, series)
//   onFilesAdded(page)(省略可)
// }
export function createDataPage(cfg) {
  const page = {
    S: { id: null, seen: null, sig: null, defaultName: null, files: [], st: cfg.defaultState() },
    tab: "data", dataTab: 0, last: { prims: [], series: [] },
  };
  const sources = page.sources = () => page.S.files;
  // ファイルの中身(行の並び)。保存はせず、使うときに読み直す
  const rowsOf = async f => f._rows || (f._rows = await readRows(f, f.sheet));
  const sigOf = name => JSON.stringify([name, page.S.st, page.S.files.map(f => [f.name, f.sheet, f.skip, f.range, f.table])]);

  // ---------------------------------------------------------------- 描く
  page.renderPlot = () => {
    // ファイルを読み込むまでは、グラフの代わりに案内を出す
    const empty = !page.S.files.length;
    $("empty").hidden = !empty;
    $("plot_wrap").hidden = empty;
    if (empty) { $("warns").innerHTML = $("below").innerHTML = ""; page.last = { prims: [], series: [] }; return; }
    const { series, warns } = cfg.computeSeries(page);
    const info = [];
    const out = cfg.draw(page, series, warns, info);
    page.last = { prims: out.prims, series, box: out.box };
    const svg = $("plot");
    svg.setAttribute("viewBox", `0 0 ${out.W} ${out.H}`);
    svg.style.maxWidth = out.screenW ? out.screenW + "px" : "";
    svg.innerHTML = `<rect width="${out.W}" height="${out.H}" fill="#fff"/>` + primsMarkup(out.prims);
    for (const p of out.prims) if (p.k === "text") for (const e of layout(p.s, p.size, p.ha, p.va, p.font).errors)
      warns.push(`数式 <code>$${esc(e.tex)}$</code> を読めませんでした(${esc(e.msg)})。そのままの文字で表示しています`);
    $("warns").innerHTML = [...new Set(warns)].map(w => `<div class="w">⚠ ${w.includes("<code>") ? w : esc(w)}</div>`).join("")
      + info.map(w => `<div class="i">${esc(w)}</div>`).join("");
    $("below").innerHTML = out.html || "";
    if (out.bindBelow) out.bindBelow();
  };

  // ---------------------------------------------------------------- 右の設定欄
  page.renderPanel = () => {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === page.tab));
    const { series } = cfg.computeSeries(page);
    const body = $("tab_body"), scroll = body.scrollTop;
    body.innerHTML = cfg.panels[page.tab](page, series);
    body.scrollTop = scroll;
    if (page.tab === "data") bindFiles(body);
    if (page.tab === "axis") bindAxis(body, series);
    cfg.bind(page, page.tab, body, series);
  };

  // 変わったら:図を描き直して保存する。structure = true なら設定欄も作り直す
  page.changed = structure => {
    page.renderPlot();
    if (structure) { page.renderPanel(); renderDataTable(); }
    scheduleSave();
  };

  // 読み込みの欄と、ファイルごとの ⚙(シート・飛ばす行数・取り外し)
  page.dropHTML = () => `<div id="drop"><b>Excel / CSV をここにドラッグ</b><br>またはクリックしてファイルを選ぶ(複数可)</div>` + libraryHTML();

  // ---------------------------------------------------------------- ほかのグラフ・図で読み込んだファイルを使う
  // (手元版では、読み込んだファイルをどの画面でも使えた。その代わり)
  page.library = [];
  const fileKey = f => `${f.name}|${f.raw ? f.raw.byteLength : 0}|${f.sheet || ""}|${JSON.stringify(f.range || null)}`;
  async function loadLibrary() {
    const recs = (await store.listGraphs()).map(r => [r, "散布図"]);
    const seen = new Set(), lib = [];
    for (const [r, kind] of recs) for (const f of r.files || []) {
      const k = fileKey(f);
      if (seen.has(k)) continue;
      seen.add(k);
      lib.push({ ...f, from: `${kind}「${r.name}」` });
    }
    page.library = lib;
  }
  function libraryHTML() {
    const mine = new Set(page.S.files.map(fileKey));
    const lib = page.library.filter(f => !mine.has(fileKey(f)));
    if (!lib.length) return "";
    return `<details class="gear lib"><summary>📂 ほかのグラフ・図で読み込んだファイルを使う(${lib.length})</summary><div>
      <select id="lib_pick" style="width:100%">${lib.map((f, i) => `<option value="${i}">${esc(f.name)}(${esc(f.from)})</option>`).join("")}</select>
      <button class="btn wide" id="lib_use" style="margin-top:6px">このファイルを使う</button>
      <div class="sub" style="margin-top:4px">ファイルを選び直さなくても、前に読み込んだものをそのまま使えます(表で直した所もそのまま)。</div></div></details>`;
  }
  function useLibrary(i) {
    const mine = new Set(page.S.files.map(fileKey));
    const f = page.library.filter(x => !mine.has(fileKey(x)))[i];
    if (!f) return;
    let name = f.name, n = 2;
    while (page.S.files.some(x => x.name === name)) name = `${stem(f.name)} (${n++})${f.name.match(/\.[^.]+$/)?.[0] || ""}`;
    const item = { name, excel: f.excel, raw: f.raw, sheet: f.sheet, skip: f.skip, range: f.range || null, sheets: f.sheets || [], table: clone(f.table) };
    page.S.files.push(item);
    if (cfg.onFilesAdded) cfg.onFilesAdded(page, [name]);
    toast(`📁 「${name}」を使います`);
    page.changed(true);
  }
  page.gearHTML = (f, fi) => {
    let h = `<details class="gear"><summary>⚙ シート・飛ばす行数・取り外し</summary><div>`;
    if (f.excel && (f.sheets || []).length > 1)
      h += `<label class="fld2"><span>シート</span><select data-f="${fi}" data-k="sheet">${opts(f.sheets.map(s => [s, s]), f.sheet)}</select></label>`;
    if (f.range) h += `<div class="fld2"><span>使う範囲</span><b>${rangeLabel(f.range)}</b>(元のファイルで選んだ範囲${f.range.header ? "。1 行目が列の名前" : ""})</div>
      <div class="grid2" style="margin-bottom:8px"><button class="btn" data-f="${fi}" data-k="showraw">範囲を選び直す</button>
      <button class="btn" data-f="${fi}" data-k="unrange" title="列の名前の行を自動で探す読み方に戻します">自動に戻す</button></div>`;
    else h += `<label class="fld2"><span>上から飛ばす行数</span><input type="number" min="0" max="100" value="${f.skip || 0}" data-f="${fi}" data-k="skip"></label>
      <div class="sub" style="margin:-4px 0 8px">表の上にタイトルやメモの行があるときに増やします。列の名前が書いてある行が一番上に来るようにしてください。(変えると、表で直した所は元に戻ります)</div>
      <button class="btn wide" style="margin-bottom:8px" data-f="${fi}" data-k="showraw">元のファイルを見て、範囲を選ぶ</button>`;
    return h + `<button class="btn wide danger" data-f="${fi}" data-k="remove">このファイルを外す</button></div></details>`;
  };
  page.howtoHTML = () => `<details class="gear"><summary>📝 ファイルの作り方</summary><div class="sub">
    ・1 行目に列の名前(例:<code>時間 [s]</code>、<code>温度 [℃]</code>)<br>・2 行目から数値<br>・1 列に 1 種類のデータ<br>
    ・「1,200」や全角の数字も、自動で数値として読みます<br>・CSV の文字コード(UTF-8 / Shift_JIS)は自動で見分けます<br>
    ・表の上にタイトルやメモの行があっても、列の名前の行を自動で探します</div></details>`;

  function bindFiles(body) {
    const drop = $("drop");
    if (drop) drop.onclick = () => $("f_data").click();
    if ($("lib_use")) $("lib_use").onclick = () => useLibrary(+$("lib_pick").value);
    body.querySelectorAll("[data-k=sheet], [data-k=skip]").forEach(n => n.addEventListener("change", async e => {
      const t = e.target, f = page.S.files[+t.dataset.f];
      try {
        if (t.dataset.k === "sheet") {          // シートを変えたら、選んだ範囲はやめて、列の名前の行も探し直す
          f.sheet = t.value; f._rows = null; f.range = null;
          const rows = await rowsOf(f);
          f.skip = guessSkip(rows);
          f.table = buildTable(rows, f);
        } else {
          f.skip = Math.max(0, Math.min(100, Math.round(+t.value || 0)));
          f.table = buildTable(await rowsOf(f), f);
        }
      } catch (err) { dialog("読み込めませんでした", `<p>${esc(err.message || err)}</p>`); }
      page.changed(true);
    }));
    body.querySelectorAll("[data-k=unrange]").forEach(n => n.addEventListener("click", async e => {
      const f = page.S.files[+e.target.dataset.f], rows = await rowsOf(f);
      f.range = null; f.skip = guessSkip(rows); f.table = buildTable(rows, f);
      toast("列の名前の行を自動で探す読み方に戻しました");
      page.changed(true);
    }));
    body.querySelectorAll("[data-k=showraw]").forEach(n => n.addEventListener("click", e => showRaw(page.S.files[+e.target.dataset.f])));
    body.querySelectorAll("[data-k=remove]").forEach(n => n.addEventListener("click", e => {
      const f = page.S.files[+e.target.dataset.f];
      page.S.files = page.S.files.filter(x => x !== f);
      if (page.S.st.sel) delete page.S.st.sel[f.name];
      toast(`「${f.name}」を外しました`);
      page.changed(true);
    }));
  }

  // ---------------------------------------------------------------- 軸・目盛りの設定欄
  page.axisHTML = series => {
    const st = page.S.st;
    let h = `<label class="ck"><input type="checkbox" id="p_grid" ${st.grid ? "checked" : ""}>グリッド(目盛りの線)を表示</label>
      <label class="ck" style="margin-bottom:10px"><input type="checkbox" id="p_sci" ${st.sci ? "checked" : ""}>目盛りの数字を指数表記にする(× 10ⁿ)</label>`;
    for (const [a, name] of [["x", "横軸"], ["y", "縦軸"]]) {
      const o = st.axes[a];
      const vals = series.flatMap(s => a === "x" ? s.xs : s.ys);
      h += `<div class="card"><h4>${name}</h4>
        <div class="grid2"><label class="ck"><input type="checkbox" data-a="${a}" data-k="log" ${o.log ? "checked" : ""}>対数目盛り</label>
        <label class="ck"><input type="checkbox" data-a="${a}" data-k="auto" ${o.auto ? "checked" : ""}>範囲を自動</label></div>`;
      if (o.log && vals.some(v => v <= 0)) h += `<div class="warn">0 以下の値は対数目盛りでは表示されません</div>`;
      h += `<div class="grid2" style="grid-template-columns:3fr 2fr;margin-top:8px"><label class="fld2"><span>目盛りの数字</span>
        <select data-a="${a}" data-k="fmt">${opts([["auto", "自動"], ["dec", "小数点以下の桁数"], ["sig", "有効数字の桁数"]], o.fmt)}</select></label>
        <label class="fld2"><span>桁数</span><input type="number" min="${o.fmt === "dec" ? 0 : 1}" max="10" value="${o.digits}" data-a="${a}" data-k="digits" ${o.fmt === "auto" ? "disabled" : ""}></label></div>`;
      if (o.log && o.fmt !== "auto") h += `<div class="sub">対数目盛りでは 10ⁿ の形で表示するので、桁数の指定は使いません</div>`;
      if (!o.auto) {
        if (o.min == null || o.max == null) [o.min, o.max] = dataRange(vals, o.log);
        h += `<div class="grid2"><label class="fld2"><span>最小</span><input type="number" step="any" data-a="${a}" data-k="min" value="${numVal(o.min)}"></label>
          <label class="fld2"><span>最大</span><input type="number" step="any" data-a="${a}" data-k="max" value="${numVal(o.max)}"></label></div>
          <button class="btn" data-a="${a}" data-k="fitdata" title="最小・最大を、今のデータが全部入る範囲にします">データに合わせる</button>`;
      }
      h += `</div>`;
    }
    return h;
  };
  function bindAxis(body, series) {
    const st = page.S.st, on = (sel, ev, fn) => body.querySelectorAll(sel).forEach(n => n.addEventListener(ev, fn));
    on("#p_grid", "change", e => { st.grid = e.target.checked; page.changed(); });
    on("#p_sci", "change", e => { st.sci = e.target.checked; page.changed(); });
    on("[data-a]", "change", e => {
      const t = e.target, o = st.axes[t.dataset.a], k = t.dataset.k;
      if (k === "log") { o.log = t.checked; o.min = o.max = null; page.changed(true); }
      else if (k === "auto") { o.auto = t.checked; o.min = o.max = null; page.changed(true); }
      else if (k === "fmt") { o.fmt = t.value; o.digits = t.value === "dec" ? 1 : 2; page.changed(true); }
      else if (k === "digits") { const v = Math.round(+t.value); if (v >= 0 && v <= 10) { o.digits = v; page.changed(); } }
    });
    on("[data-k=min], [data-k=max]", "input", e => {
      const t = e.target, v = num(t.value);
      if (v != null) { st.axes[t.dataset.a][t.dataset.k] = v; page.changed(); }
    });
    on("[data-k=fitdata]", "click", e => {
      const a = e.target.dataset.a, o = st.axes[a];
      [o.min, o.max] = dataRange(series.flatMap(s => a === "x" ? s.xs : s.ys), o.log);
      page.changed(true);
    });
  }

  // ---------------------------------------------------------------- データの表(直しても元のファイルは変わらない)
  // 「グラフに使う表」と「元のファイル(範囲を選ぶ)」の 2 つの見方がある
  page.dataMode = "table";
  function renderDataTable() {
    const src = sources();
    $("data_box").hidden = !src.length;
    $("data_sum").textContent = `(${src.length} ファイル。直しても元のファイルは変わりません)`;
    if (page.dataTab >= src.length) page.dataTab = 0;
    $("data_tabs").innerHTML = src.map((f, i) => `<button data-i="${i}" class="${i === page.dataTab ? "on" : ""}">${esc(f.name)}</button>`).join("")
      + `<span class="sp"></span><div class="seg mode"><button data-mode="table" class="${page.dataMode === "table" ? "on" : ""}">グラフに使う表</button>`
      + `<button data-mode="raw" class="${page.dataMode === "raw" ? "on" : ""}" title="元のファイルをそのまま見て、グラフに使う範囲をマウスで選べます">元のファイル</button></div>`;
    $("data_tabs").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { page.dataTab = +b.dataset.i; sel = null; renderDataTable(); });
    $("data_tabs").querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { page.dataMode = b.dataset.mode; renderDataTable(); });
    const f = src[page.dataTab];
    if (!f) { $("data_table").innerHTML = ""; return; }
    if (page.dataMode === "raw") return renderRaw(f);
    const t = f.table;
    const MAX = 2000;   // 多すぎると重くなるので、表に出すのは 2000 行まで
    let h = `<div class="sub" style="margin-bottom:6px">${t.rows.length} 行 × ${t.columns.length} 列${f.range ? `(元のファイルの ${rangeLabel(f.range)} から)` : ""}。数字をクリックすると直せます。</div>
      <div class="scroll"><table class="tbl"><tr><th></th>${t.columns.map(c => `<th>${esc(c)}</th>`).join("")}<th></th></tr>`;
    t.rows.slice(0, MAX).forEach((r, i) => {
      h += `<tr><td class="rn">${i + 1}</td>` + r.map((v, j) => `<td contenteditable="plaintext-only" data-r="${i}" data-c="${j}" class="${t.numeric[j] ? "" : "txt"}">${v == null ? "" : esc(v)}</td>`).join("")
        + `<td><button class="del" data-del="${i}" title="この行を消す">×</button></td></tr>`;
    });
    h += `</table></div>` + (t.rows.length > MAX ? `<div class="sub">(${MAX} 行目までを表示しています)</div>` : "")
      + `<button class="btn" id="add_row" style="margin-top:8px">＋ 行を足す</button>`;
    $("data_table").innerHTML = h;
    $("data_table").querySelectorAll("td[contenteditable]").forEach(td => {
      td.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); td.blur(); } });
      td.addEventListener("blur", () => {
        const i = +td.dataset.r, j = +td.dataset.c, txt = td.textContent.trim();
        let v = txt === "" ? null : txt;
        if (t.numeric[j] && v != null) {       // 全角の数字やカンマつきも数値に直して、直した値を表に出す
          const n = toNumber(v), ok = Number.isFinite(n);
          td.classList.toggle("bad", !ok);
          td.title = ok ? "" : "数値として読めません(グラフには使いません)";
          if (ok) td.textContent = String(n);
          v = ok ? n : null;
        }
        if (t.rows[i][j] === v) return;
        t.rows[i][j] = v;
        page.changed(false);
        page.renderPanel();
      });
    });
    $("data_table").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { t.rows.splice(+b.dataset.del, 1); page.changed(true); });
    $("add_row").onclick = () => { t.rows.push(t.columns.map(() => null)); renderDataTable(); };
  }

  // ---------------------------------------------------------------- 元のファイルを Excel のように見て、範囲を選ぶ
  let sel = null;          // 選んでいる範囲 { r0, c0, r1, c1, header }
  let drag = null;         // ドラッグを始めた所 { ar, ac }
  addEventListener("mouseup", () => { drag = null; });
  function showRaw(f) {
    page.dataTab = sources().indexOf(f); page.dataMode = "raw"; sel = f.range ? { ...f.range } : null;
    $("data_box").open = true;
    renderDataTable();
    $("data_box").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const norm = q => ({ r0: Math.min(q.ar, q.br), r1: Math.max(q.ar, q.br), c0: Math.min(q.ac, q.bc), c1: Math.max(q.ac, q.bc) });

  async function renderRaw(f) {
    const rows = await rowsOf(f);
    const MAXR = 2000, nr = Math.min(rows.length, MAXR);
    const nc = Math.max(1, ...rows.slice(0, nr).map(r => (r || []).length));
    const cell = v => v == null ? "" : esc(v);
    let h = `<div class="rawbar" id="rawbar"></div>
      <div class="scroll raw"><table class="tbl rawgrid" id="rawgrid"><tr><th class="corner"></th>${Array.from({ length: nc }, (_, c) => `<th class="ch" data-col="${c}">${colLetter(c)}</th>`).join("")}</tr>`;
    for (let r = 0; r < nr; r++) {
      const row = rows[r] || [];
      h += `<tr><td class="rn">${r + 1}</td>` + Array.from({ length: nc }, (_, c) => `<td data-r="${r}" data-c="${c}">${cell(row[c])}</td>`).join("") + `</tr>`;
    }
    h += `</table></div>` + (rows.length > MAXR ? `<div class="sub">(${MAXR} 行目までを表示しています)</div>` : "");
    $("data_table").innerHTML = h;
    const grid = $("rawgrid");

    // 色をつける:使っている範囲(緑の枠)と、選んでいる範囲(青)
    const paint = () => {
      const used = f.range || null;
      grid.querySelectorAll("td[data-r]").forEach(td => {
        const r = +td.dataset.r, c = +td.dataset.c;
        td.classList.toggle("sel", !!sel && r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1);
        td.classList.toggle("used", !!used && r >= used.r0 && r <= used.r1 && c >= used.c0 && c <= used.c1);
        td.classList.toggle("head", !!used && used.header && r === used.r0 && c >= used.c0 && c <= used.c1);
      });
      bar();
    };
    const bar = () => {
      const n = sel ? `<b>${rangeLabel(sel)}</b>(${sel.r1 - sel.r0 + 1} 行 × ${sel.c1 - sel.c0 + 1} 列)` : "まだ選んでいません";
      $("rawbar").innerHTML = `<div class="sub">表の上をドラッグして、グラフに使う範囲を選びます(列の記号をクリックで列ごと、Shift+クリックで広げる)。
          ${f.range ? `今使っている範囲は <span class="usedmark">${rangeLabel(f.range)}</span> です。` : "今は、列の名前の行を自動で探して読んでいます。"}</div>
        <div class="row" style="margin-top:6px">選んだ範囲:${n}
          <label class="ck" style="margin-left:8px"><input type="checkbox" id="raw_head" ${!sel || sel.header !== false ? "checked" : ""}>1 行目を列の名前にする</label></div>
        <div class="row" style="margin-top:6px">
          <button class="btn primary" id="raw_use" ${sel ? "" : "disabled"}>この範囲をグラフに使う</button>
          <button class="btn" id="raw_add" ${sel ? "" : "disabled"} title="1 つのシートに表がいくつも並んでいるときに。別のデータとして重ねて描けます">この範囲を別のデータとして追加</button>
          ${f.range ? `<button class="btn" id="raw_auto">自動に戻す</button>` : ""}</div>`;
      $("raw_head").onchange = e => { if (sel) sel.header = e.target.checked; };
      $("raw_use").onclick = () => useRange(f, false);
      $("raw_add").onclick = () => useRange(f, true);
      if ($("raw_auto")) $("raw_auto").onclick = async () => {
        f.range = null; f.skip = guessSkip(rows); f.table = buildTable(rows, f); sel = null;
        toast("列の名前の行を自動で探す読み方に戻しました"); page.changed(true);
      };
    };

    // ドラッグで選ぶ
    const at = el => el && el.dataset && el.dataset.r != null ? { r: +el.dataset.r, c: +el.dataset.c } : null;
    grid.addEventListener("mousedown", e => {
      const th = e.target.closest("th[data-col]");
      if (th) {                                  // 列の記号:その列の、中身がある最初の行から最後の行まで
        const c = +th.dataset.col;
        const c0 = e.shiftKey && sel ? Math.min(sel.c0, c) : c, c1 = e.shiftKey && sel ? Math.max(sel.c1, c) : c;
        let first = -1, last = -1;
        rows.forEach((r, i) => {
          for (let k = c0; k <= c1; k++) if (r && r[k] != null && String(r[k]).trim() !== "") { if (first < 0) first = i; last = i; }
        });
        sel = { r0: Math.max(0, first), r1: Math.max(0, last), c0, c1, header: sel ? sel.header : true };
        paint(); return;
      }
      const p = at(e.target.closest("td[data-r]"));
      if (!p) return;
      e.preventDefault();
      const header = sel ? sel.header : true;
      if (e.shiftKey && sel) drag = { ar: sel.r0 === p.r ? sel.r1 : sel.r0, ac: sel.c0 === p.c ? sel.c1 : sel.c0 };
      else drag = { ar: p.r, ac: p.c };
      sel = { ...norm({ ...drag, br: p.r, bc: p.c }), header };
      paint();
    });
    grid.addEventListener("mouseover", e => {
      if (!drag) return;
      const p = at(e.target.closest("td[data-r]"));
      if (!p) return;
      sel = { ...norm({ ...drag, br: p.r, bc: p.c }), header: sel.header };
      paint();
    });
    paint();
  }

  // 選んだ範囲を使う(asNew = true なら、同じファイルの別のデータとして足す)
  async function useRange(f, asNew) {
    if (!sel) return;
    const range = { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1, header: sel.header !== false };
    const rows = await rowsOf(f);
    let target = f;
    if (asNew) {
      let name = `${stem(f.name)} (${rangeLabel(range)})`, n = 2;
      while (page.S.files.some(x => x.name === name)) name = `${stem(f.name)} (${rangeLabel(range)}) ${n++}`;
      target = { name, excel: f.excel, raw: f.raw, sheet: f.sheet, sheets: f.sheets, skip: 0, _rows: rows };
      page.S.files.push(target);
      page.dataTab = page.S.files.length - 1;
    }
    target.range = range;
    target.table = buildTable(rows, target);
    const t = target.table;
    if (!t.numeric.some(Boolean)) toast("選んだ範囲に数値の列が見つかりません。範囲や「1 行目を列の名前にする」を見直してください");
    else toast(asNew ? `「${target.name}」として追加しました` : `${rangeLabel(range)} をグラフに使います`);
    if (cfg.onFilesAdded && asNew) cfg.onFilesAdded(page, [target.name]);
    sel = { ...range };
    page.changed(true);
  }

  // ---------------------------------------------------------------- ファイルを読み込む
  async function addFiles(list) {
    const added = [], notes = [], S = page.S;
    for (const file of list) {
      if (!/\.(xlsx|xlsm|xls|csv|txt|tsv)$/i.test(file.name)) { toast(`「${file.name}」は Excel / CSV ではないようです`); continue; }
      let name = file.name, n = 2;
      while (S.files.some(f => f.name === name)) name = `${stem(file.name)} (${n++}).${file.name.split(".").pop()}`;
      const item = { name, excel: isExcel(file.name), raw: await file.arrayBuffer(), sheet: null, skip: 0 };
      try {
        item.sheets = await sheetNames(item);
        item.sheet = item.sheets[0] || null;
        const rows = item._rows = await readRows(item, item.sheet);
        item.skip = guessSkip(rows); item.range = null;
        item.table = buildTable(rows, item);
        S.files.push(item); added.push(name);
        if (item.skip) notes.push(`「${name}」は、上の ${item.skip} 行を飛ばして読みました(⚙ で変えられます)`);
      } catch (e) {
        console.error(e);
        dialog("読み込めませんでした", `<p>「${esc(file.name)}」を読み込めませんでした。</p><p><small>${esc(e.message || e)}</small></p>`);
      }
    }
    if (added.length) {
      if (cfg.onFilesAdded) cfg.onFilesAdded(page, added);
      toast(`📁 ${added.length} 個のファイルを読み込みました`);
      if (notes.length) setTimeout(() => toast(notes.join(" / ")), 2700);
      page.tab = "data";
      page.changed(true);
    }
  }

  // ---------------------------------------------------------------- 一覧・開く・保存
  let chain = Promise.resolve();
  function queue(fn) {
    const p = chain.then(fn);
    chain = p.catch(e => { console.error(e); setStatus(`⚠ 保存できませんでした`, true, String(e.message || e)); });
    return p;
  }
  const currentName = page.currentName = () => $("d_name").value.trim() || page.S.defaultName || `${cfg.prefix}1`;

  async function refreshList() {
    const list = await cfg.store.list();
    const sel = $("d_pick");
    sel.innerHTML = `<option value="__new__">＋ 新しい${cfg.noun}</option>` +
      list.map(r => `<option value="${esc(r.id)}">${esc(r.name)}(${mdhm(new Date(r.updated))})</option>`).join("");
    sel.value = page.S.id && list.some(r => r.id === page.S.id) ? page.S.id : "__new__";
    $("d_delete").disabled = !page.S.id;
    loadLibrary().catch(e => console.error(e));
    // 名前を決めていない新しいものには、plot1、plot2 … のうち空いている番号の名前をつける(手元版と同じ)
    if (!page.S.id && !page.S.defaultName) page.S.defaultName = nextName(cfg.prefix, list.map(r => r.name));
    $("d_name").placeholder = page.S.id ? "" : `${page.S.defaultName}(ファイルを読み込むと自動で保存)`;
  }

  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => queue(doSave), 400); }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; return queue(doSave); } return chain; }

  async function doSave() {
    saveTimer = null;
    const S = page.S;
    if (!S.files.length && !S.id) return;          // まだ何も読み込んでいない新しいものは保存しない
    let name = currentName();
    if (sigOf(name) === S.sig) return;
    let rec = S.id ? await cfg.store.get(S.id) : null;
    if (rec && S.seen && rec.updated !== S.seen) {
      name = `${name}-copy`; rec = null;
      toast(`同じ${cfg.noun}が別の画面で変更されていたため、こちらは名前に -copy をつけた別の${cfg.noun}として保存しました`);
    }
    const now = store.nowISO(), created = !rec;
    if (!rec) rec = { id: store.newId(), created: now };
    const renamed = rec.name !== name;
    Object.assign(rec, { name, updated: now, state: clone(S.st),
      files: S.files.map(f => ({ name: f.name, excel: f.excel, raw: f.raw, sheet: f.sheet, skip: f.skip, range: f.range || null, sheets: f.sheets || [], table: clone(f.table) })) });
    await cfg.store.put(rec);
    S.id = rec.id; S.seen = now; S.sig = sigOf(name);
    if (document.activeElement !== $("d_name") && $("d_name").value.trim() !== name) $("d_name").value = name;
    setStatus(`✓ 保存済み ${hm(new Date())}`, false, "自動で保存しました");
    store.notify({ type: "saved", kind: cfg.kind, id: rec.id });
    if (created) await store.setSetting(cfg.lastKey, rec.id);
    if (created || renamed) await refreshList();
  }

  function loadState(rec) {
    const st = rec ? { ...cfg.defaultState(), ...clone(rec.state) } : cfg.defaultState();
    st.axes = { x: { ...defaultAxis(), ...(st.axes || {}).x }, y: { ...defaultAxis(), ...(st.axes || {}).y } };
    if (cfg.fixState) cfg.fixState(st);
    page.S = { id: rec ? rec.id : null, seen: rec ? rec.updated : null, sig: null, defaultName: null,
               files: rec ? rec.files.map(f => ({ ...f, table: clone(f.table) })) : [], st };
    $("d_name").value = rec ? rec.name : "";
    setStatus(rec ? `✓ 保存済み` : "", false, rec ? `${mdhm(new Date(rec.updated))} に保存した${cfg.noun}` : "");
    page.renderPlot(); page.renderPanel(); renderDataTable();
    // 開いた直後の値で印をつける(自動で補った設定だけで保存し直さないように)
    if (rec) page.S.sig = sigOf(rec.name);
  }

  async function openRec(id) {
    await flushSave();
    const rec = await cfg.store.get(id);
    if (!rec) { toast(`その${cfg.noun}が見つかりませんでした`); await refreshList(); return; }
    loadState(rec);
    await store.setSetting(cfg.lastKey, rec.id);
    await refreshList();
  }
  async function newRec() {
    await flushSave();
    loadState(null);
    await store.setSetting(cfg.lastKey, null);
    await refreshList();
  }
  async function deleteCurrent() {
    if (!page.S.id) return;
    const name = currentName();
    const ok = await dialog(`${cfg.noun}を削除`, `<p>「${esc(name)}」を削除します。読み込んだデータのコピーも消えます(元のファイルは消えません)。<b>元に戻せません。</b></p>`,
      [{ label: "やめる", value: false }, { label: "削除する", cls: "danger", value: true }]);
    if (!ok) return;
    clearTimeout(saveTimer); saveTimer = null;
    const id = page.S.id;
    await queue(async () => { await cfg.store.del(id); store.notify({ type: "deleted", kind: cfg.kind, id }); });
    loadState(null);
    await store.setSetting(cfg.lastKey, null);
    await refreshList();
    toast(`🗑 「${name}」を削除しました`);
  }

  async function doExport(fmt) {
    if (!page.S.files.length) { toast("先に Excel / CSV を読み込んでください"); return; }
    if (!page.last.series.length) { toast("縦軸の列を選んでください"); return; }
    const busy = setTimeout(() => $("busy").classList.add("show"), 250);
    try {
      await exportWithPreview(fmt, page.last.prims, currentName(), page.last.box, "画面のグラフをそのまま書き出します。",
        () => { clearTimeout(busy); $("busy").classList.remove("show"); });
    }
    catch (e) { console.error(e); dialog("書き出せませんでした", `<p>${esc(e.message || e)}</p>`); }
    finally { clearTimeout(busy); $("busy").classList.remove("show"); }
  }

  // ---------------------------------------------------------------- はじめ
  page.start = async () => {
    document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { page.tab = b.dataset.tab; page.renderPanel(); });
    $("empty_pick").onclick = () => $("f_data").click();
    $("f_data").onchange = e => { const fs = [...e.target.files]; e.target.value = ""; addFiles(fs); };
    // ページのどこにファイルを落としても読み込む
    let depth = 0;
    addEventListener("dragenter", e => { if ([...e.dataTransfer.types].includes("Files")) { depth++; $("drop_cover").classList.add("show"); } });
    addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("drop_cover").classList.remove("show"); } });
    addEventListener("dragover", e => e.preventDefault());
    addEventListener("drop", e => { e.preventDefault(); depth = 0; $("drop_cover").classList.remove("show"); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

    $("d_pick").onchange = e => e.target.value === "__new__" ? newRec() : openRec(e.target.value);
    let nameTimer = null;
    $("d_name").addEventListener("input", () => { clearTimeout(nameTimer); nameTimer = setTimeout(scheduleSave, 300); });
    $("d_name").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) e.target.blur(); });
    $("d_delete").onclick = deleteCurrent;
    $("f_new").onclick = () => newRec();
    $("x_png").onclick = () => doExport("png");
    $("x_svg").onclick = () => doExport("svg");
    $("x_pdf").onclick = () => doExport("pdf");
    bindMoreMenu({ beforeBackup: flushSave, onImported: refreshList });
    addEventListener("pagehide", () => flushSave());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });
    store.onNotify(() => refreshList());

    onTextReady(() => page.renderPlot());   // フォント・数式の準備ができたら描き直す
    loadFont();
    try { await loadLibrary(); } catch (e) { console.error(e); }
    loadState(null);
    try {
      const list = await cfg.store.list();
      const lastId = await store.getSetting(cfg.lastKey);
      const pick = list.find(r => r.id === lastId) || (lastId === null ? null : list[0]);
      if (pick) await openRec(pick.id); else await refreshList();
    } catch (e) {
      console.error(e);
      dialog("保存の機能が使えません", `<p>このブラウザでは${cfg.noun}を保存できないようです(プライベートブラウズでは使えないことがあります)。${cfg.noun}を作ることと書き出しはできます。</p><p><small>${esc(e.message || e)}</small></p>`);
    }
  };
  return page;
}
