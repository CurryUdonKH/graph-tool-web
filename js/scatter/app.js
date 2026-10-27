// 散布図のページ:ファイルごとに横軸・縦軸を選んで 1 枚に重ね、回帰直線を引く
// ファイルの読み込み・自動保存・書き出しなどは datapage.js

import * as store from "../store.js";
import { numericColumns, column } from "./data.js";
import { buildPlot, COLORS, MARKERS } from "./plot.js";
import { linregress } from "./stats.js";
import { esc, toast, dialog, MATH_HELP } from "../ui.js";
import { createDataPage, axisOpt, g4, stem, opts, numVal, num, defaultAxis } from "../datapage.js";

const FIG = { W: 504, H: 331, fontSize: 11 };   // 7 × 4.6 インチ(手元版と同じ)

const defaultState = () => ({
  sel: {}, labels: {}, fit: true, fitAll: true, fitMin: null, fitMax: null,
  xlabel: null, ylabel: null, title: "", grid: true, sci: false,
  axes: { x: defaultAxis(), y: defaultAxis() },
});

// ---------------------------------------------------------------- 系列を組み立てる
function computeSeries(page) {
  const src = page.sources(), st = page.S.st, series = [], warns = [];
  for (const f of src) {
    const nums = numericColumns(f.table);
    if (!nums.length) {
      warns.push(`「${f.name}」に数値の列が見つかりません。表の上にタイトル行がある場合は、「データ」の ⚙ から「上から飛ばす行数」を増やしてみてください。`);
      continue;
    }
    if (nums.length < 2) warns.push(`「${f.name}」は数値の列が 1 つしかありません。列の名前の行がずれているときは、「データ」の ⚙ から「上から飛ばす行数」を直してみてください。`);
    let sel = st.sel[f.name];
    if (!sel || !nums.includes(sel.x)) sel = st.sel[f.name] = { x: nums[0], ys: sel ? sel.ys : null };
    if (!sel.ys) sel.ys = nums.filter(c => c !== sel.x).slice(0, 1);
    sel.ys = sel.ys.filter(y => nums.includes(y) && y !== sel.x);
    const xcol = column(f.table, sel.x);
    for (const y of sel.ys) {
      const ycol = column(f.table, y), xs = [], ys = [];
      for (let i = 0; i < xcol.length; i++) {
        if (Number.isFinite(xcol[i]) && Number.isFinite(ycol[i])) { xs.push(xcol[i]); ys.push(ycol[i]); }
      }
      const key = `${f.name}\u0000${y}`;
      const auto = src.length > 1 ? `${stem(f.name)}: ${y}` : y;
      series.push({ file: f.name, x: sel.x, y, key, xs, ys, label: st.labels[key] ?? auto });
    }
  }
  series.forEach((s, i) => { s.color = COLORS[i % COLORS.length]; s.marker = MARKERS[i % MARKERS.length]; });
  return { series, warns };
}
const autoXLabel = series => [...new Set(series.map(s => s.x))].join(" / ");
const autoYLabel = series => { const ys = [...new Set(series.map(s => s.y))]; return ys.length === 1 ? ys[0] : ""; };

function fitRange(st, series) {
  if (!st.fit || st.fitAll) return null;
  const xs = series.flatMap(s => s.xs);
  if (st.fitMin == null || st.fitMax == null) { st.fitMin = Math.min(...xs); st.fitMax = Math.max(...xs); }
  return st.fitMin < st.fitMax ? [st.fitMin, st.fitMax] : null;
}

// ---------------------------------------------------------------- グラフと回帰直線の結果
const RES_COLS = ["系列", "点の数", "x の範囲", "傾き", "傾き ±", "切片", "切片 ±", "R²", "r", "p 値"];

function draw(page, series, warns, info) {
  const st = page.S.st;
  const rng = fitRange(st, series);
  if (st.fit && !st.fitAll && st.fitMin >= st.fitMax) warns.push("回帰直線:x の最小は最大より小さくしてください");
  const fits = [], results = [];
  for (const s of series) {
    s.inside = rng ? s.xs.map(x => x >= rng[0] && x <= rng[1]) : null;
    if (!st.fit) continue;
    const xs = [], ys = [];
    s.xs.forEach((x, i) => { if (!s.inside || s.inside[i]) { xs.push(x); ys.push(s.ys[i]); } });
    const r = xs.length >= 3 ? linregress(xs, ys) : null;   // 散布図は手元版と同じく 3 個以上で引く
    if (!r) continue;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    fits.push({ slope: r.slope, intercept: r.intercept, x0, x1, color: s.color });
    results.push({ s, r, x0, x1 });
  }
  if (st.fit && results.length < series.length && series.length) info.push("点が 3 個未満の系列(または x がすべて同じ系列)は、回帰直線を引いていません");
  if (!series.length) info.push("「データ」の欄で、縦軸 (y) の列を 1 つ以上選んでください");
  const { prims } = buildPlot({
    ...FIG, series, fits, xlabel: st.xlabel ?? autoXLabel(series), ylabel: st.ylabel ?? autoYLabel(series),
    title: st.title, legend: series.length > 1, grid: st.grid, sci: st.sci,
    axes: { x: axisOpt(st.axes.x, series.flatMap(s => s.xs), warns, "横軸"), y: axisOpt(st.axes.y, series.flatMap(s => s.ys), warns, "縦軸") },
  });
  if (!results.length) return { prims, ...FIG };
  const rows = results.map(({ s, r, x0, x1 }) => [s.label, r.n, `${g4(x0)} 〜 ${g4(x1)}`, g4(r.slope), g4(r.stderr), g4(r.intercept), g4(r.interceptStderr), g4(r.r2), g4(r.r), g4(r.p)]);
  const html = `<h3>回帰直線の結果 <span style="font-weight:normal;color:var(--muted)">y = 傾き × x + 切片</span>
      <button class="btn" id="copy_res" title="Excel や Word に貼り付けられる形でコピーします">表をコピー</button></h3>
    <div class="scroll"><table class="tbl"><tr>${RES_COLS.map(c => `<th>${c}</th>`).join("")}</tr>` +
    rows.map((r, i) => `<tr><td><span class="swatch" style="display:inline-block;background:${results[i].s.color};margin-right:6px"></span>${esc(r[0])}</td>` +
      r.slice(1).map(v => `<td>${esc(v)}</td>`).join("") + `</tr>`).join("") + `</table></div>
    <div class="cap">± は標準誤差。R² は決定係数、r は相関係数、p 値は「傾きが 0(x と y に関係がない)」かどうかの検定です。</div>`;
  const bindBelow = () => document.getElementById("copy_res").onclick = async () => {
    const tsv = [RES_COLS, ...rows].map(r => r.join("\t")).join("\n");
    try { await navigator.clipboard.writeText(tsv); toast("📋 表をコピーしました"); } catch (e) { toast("コピーできませんでした"); }
  };
  return { prims, ...FIG, html, bindBelow };
}

// ---------------------------------------------------------------- 右の設定欄

const panels = {
  data(page) {
    const st = page.S.st;
    let h = page.dropHTML();
    if (page.S.files.length) h += `<div class="sub" style="margin:-6px 0 12px">ファイルごとに横軸と縦軸を選びます。縦軸は複数選べ、全部が 1 枚に重なります。</div>`;
    let si = 0;
    page.sources().forEach((f, fi) => {
      const nums = numericColumns(f.table), sel = st.sel[f.name];
      h += `<div class="card"><h4><span class="nm" title="${esc(f.name)}">📁 ${esc(f.name)}</span></h4>` + page.gearHTML(f, fi);
      if (!nums.length || !sel) { h += `<div class="warn">数値の列が見つかりません</div></div>`; return; }
      h += `<label class="fld2"><span>横軸 (x)</span><select data-f="${fi}" data-k="x">${opts(nums.map(c => [c, c]), sel.x)}</select></label>
        <div class="fld2"><span>縦軸 (y)<small>(選ばないとこのファイルは使いません)</small></span><div class="checks">`;
      for (const c of nums) {
        if (c === sel.x) continue;
        const on = sel.ys.includes(c), color = on ? COLORS[si++ % COLORS.length] : "transparent";
        h += `<label><input type="checkbox" data-f="${fi}" data-k="y" value="${esc(c)}" ${on ? "checked" : ""}><span class="swatch" style="background:${color}"></span>${esc(c)}</label>`;
      }
      h += `</div></div></div>`;
    });
    return h + page.howtoHTML();
  },
  fit(page, series) {
    const st = page.S.st;
    let h = `<label class="ck"><input type="checkbox" id="p_fit" ${st.fit ? "checked" : ""}>回帰直線(最小二乗法)を引く</label>`;
    if (st.fit) {
      h += `<label class="ck"><input type="checkbox" id="p_fitall" ${st.fitAll ? "checked" : ""}>全部のデータで計算する</label>`;
      if (!st.fitAll) {
        fitRange(st, series);
        h += `<div class="sub" style="margin:8px 0">計算に使う<b>横軸 (x) の範囲</b>。範囲の外の点は白抜きになり、計算に使いません。</div>
          <div class="grid2"><label class="fld2"><span>x の最小</span><input type="number" step="any" id="p_fitmin" value="${numVal(st.fitMin)}"></label>
          <label class="fld2"><span>x の最大</span><input type="number" step="any" id="p_fitmax" value="${numVal(st.fitMax)}"></label></div>`;
      }
    }
    return h + `<div class="sub" style="margin-top:14px">結果(傾き・切片・R² など)はグラフの下に出ます。</div>`;
  },
  label(page, series) {
    const st = page.S.st;
    if (!series.length) return `<div class="sub">先に「データ」で縦軸を選んでください</div>`;
    let h = `<label class="fld2"><span>横軸のラベル</span><input type="text" id="p_xlabel" value="${esc(st.xlabel ?? autoXLabel(series))}"></label>
      <label class="fld2"><span>縦軸のラベル</span><input type="text" id="p_ylabel" value="${esc(st.ylabel ?? autoYLabel(series))}"></label>
      <label class="fld2"><span>タイトル(なしでもよい)</span><input type="text" id="p_title" value="${esc(st.title)}"></label>`;
    h += `<div class="fld2"><span>凡例の名前${series.length === 1 ? "(系列が 1 つのときは凡例を出しません)" : ""}</span>`;
    for (const s of series)
      h += `<label class="row" style="margin-bottom:6px;flex-wrap:nowrap"><span class="swatch" style="background:${s.color}"></span>
        <input type="text" style="flex:1" data-label="${esc(s.key)}" value="${esc(s.label)}" title="${esc(s.file)} / ${esc(s.y)}"></label>`;
    return h + `</div><div class="tip-box"><b>上付き・下付き・ギリシャ文字</b>は、LaTeX と同じように <code>$</code> で囲んで書きます。<br>
      例:<code>面積 [m$^2$]</code>、<code>$10^{-3}$</code>、<code>$T_{\\mathrm{max}}$</code>、<code>$\\alpha$</code>、<code>$\\Delta T$ [K]</code>、<code>電流 $I$ [$\\mu$A]</code>、<code>[$^\\circ$C]</code></div>
      <button class="btn" id="p_math">∑ 数式の書き方をもっと見る</button>`;
  },
  axis: (page, series) => page.axisHTML(series),
};

function bind(page, tab, body) {
  const st = page.S.st, on = (sel, ev, fn) => body.querySelectorAll(sel).forEach(n => n.addEventListener(ev, fn));
  if (tab === "data") {
    on("[data-k=x], [data-k=y]", "change", e => {
      const t = e.target, f = page.sources()[+t.dataset.f], sel = st.sel[f.name];
      if (t.dataset.k === "x") { sel.x = t.value; sel.ys = sel.ys.filter(y => y !== t.value); }
      else {
        if (t.checked) sel.ys.push(t.value); else sel.ys.splice(sel.ys.indexOf(t.value), 1);
        const nums = numericColumns(f.table);
        sel.ys.sort((a, b) => nums.indexOf(a) - nums.indexOf(b));
      }
      page.changed(true);
    });
  } else if (tab === "fit") {
    on("#p_fit", "change", e => { st.fit = e.target.checked; page.changed(true); });
    on("#p_fitall", "change", e => { st.fitAll = e.target.checked; page.changed(true); });
    on("#p_fitmin", "input", e => { const v = num(e.target.value); if (v != null) { st.fitMin = v; page.changed(); } });
    on("#p_fitmax", "input", e => { const v = num(e.target.value); if (v != null) { st.fitMax = v; page.changed(); } });
  } else if (tab === "label") {
    on("#p_xlabel", "input", e => { st.xlabel = e.target.value; page.changed(); });
    on("#p_ylabel", "input", e => { st.ylabel = e.target.value; page.changed(); });
    on("#p_title", "input", e => { st.title = e.target.value; page.changed(); });
    on("[data-label]", "input", e => { st.labels[e.target.dataset.label] = e.target.value; page.changed(); });
    on("#p_math", "click", () => dialog("数式の書き方", MATH_HELP));
  }
}

const page = createDataPage({
  kind: "graph", noun: "グラフ", prefix: "plot", lastKey: "lastGraph",
  store: { list: store.listGraphs, get: store.getGraph, put: store.putGraph, del: store.deleteGraph },
  defaultState, computeSeries, draw, panels, bind,
});
page.start();
