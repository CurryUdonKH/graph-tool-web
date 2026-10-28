// 図の中の文字(日本語 + $...$ の数式)を並べる。
// 画面では <text>(フォントは同梱の Noto Sans JP)と MathJax の SVG で描き、
// 書き出すときは同じ並べ方のまま、文字を輪郭の線(path)に変えて描く。
// こうすると、Mac でも Windows でも、PDF にしても見た目が変わらない。

// 使えるフォント(ほかのフォントを足すときはここに並べる。使うときに読み込む)
export const FONTS = {
  gothic: { url: new URL("../fonts/NotoSansJP-Regular.otf", import.meta.url).href, family: "DiagramJP", label: "ゴシック体(Noto Sans JP)" },
};
export const FONT_FAMILY = FONTS.gothic.family;
const MATHJAX_URL = new URL("../vendor/tex-svg-full.js", import.meta.url).href;

const ASC = 1.0, DESC = 0.25;   // 1 行の上と下の幅(文字の大きさに対する比)。合わせて行の間隔 1.25
const MATH_SCALE = 1.15;        // 数式の文字は日本語より小さく見えるので少し大きくする

const loadedFonts = {};         // opentype.js で読んだフォント(幅を測る・輪郭に変える)
const fontPromises = {};
let mathReady = false, mathPromise = null;
const listeners = new Set();
const cache = new Map();

// フォントや MathJax が読み込まれたら、描き直してもらう
export function onTextReady(fn) { listeners.add(fn); }
function changed() { cache.clear(); for (const fn of listeners) fn(); }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(s);
  });
}

// フォントを 1 回だけ読み込み、画面表示(FontFace)と幅の計算・輪郭(opentype.js)の両方に使う
let opentypePromise = null;
export function loadFont(key = "gothic") {
  if (!FONTS[key]) key = "gothic";
  if (fontPromises[key]) return fontPromises[key];
  const p = fontPromises[key] = (async () => {
    if (!window.opentype) await (opentypePromise ||= loadScript(new URL("../vendor/opentype.min.js", import.meta.url).href));
    const buf = await (await fetch(FONTS[key].url)).arrayBuffer();
    const face = new FontFace(FONTS[key].family, buf.slice(0));
    document.fonts.add(await face.load());
    loadedFonts[key] = window.opentype.parse(buf);
    changed();
    return loadedFonts[key];
  })();
  p.catch(e => { console.error(e); delete fontPromises[key]; });
  return p;
}

function loadMath() {
  if (mathPromise) return mathPromise;
  window.MathJax = {
    loader: { load: [] },
    tex: { packages: { "[-]": ["noundefined"] } },   // 知らない命令は「間違い」として扱う
    svg: { fontCache: "none" },                      // 文字の形を毎回そのまま入れる(書き出しで使いやすい)
    startup: { typeset: false },
  };
  mathPromise = loadScript(MATHJAX_URL)
    .then(() => window.MathJax.startup.promise)
    .then(() => { mathReady = true; changed(); });
  mathPromise.catch(e => { console.error(e); mathPromise = null; });
  return mathPromise;
}

// "$" で区切る。"\$" はふつうの "$"。数が合わないときは全部ふつうの文字にする
export function splitRuns(s) {
  const parts = [];
  let cur = "", math = false, n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "$") { cur += math ? "\\$" : "$"; i++; continue; }
    if (s[i] === "$") { parts.push({ math, t: cur }); cur = ""; math = !math; n++; continue; }
    cur += s[i];
  }
  parts.push({ math, t: cur });
  if (n % 2) return [{ math: false, t: s.replace(/\\\$/g, "$") }];
  return parts.filter(p => p.t !== "");
}

// 数式 1 つを MathJax で SVG にする。単位は 1000 = 文字 1 つ分、y = 0 が文字の並ぶ線(ベースライン)
const mathCache = new Map();
function mathSvg(tex) {
  if (mathCache.has(tex)) return mathCache.get(tex);
  let out;
  try {
    const node = window.MathJax.tex2svg(tex, { display: false });
    const svgEl = node.querySelector("svg");
    if (node.querySelector("[data-mjx-error]")) out = { err: node.querySelector("[data-mjx-error]").getAttribute("data-mjx-error") };
    else {
      const vb = svgEl.getAttribute("viewBox").split(/\s+/).map(Number);
      const body = Array.from(svgEl.children).filter(c => c.tagName !== "defs").map(c => c.outerHTML).join("");
      if (/<text/.test(body)) out = { err: "数式の中に日本語などがあります。日本語は $ の外に書いてください" };
      else out = { vb, body };
    }
  } catch (e) { out = { err: String(e.message || e) }; }
  mathCache.set(tex, out);
  return out;
}

const measureCtx = document.createElement("canvas").getContext("2d");
function textWidth(t, size, key) {
  if (loadedFonts[key]) return loadedFonts[key].getAdvanceWidth(t, size);
  measureCtx.font = `${size}px "Hiragino Sans", sans-serif`;   // フォントを読み込む前の仮の幅
  return measureCtx.measureText(t).width;
}

// 文字を並べる。返す位置は、(0, 0) を基準にした相対位置:
//   ha = "center" → 横の真ん中が x = 0、"left" → 左端が x = 0、"right" → 右端が x = 0
//   va = "center" → 縦の真ん中が y = 0、"top" → 上端が y = 0、"bottom" → 下端が y = 0
// 返り値 { runs: [{kind: "text"|"math", x, y(ベースライン), ...}], box: {x, y, w, h}, errors: [] }
// fontKey は FONTS の名前(省略でゴシック体)
export function layout(s, size, ha, va, fontKey = "gothic", styles = null) {
  if (Array.isArray(styles) && styles.some(Boolean)) return richLayout(String(s), size, ha, va, fontKey, styles);
  if (!FONTS[fontKey]) fontKey = "gothic";
  if (!loadedFonts[fontKey]) loadFont(fontKey);
  const key = `${fontKey}|${size}|${ha}|${va}|${s}`;
  if (cache.has(key)) return cache.get(key);
  const errors = [];
  const lines = String(s).split("\n").map(line => {
    const runs = [];
    let x = 0, asc = ASC * size, desc = DESC * size;
    for (const r of splitRuns(line)) {
      if (r.math) {
        if (!mathReady) { loadMath(); }
        const m = mathReady ? mathSvg(r.t) : null;
        if (m && !m.err) {
          const k = size * MATH_SCALE / 1000, [vx, vy, vw, vh] = m.vb;
          runs.push({ kind: "math", x, k, vx, body: m.body });
          x += vw * k;
          asc = Math.max(asc, -vy * k + 0.1 * size); desc = Math.max(desc, (vh + vy) * k + 0.1 * size);
          continue;
        }
        if (m && m.err) errors.push({ tex: r.t, msg: m.err });
        const t = "$" + r.t + "$";       // 読み込み中・間違いのときは、そのままの文字で出す
        runs.push({ kind: "text", x, t, raw: true, bad: !!(m && m.err) });
        x += textWidth(t, size, fontKey);
      } else {
        runs.push({ kind: "text", x, t: r.t });
        x += textWidth(r.t, size, fontKey);
      }
    }
    return { runs, w: x, asc, desc };
  });
  const totalH = lines.reduce((a, l) => a + l.asc + l.desc, 0), maxW = Math.max(0, ...lines.map(l => l.w));
  const top = va === "top" ? 0 : va === "bottom" ? -totalH : -totalH / 2;
  const left = w => ha === "left" ? 0 : ha === "right" ? -w : -w / 2;
  let y = top;
  const runs = [];
  for (const l of lines) {
    const base = y + l.asc, x0 = left(l.w);
    for (const r of l.runs) runs.push({ ...r, x: x0 + r.x, y: base });
    y += l.asc + l.desc;
  }
  const out = { runs, size, fontKey, errors, box: { x: left(maxW), y: top, w: maxW, h: totalH } };
  cache.set(key, out);
  return out;
}

// 部分書式付きの文字。保存位置は JavaScript の文字列と同じ UTF-16 の位置。
function richLayout(s, size, ha, va, fontKey, styles) {
  if (!FONTS[fontKey]) fontKey = "gothic";
  if (!loadedFonts[fontKey]) loadFont(fontKey);
  const errors = [], lines = []; let offset = 0;
  for (const line of s.split("\n")) {
    const runs = []; let x = 0, asc = ASC * size, desc = DESC * size, i = 0, dollars = 0;
    for (let j = 0; j < line.length; j++) { if (line[j] === "\\" && line[j + 1] === "$") { j++; continue; } if (line[j] === "$") dollars++; }
    const allowMath = dollars % 2 === 0;
    while (i < line.length) {
      const st = styles[offset + i] || {}, rs = Number(st.size) > 0 ? Math.min(96, Math.max(6, Number(st.size))) : size;
      const script = st.script === "super" ? "super" : st.script === "sub" ? "sub" : "normal";
      const drawSize = script === "normal" ? rs : rs * 0.72;
      const shift = script === "super" ? -rs * 0.38 : script === "sub" ? rs * 0.22 : 0;
      let end = i + (line.codePointAt(i) > 0xffff ? 2 : 1), math = false, tex = "", escaped = false;
      if (line[i] === "\\" && line[i + 1] === "$") { end = i + 2; escaped = true; }
      if (!escaped && allowMath && line[i] === "$" && (i === 0 || line[i - 1] !== "\\")) {
        let j = i + 1; while (j < line.length && (line[j] !== "$" || line[j - 1] === "\\")) j++;
        if (j < line.length) { end = j + 1; tex = line.slice(i + 1, j); math = true; }
      }
      if (!math && !escaped) {
        const sig = JSON.stringify(st);
        while (end < line.length && line[end] !== "$" && !(line[end] === "\\" && line[end + 1] === "$") && JSON.stringify(styles[offset + end] || {}) === sig)
          end += line.codePointAt(end) > 0xffff ? 2 : 1;
      }
      const t = escaped ? "$" : line.slice(i, end), color = /^#[0-9a-f]{6}$/i.test(st.color || "") ? st.color : null;
      const common = { x, size: drawSize, color, bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike, shift };
      if (math) {
        if (!mathReady) loadMath();
        const m = mathReady ? mathSvg(tex) : null;
        if (m && !m.err) {
          const k = drawSize * MATH_SCALE / 1000, [vx, vy, vw, vh] = m.vb;
          runs.push({ ...common, kind: "math", k, vx, w: vw * k, body: m.body }); x += vw * k;
          asc = Math.max(asc, -vy * k - shift + 0.1 * drawSize); desc = Math.max(desc, (vh + vy) * k + shift + 0.1 * drawSize);
        } else {
          if (m && m.err) errors.push({ tex, msg: m.err });
          const w = textWidth(t, drawSize, fontKey); runs.push({ ...common, kind: "text", t, w, bad: !!m?.err }); x += w;
        }
      } else {
        const w = textWidth(t, drawSize, fontKey); runs.push({ ...common, kind: "text", t, w }); x += w;
      }
      asc = Math.max(asc, drawSize - shift); desc = Math.max(desc, drawSize * DESC + shift);
      i = end;
    }
    lines.push({ runs, w: x, asc, desc }); offset += line.length + 1;
  }
  const totalH = lines.reduce((a, l) => a + l.asc + l.desc, 0), maxW = Math.max(0, ...lines.map(l => l.w));
  const top = va === "top" ? 0 : va === "bottom" ? -totalH : -totalH / 2;
  const left = w => ha === "left" ? 0 : ha === "right" ? -w : -w / 2;
  let y = top; const runs = [];
  for (const l of lines) {
    const base = y + l.asc, x0 = left(l.w);
    for (const r of l.runs) runs.push({ ...r, x: x0 + r.x, y: base + r.shift });
    y += l.asc + l.desc;
  }
  const pad = runs.some(r => r.italic || r.bold) ? Math.max(size, ...runs.map(r => r.size || size)) * .25 : 0;
  return { runs, size, fontKey, errors, box: { x: left(maxW) - pad, y: top, w: maxW + 2 * pad, h: totalH } };
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = v => Math.round(v * 100) / 100;

// 画面用の SVG(文字は <text>)。x, y は layout() の基準点。rot は (x, y) を中心に回す角度(度)
function decoration(r, x, y, color, size) {
  if (!r.w) return "";
  const parts = [];
  if (r.underline) parts.push(y + size * 0.1);
  if (r.strike) parts.push(y - size * 0.3);
  return parts.map(yy => `<path d="M${f1(x)} ${f1(yy)}h${f1(r.w)}" stroke="${color}" stroke-width="${f1(Math.max(1, size * .055))}"/>`).join("");
}
export function textMarkup(L, x, y, color = "#000", rot = 0) {
  let h = "";
  for (const r of L.runs) {
    const c = r.color || color, size = r.size || L.size, xx = x + r.x, yy = y + r.y;
    if (r.kind === "math") {
      const skew = r.italic ? " skewX(-12)" : "";
      h += `<g transform="translate(${f1(xx - r.vx * r.k)} ${f1(yy)})${skew} scale(${r.k})"${r.bold ? ` stroke="${c}" stroke-width="${f1(size * .045 / r.k)}" paint-order="stroke fill"` : ""}>${r.body.replace(/currentColor/g, c)}</g>`;
      h += decoration(r, xx, yy, c, size);
    } else {
      h += `<text x="${f1(xx)}" y="${f1(yy)}" font-size="${size}" font-family="${FONTS[L.fontKey].family}, 'Hiragino Sans', sans-serif" fill="${r.bad ? "#c62828" : c}"${r.bold ? ` stroke="${c}" stroke-width="${f1(size * .045)}" paint-order="stroke fill"` : ""}${r.italic ? ` transform="translate(${f1(xx)} ${f1(yy)}) skewX(-12) translate(${-f1(xx)} ${-f1(yy)})"` : ""} xml:space="preserve">${esc(r.t)}</text>`;
      h += decoration(r, xx, yy, c, size);
    }
  }
  return rot ? `<g transform="rotate(${rot} ${f1(x)} ${f1(y)})">${h}</g>` : h;
}
export function textOutlineMarkup(L, x, y, color = "#000", rot = 0) {
  let h = "";
  for (const r of L.runs) {
    const c = r.color || color, size = r.size || L.size, xx = x + r.x, yy = y + r.y;
    if (r.kind === "math") {
      const skew = r.italic ? " skewX(-12)" : "";
      h += `<g transform="translate(${f1(xx - r.vx * r.k)} ${f1(yy)})${skew} scale(${r.k})"${r.bold ? ` stroke="${c}" stroke-width="${f1(size * .045 / r.k)}" paint-order="stroke fill"` : ""}>${r.body.replace(/currentColor/g, c)}</g>`;
      h += decoration(r, xx, yy, c, size);
    } else {
      const d = loadedFonts[L.fontKey].getPath(r.t, xx, yy, size).toPathData(2);
      if (d) h += `<path d="${d}" fill="${c}"${r.bold ? ` stroke="${c}" stroke-width="${f1(size * .045)}" paint-order="stroke fill"` : ""}${r.italic ? ` transform="translate(${f1(xx)} ${f1(yy)}) skewX(-12) translate(${-f1(xx)} ${-f1(yy)})"` : ""}/>`;
      h += decoration(r, xx, yy, c, size);
    }
  }
  return rot ? `<g transform="rotate(${rot} ${f1(x)} ${f1(y)})">${h}</g>` : h;
}

// 書き出す前に、フォントと(数式があれば)MathJax の読み込みを待つ
export async function ready(texts, fontKeys = ["gothic"]) {
  await Promise.all([...new Set(fontKeys)].map(k => loadFont(k)));
  if (texts.some(t => splitRuns(t).some(r => r.math))) await loadMath();
}
