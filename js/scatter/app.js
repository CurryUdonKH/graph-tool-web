// 散布図のページ:ファイルごとに横軸・縦軸を選んで 1 枚に重ね、回帰直線を引く
// ファイルの読み込み・自動保存・書き出しなどは datapage.js

import * as store from "../store.js";
import { numericColumns } from "./data.js";
import { computeScatterSeries, seriesXRef } from "./series.mjs";
import { buildPlot, COLORS, MARKERS } from "./plot.js";
import { linregress } from "./stats.js";
import { esc, toast, dialog, MATH_HELP } from "../ui.js";
import { createDataPage, axisOpt, g4, opts, numVal, num, defaultAxis } from "../datapage.js";

const FIG = { W: 504, H: 331, fontSize: 11 };   // 7 × 4.6 インチ(手元版と同じ)

const defaultState = () => ({
  sel: {}, labels: {}, fit: true, fitAll: true, fitMin: null, fitMax: null,
  xlabel: null, ylabel: null, title: "", grid: true, sci: false, legendPosition: "top-right",
  axes: { x: defaultAxis(), y: defaultAxis() },
});

// ---------------------------------------------------------------- 系列を組み立てる
function computeSeries(page) {
  const { series, warns } = computeScatterSeries(page.sources(), page.S.st);
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
    title: st.title, legend: series.length > 1, legendPosition: st.legendPosition, grid: st.grid, sci: st.sci,
    axes: { x: axisOpt(st.axes.x, series.flatMap(s => s.xs), warns, "横軸"), y: axisOpt(st.axes.y, series.flatMap(s => s.ys), warns, "縦軸") },
  });
  if (!results.length) return { prims, ...FIG };
  const rows = results.map(({ s, r, x0, x1 }) => [s.label, r.n, `${g4(x0)} 〜 ${g4(x1)}`, g4(r.slope), g4(r.stderr), g4(r.intercept), g4(r.interceptStderr), g4(r.r2), g4(r.r), g4(r.p)]);
  const summary = `<h3>回帰結果 <span>${rows.length} 系列</span></h3>${rows.length > 3 ? `<div class="result-scroll-note">下に続きます ↓</div>` : ""}<div class="result-summary-list"${rows.length > 3 ? ` tabindex="0" role="region" aria-label="回帰結果の系列"` : ""}>` + rows.map((row, i) =>
    `<section class="result-series"><h4><span class="swatch" style="background:${results[i].s.color}"></span><span class="result-series-name" title="${esc(row[0])}">${esc(row[0])}</span></h4><dl>` +
    [["傾き", row[3]], ["R²", row[7]]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("") +
    `</dl></section>`).join("") + `</div><button class="result-detail-button" id="show_results">詳しい結果を見る</button>`;
  const html = `<details id="fit_details" ${page.fitDetailsOpen ? "open" : ""}><summary>回帰結果の詳細</summary><div class="result-detail-body"><h3><span style="font-weight:normal;color:var(--muted)">y = 傾き × x + 切片</span>
      <button class="btn" id="copy_res" title="Excel や Word に貼り付けられる形でコピーします">表をコピー</button></h3>
    <div class="scroll"><table class="tbl"><tr>${RES_COLS.map(c => `<th>${c}</th>`).join("")}</tr>` +
    rows.map((r, i) => `<tr><td><span class="swatch" style="display:inline-block;background:${results[i].s.color};margin-right:6px"></span>${esc(r[0])}</td>` +
      r.slice(1).map(v => `<td>${esc(v)}</td>`).join("") + `</tr>`).join("") + `</table></div>
    <div class="cap">± は標準誤差。R² は決定係数、r は相関係数、p 値は「傾きが 0(x と y に関係がない)」かどうかの検定です。</div></div></details>`;
  const bindBelow = () => {
    const details = document.getElementById("fit_details");
    details.addEventListener("toggle", () => { if (details.isConnected) page.fitDetailsOpen = details.open; });
    document.getElementById("show_results").onclick = () => {
      details.open = true;
      details.scrollIntoView({block: "nearest"});
      details.querySelector("summary").focus();
    };
    document.getElementById("copy_res").onclick = async () => {
      const tsv = [RES_COLS, ...rows].map(r => r.join("\t")).join("\n");
      try { await navigator.clipboard.writeText(tsv); toast("📋 表をコピーしました"); } catch (e) { toast("コピーできませんでした"); }
    };
  };
  return { prims, ...FIG, html, summary, bindBelow };
}

// ---------------------------------------------------------------- 左の設定欄

const panels = {
  data(page, series) {
    const st = page.S.st, sources = page.sources();
    let h = `<div class="data-intro"><h3>重ねるデータ</h3><span>${series.length} 系列</span></div>` + page.dropHTML();
    if (!page.fileExpanded && sources.length) page.fileExpanded = new Set(sources.slice(0, 3).map(f => f.name));
    sources.forEach((f, fi) => {
      const nums = numericColumns(f.table), sel = st.sel[f.name];
      const sourceTitle = f.sheet || f.name;
      h += `<details class="card file-card" data-name="${esc(f.name)}" ${page.fileExpanded?.has(f.name) ? "open" : ""}><summary><span class="source-title"><span class="file-name" title="${esc(sourceTitle)}">${esc(sourceTitle)}</span>${f.sheet ? `<small title="${esc(f.name)}">${esc(f.name)}</small>` : ""}</span><span class="file-count">${sel?.ys.length || 0} 系列</span></summary><div class="file-settings">`;
      if (!nums.length || !sel) h += `<div class="warn">数値の列が見つかりません。読み込み設定を確認してください。</div>`;
      else {
        for (const y of sel.ys) {
          const ref = seriesXRef(sel, y), value = ref ? JSON.stringify([ref.source, ref.column]) : "";
          const available = !ref || sources.some(src => src.name === ref.source && numericColumns(src.table).includes(ref.column));
          const plotted = series.find(s => s.file === f.name && s.y === y);
          h += `<section class="series-pair"><div class="series-pair-heading"><span class="swatch" style="background:${plotted?.color || 'var(--muted)'}"></span><span class="axis-tag">縦軸 Y</span><strong title="${esc(y)}">${esc(y)}</strong><button type="button" class="series-remove" data-f="${fi}" data-k="series-remove" data-y="${esc(y)}" aria-label="${esc(f.name)} / ${esc(y)} をグラフから外す" title="この系列を外す">×</button></div>`;
          h += `<label class="series-x-field"><span class="axis-tag">横軸 X</span><select data-f="${fi}" data-k="series-x" data-y="${esc(y)}" aria-label="${esc(f.name)} / ${esc(y)} の横軸">`;
          h += `<option value="" ${!ref ? "selected" : ""}>${esc(sel.x)}（基本）</option>`;
          if (!available) h += `<option value="${esc(value)}" selected>見つかりません：${esc(ref.source)} / ${esc(ref.column)}</option>`;
          for (const src of sources) {
            const cols = numericColumns(src.table);
            if (!cols.length) continue;
            h += `<optgroup label="${esc(src.name)}">${opts(cols.map(c => [JSON.stringify([src.name,c]), `${c}（${src === f ? 'このデータ' : src.sheet || src.name}）`]), value)}</optgroup>`;
          }
          h += `</select></label>${ref && ref.source !== f.name ? `<small class="series-origin" title="${esc(ref.source)}">参照元：${esc(ref.source)}</small>` : ""}</section>`;
        }
        const remaining = nums.filter(c => !sel.ys.includes(c));
        if (remaining.length) h += `<div class="series-add"><select data-f="${fi}" data-k="series-add-pick" aria-label="${esc(f.name)}で追加する縦軸"><option value="">縦軸の列を選択…</option>${opts(remaining.map(c => [c,c]), "")}</select><button type="button" class="btn" data-f="${fi}" data-k="series-add" disabled>＋ 追加</button></div>`;
        if (!sel.ys.length) h += `<p class="sub">縦軸を追加すると、グラフに表示されます。</p>`;
      }
      h += `<details class="gear source-options"><summary>${f.excel ? "シート・範囲・読み込み設定" : "範囲・読み込み設定"}</summary><div><div class="source-tools"><button class="btn" data-f="${fi}" data-k="showraw">表・範囲を選ぶ</button></div>` + page.gearHTML(f, fi);
      if (sel && nums.length) h += `<details class="gear"><summary>共通の横軸を変更</summary><div><label class="fld2"><span>このデータの基本の横軸</span><select data-f="${fi}" data-k="x">${opts(nums.map(c => [c,c]), sel.x)}</select></label><p class="sub">個別に横軸を選んだ系列は、その指定を保ちます。</p></div></details>`;
      h += `</div></details></div></details>`;
    });
    return h + `<details class="gear data-help"><summary>データを重ねるには</summary><div class="sub">縦軸を追加すると同じグラフに重なります。横軸は各系列で選べます。別データの行は先頭から順に対応するので、「表・範囲を選ぶ」で使う行を調整してください。</div></details>` + page.howtoHTML();
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
    return h + `<div class="sub" style="margin-top:14px">結果(傾き・切片・R² など)はグラフの横と下に表示します。</div>`;
  },
  label(page, series) {
    const st = page.S.st;
    if (!series.length) return `<div class="sub">先に「データ」で縦軸を選んでください</div>`;
    let h = `<label class="fld2"><span>横軸のラベル</span><input type="text" id="p_xlabel" value="${esc(st.xlabel ?? autoXLabel(series))}"></label>
      <label class="fld2"><span>縦軸のラベル</span><input type="text" id="p_ylabel" value="${esc(st.ylabel ?? autoYLabel(series))}"></label>
      <label class="fld2"><span>タイトル(なしでもよい)</span><input type="text" id="p_title" value="${esc(st.title)}"></label>`;
    if (series.length > 1) h += `<label class="fld2"><span>凡例の位置</span><select id="p_legend_position">${opts([["top-right", "右上に固定"], ["top-left", "左上に固定"], ["bottom-right", "右下に固定"], ["bottom-left", "左下に固定"], ["top-center", "上中央に固定"], ["bottom-center", "下中央に固定"], ["auto", "自動（点を避ける）"]], st.legendPosition)}</select></label>`;
    h += `<div class="fld2"><span>凡例の名前${series.length === 1 ? "(系列が 1 つのときは凡例を出しません)" : ""}</span>`;
    for (const s of series)
      h += `<label class="row" style="margin-bottom:6px;flex-wrap:nowrap"><span class="swatch" style="background:${s.color}"></span>
        <input type="text" style="flex:1" data-label="${esc(JSON.stringify(s.key))}" value="${esc(s.label)}" title="${esc(s.file)} / ${esc(s.y)}"></label>`;
    return h + `</div><details class="gear"><summary>数式・単位の書き方</summary><div><div class="tip-box"><b>上付き・下付き・ギリシャ文字</b>は、LaTeX と同じように <code>$</code> で囲んで書きます。<br>
      例:<code>面積 [m$^2$]</code>、<code>$10^{-3}$</code>、<code>$T_{\\mathrm{max}}$</code>、<code>$\\alpha$</code>、<code>$\\Delta T$ [K]</code>、<code>電流 $I$ [$\\mu$A]</code>、<code>[$^\\circ$C]</code></div>
      <button class="btn" id="p_math">∑ 数式の書き方をもっと見る</button></div></details>`;
  },
  axis: (page, series) => page.axisHTML(series),
};

function bind(page, tab, body) {
  const st = page.S.st, on = (sel, ev, fn) => body.querySelectorAll(sel).forEach(n => n.addEventListener(ev, fn));
  if (tab === "data") {
    on(".file-card", "toggle", e => { const el = e.currentTarget; if (!el.isConnected) return; if (el.open) page.fileExpanded.add(el.dataset.name); else page.fileExpanded.delete(el.dataset.name); });
    on("[data-k=series-add-pick]", "change", e => {
      body.querySelector(`[data-k="series-add"][data-f="${e.target.dataset.f}"]`).disabled = !e.target.value;
    });
    on("[data-k=series-add], [data-k=series-remove]", "click", e => {
      const t = e.currentTarget, f = page.sources()[+t.dataset.f], sel = st.sel[f.name];
      let addedY = null;
      if (t.dataset.k === "series-remove") sel.ys = sel.ys.filter(y => y !== t.dataset.y);
      else {
        const y = body.querySelector(`[data-k="series-add-pick"][data-f="${t.dataset.f}"]`).value;
        if (!y || sel.ys.includes(y)) return;
        // 基本の横軸と同じ列も、独立した系列として追加できる。
        if (y === sel.x && !seriesXRef(sel, y)) sel.xByY = {...sel.xByY, [y]: {source: f.name, column: sel.x}};
        sel.ys.push(y);
        addedY = y;
        const nums = numericColumns(f.table);
        sel.ys.sort((a, b) => nums.indexOf(a) - nums.indexOf(b));
      }
      page.changed(true);
      const focusTarget = addedY === null ? body.querySelector(`[data-k="series-add-pick"][data-f="${t.dataset.f}"]`) : [...body.querySelectorAll('[data-k="series-x"]')].find(n => n.dataset.f === t.dataset.f && n.dataset.y === addedY);
      focusTarget?.focus();
    });
    on("[data-k=series-x]", "change", e => {
      const t = e.target, f = page.sources()[+t.dataset.f], sel = st.sel[f.name];
      if (!t.value && t.dataset.y !== sel.x) delete sel.xByY[t.dataset.y];
      else if (!t.value) sel.xByY = {...sel.xByY, [t.dataset.y]:{source:f.name,column:sel.x}};
      else { const [source,column] = JSON.parse(t.value); sel.xByY = {...sel.xByY, [t.dataset.y]:{source,column}}; }
      page.changed(true);
      [...body.querySelectorAll('[data-k="series-x"]')].find(n => n.dataset.f === t.dataset.f && n.dataset.y === t.dataset.y)?.focus();
    });
    on("[data-k=x]", "change", e => {
      const t = e.target, f = page.sources()[+t.dataset.f], sel = st.sel[f.name];
      sel.x = t.value;
      sel.ys = sel.ys.filter(y => y !== t.value || seriesXRef(sel,y));
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
    on("#p_legend_position", "change", e => { st.legendPosition = e.target.value; page.changed(); });
    on("#p_title", "input", e => { st.title = e.target.value; page.changed(); });
    on("[data-label]", "input", e => { st.labels[JSON.parse(e.target.dataset.label)] = e.target.value; page.changed(); });
    on("#p_math", "click", () => dialog("数式の書き方", MATH_HELP));
  }
}

const page = createDataPage({
  kind: "graph", noun: "グラフ", prefix: "plot", lastKey: "lastGraph",
  store: { list: store.listGraphs, get: store.getGraph, put: store.putGraph, del: store.deleteGraph },
  defaultState, computeSeries, draw, panels, bind,
  onFilesAdded(page, names) {
    page.fileExpanded ||= new Set();
    names.forEach(name => page.fileExpanded.add(name));
  },
});
page.start();
