// レポート用の図のページ:1 つのファイルから、線・点・誤差棒・近似直線の図を作る。
// 大きさを cm で決めて、その大きさのまま書き出す。白黒印刷向け(形と線の種類で区別)にもできる。
// ファイルの読み込み・自動保存・書き出しなどは datapage.js(散布図と共通)

import * as store from "../store.js";
import { numericColumns, column } from "../scatter/data.js";
import { buildPlot, COLORS, MARKERS, LINESTYLES } from "../scatter/plot.js";
import { linregress } from "../scatter/stats.js";
import { FONTS } from "../text.js";
import { esc, toast, dialog, MATH_HELP } from "../ui.js";
import { createDataPage, axisOpt, g4, opts, num, defaultAxis } from "../datapage.js";

const CM = 72 / 2.54;   // 1 cm = 28.35 pt

const defaultState = () => ({
  file: null, sel: {}, style: "both", fit: false,
  xlabel: null, ylabel: null, title: "", legends: {},
  font: "gothic", fontSize: 12, widthCm: 12, heightCm: 8, mono: false,
  grid: false, sci: false, axes: { x: defaultAxis(), y: defaultAxis() },
});
const STYLES = [["both", "点 + 線"], ["marker", "点だけ"], ["line", "線だけ"]];
const clampNum = (v, lo, hi, d) => { const n = num(v); return n == null ? d : Math.max(lo, Math.min(hi, n)); };

// ---------------------------------------------------------------- 系列を組み立てる
function current(page) {
  const src = page.sources(), st = page.S.st;
  const f = src.find(x => x.name === st.file) || src[0];
  if (!f) return {};
  st.file = f.name;
  const nums = numericColumns(f.table);
  let sel = st.sel[f.name];
  if (nums.length && (!sel || !nums.includes(sel.x))) sel = st.sel[f.name] = { x: nums[0], ys: sel ? sel.ys : null, errs: sel ? sel.errs : {} };
  if (sel) {
    if (!sel.ys) sel.ys = nums.filter(c => c !== sel.x).slice(0, 1);
    sel.ys = sel.ys.filter(y => nums.includes(y) && y !== sel.x);
    sel.errs = sel.errs || {};
    for (const y of Object.keys(sel.errs)) if (!nums.includes(sel.errs[y])) delete sel.errs[y];
  }
  return { f, nums, sel };
}

function computeSeries(page) {
  const st = page.S.st, warns = [], series = [];
  const { f, nums, sel } = current(page);
  if (!f) return { series, warns };
  if (!nums.length) {
    warns.push(`「${f.name}」に数値の列が見つかりません。表の上にタイトル行がある場合は、「データ」の ⚙ から「上から飛ばす行数」を増やしてみてください。`);
    return { series, warns };
  }
  const xcol = column(f.table, sel.x);
  sel.ys.forEach((y, i) => {
    const ycol = column(f.table, y), ecol = sel.errs[y] ? column(f.table, sel.errs[y]) : null;
    const pts = [];
    for (let k = 0; k < xcol.length; k++)
      if (Number.isFinite(xcol[k]) && Number.isFinite(ycol[k]) && (!ecol || Number.isFinite(ecol[k]))) pts.push([xcol[k], ycol[k], ecol ? ecol[k] : null]);
    pts.sort((a, b) => a[0] - b[0]);            // 線でつなぐので x の順に並べる
    const color = st.mono ? "#000000" : COLORS[i % COLORS.length];
    series.push({
      y, xs: pts.map(p => p[0]), ys: pts.map(p => p[1]), yerr: ecol ? pts.map(p => p[2]) : null,
      label: st.legends[y] ?? y, color,
      marker: st.style !== "line" ? MARKERS[i % MARKERS.length] : null,
      line: st.style !== "marker" ? (st.mono ? LINESTYLES[i % LINESTYLES.length] : "solid") : null,
      mfc: st.mono && i % 2 ? "#ffffff" : color, ms: 6, lw: 1.5,
    });
  });
  return { series, warns, x: sel.x };
}

// ---------------------------------------------------------------- 図
function draw(page, series, warns, info) {
  const st = page.S.st;
  const W = st.widthCm * CM, H = st.heightCm * CM;
  const { sel } = current(page);
  const fits = [], notes = [];
  if (st.fit) for (const s of series) {
    const r = linregress(s.xs, s.ys);
    if (!r) continue;
    fits.push({ slope: r.slope, intercept: r.intercept, x0: Math.min(...s.xs), x1: Math.max(...s.xs), color: s.color, lw: 1, dash: st.mono ? "dotted" : "dashed" });
    notes.push(`「${s.y}」の近似直線: y = ${g4(r.slope)} x ${r.intercept < 0 ? "−" : "+"} ${g4(Math.abs(r.intercept))}(R² = ${r.r2.toFixed(4)})`);
  }
  if (!series.length) info.push("右の「データ」で、縦軸の列を 1 つ以上選んでください");
  const ylabelAuto = series.length === 1 ? series[0].y : "";
  const { prims } = buildPlot({
    W, H, fontSize: st.fontSize, font: st.font, report: true, series, fits,
    xlabel: st.xlabel ?? (sel ? sel.x : ""), ylabel: st.ylabel ?? ylabelAuto, title: st.title,
    legend: series.length > 1, grid: st.grid, sci: st.sci,
    axes: {
      x: axisOpt(st.axes.x, series.flatMap(s => s.xs), warns, "横軸"),
      y: axisOpt(st.axes.y, series.flatMap(s => s.yerr ? s.ys.flatMap((v, i) => [v - Math.abs(s.yerr[i]), v + Math.abs(s.yerr[i])]) : s.ys), warns, "縦軸"),
    },
  });
  const html = notes.map(n => `<div class="cap">${esc(n)}</div>`).join("") +
    `<div class="cap">大きさ:${st.widthCm} × ${st.heightCm} cm。書き出すと、この大きさの図になります(PNG は 300 dpi)。
     Word に貼るなら PNG、拡大してもきれいなのは SVG / PDF です。</div>`;
  return { prims, W, H, box: { x: 0, y: 0, w: W, h: H }, screenW: W * 96 / 72, html };
}

// ---------------------------------------------------------------- 右の設定欄
const panels = {
  data(page) {
    const st = page.S.st, src = page.sources();
    let h = page.dropHTML();
    if (src.length > 1) h += `<label class="fld2"><span>使うファイル</span><select id="p_file">${opts(src.map(f => [f.name, f.name]), st.file)}</select></label>`;
    const { f, nums, sel } = current(page);
    src.forEach((g, fi) => {
      if (g !== f) h += `<div class="card"><h4><span class="nm">📁 ${esc(g.name)}</span></h4>${page.gearHTML(g, fi)}</div>`;
    });
    if (!f) return h;
    const fi = src.indexOf(f);
    h += `<div class="card"><h4><span class="nm" title="${esc(f.name)}">📁 ${esc(f.name)}</span></h4>` + page.gearHTML(f, fi);
    if (!nums.length) return h + `<div class="warn">数値の列が見つかりません</div></div>` + page.howtoHTML();
    h += `<label class="fld2"><span>横軸の列</span><select id="p_x">${opts(nums.map(c => [c, c]), sel.x)}</select></label>
      <div class="fld2"><span>縦軸の列(複数可)</span><div class="checks">`;
    let si = 0;
    for (const c of nums) {
      if (c === sel.x) continue;
      const on = sel.ys.includes(c), color = on ? (st.mono ? "#000" : COLORS[si++ % COLORS.length]) : "transparent";
      h += `<label><input type="checkbox" data-y value="${esc(c)}" ${on ? "checked" : ""}><span class="swatch" style="background:${color}"></span>${esc(c)}</label>`;
    }
    h += `</div></div>
      <div class="fld2"><span>線と点</span><div class="seg">${STYLES.map(([v, l]) => `<button data-style="${v}" class="${st.style === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <label class="ck"><input type="checkbox" id="p_fit" ${st.fit ? "checked" : ""}>近似直線を引く(点だけのとき便利)</label></div>`;
    if (sel.ys.length) {
      h += `<div class="card"><h4>誤差棒</h4>`;
      for (const y of sel.ys)
        h += `<label class="fld2"><span>「${esc(y)}」の誤差の列</span><select data-err="${esc(y)}">${opts([["", "なし"], ...nums.filter(c => c !== y && c !== sel.x).map(c => [c, c])], sel.errs[y] || "")}</select></label>`;
      h += `</div>`;
    }
    return h + page.howtoHTML();
  },
  look(page, series) {
    const st = page.S.st, { sel } = current(page);
    let h = `<label class="fld2"><span>横軸のラベル(単位も)</span><input type="text" id="p_xlabel" value="${esc(st.xlabel ?? (sel ? sel.x : ""))}"></label>
      <label class="fld2"><span>縦軸のラベル(単位も)</span><input type="text" id="p_ylabel" value="${esc(st.ylabel ?? (series.length === 1 ? series[0].y : ""))}"></label>
      <label class="fld2"><span>タイトル(レポートでは空欄が普通)</span><input type="text" id="p_title" value="${esc(st.title)}"></label>`;
    if (series.length > 1) {
      h += `<div class="fld2"><span>凡例の名前</span>`;
      for (const s of series) h += `<input type="text" style="width:100%;margin-bottom:6px" data-legend="${esc(s.y)}" value="${esc(s.label)}" title="${esc(s.y)}">`;
      h += `</div>`;
    }
    h += `<label class="fld2"><span>フォント</span><select id="p_font">${opts(Object.entries(FONTS).map(([k, v]) => [k, v.label]), st.font)}</select></label>
      <label class="fld2"><span>文字の大きさ [pt]</span><input type="number" min="8" max="20" step="1" id="p_fs" value="${st.fontSize}"></label>
      <div class="grid2"><label class="fld2"><span>幅 [cm]</span><input type="number" min="5" max="30" step="0.5" id="p_w" value="${st.widthCm}"></label>
      <label class="fld2"><span>高さ [cm]</span><input type="number" min="4" max="30" step="0.5" id="p_h" value="${st.heightCm}"></label></div>
      <label class="ck"><input type="checkbox" id="p_mono" ${st.mono ? "checked" : ""}>白黒印刷向け(色の代わりに形と線の種類で区別)</label>
      <div class="tip-box" style="margin-top:10px"><b>上付き・下付き・ギリシャ文字</b>は、LaTeX と同じように <code>$</code> で囲んで書きます。<br>
      例:<code>面積 [m$^2$]</code>、<code>$10^{-3}$</code>、<code>$T_{\\mathrm{max}}$</code>、<code>$\\alpha$</code>、<code>$\\Delta T$ [K]</code>、<code>電流 $I$ [$\\mu$A]</code>、<code>[$^\\circ$C]</code></div>
      <button class="btn" id="p_math">∑ 数式の書き方をもっと見る</button>
      <div class="sub" style="margin-top:8px">明朝体は、はじめて選んだときに文字の形(約 6MB)を読み込みます。</div>`;
    return h;
  },
  axis: (page, series) => page.axisHTML(series),
};

function bind(page, tab, body) {
  const st = page.S.st, on = (sel, ev, fn) => body.querySelectorAll(sel).forEach(n => n.addEventListener(ev, fn));
  if (tab === "data") {
    on("#p_file", "change", e => { st.file = e.target.value; page.changed(true); });
    on("#p_x", "change", e => { const { sel } = current(page); sel.x = e.target.value; sel.ys = sel.ys.filter(y => y !== sel.x); page.changed(true); });
    on("[data-y]", "change", e => {
      const { sel, nums } = current(page), v = e.target.value;
      if (e.target.checked) sel.ys.push(v); else sel.ys.splice(sel.ys.indexOf(v), 1);
      sel.ys.sort((a, b) => nums.indexOf(a) - nums.indexOf(b));
      page.changed(true);
    });
    on("[data-style]", "click", e => { st.style = e.currentTarget.dataset.style; page.changed(true); });
    on("#p_fit", "change", e => { st.fit = e.target.checked; page.changed(); });
    on("[data-err]", "change", e => {
      const { sel } = current(page);
      if (e.target.value) sel.errs[e.target.dataset.err] = e.target.value; else delete sel.errs[e.target.dataset.err];
      page.changed();
    });
  } else if (tab === "look") {
    on("#p_xlabel", "input", e => { st.xlabel = e.target.value; page.changed(); });
    on("#p_ylabel", "input", e => { st.ylabel = e.target.value; page.changed(); });
    on("#p_title", "input", e => { st.title = e.target.value; page.changed(); });
    on("[data-legend]", "input", e => { st.legends[e.target.dataset.legend] = e.target.value; page.changed(); });
    on("#p_font", "change", e => { st.font = e.target.value; if (st.font === "mincho") toast("明朝体の文字の形を読み込んでいます…"); page.changed(); });
    on("#p_fs", "change", e => { st.fontSize = clampNum(e.target.value, 8, 20, 12); e.target.value = st.fontSize; page.changed(); });
    on("#p_w", "change", e => { st.widthCm = clampNum(e.target.value, 5, 30, 12); e.target.value = st.widthCm; page.changed(); });
    on("#p_h", "change", e => { st.heightCm = clampNum(e.target.value, 4, 30, 8); e.target.value = st.heightCm; page.changed(); });
    on("#p_mono", "change", e => { st.mono = e.target.checked; page.changed(); });
    on("#p_math", "click", () => dialog("数式の書き方", MATH_HELP));
  }
}

const page = createDataPage({
  kind: "report", noun: "図", prefix: "figure", lastKey: "lastReport",   // 最初の名前は figure1、figure2 …
  store: { list: store.listReports, get: store.getReport, put: store.putReport, del: store.deleteReport },
  defaultState, computeSeries, draw, panels, bind,
  onFilesAdded(page, added) { page.S.st.file = added[0]; },   // 読み込んだファイルを使う
});
page.start();
