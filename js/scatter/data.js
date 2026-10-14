// Excel / CSV を読み込んで、表 { columns: [名前], rows: [[値]], numeric: [数値の列か] } にする。
// 値は 数値 / 文字列 / null(空)。

let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("../../vendor/xlsx.full.min.js", import.meta.url).href;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error("Excel を読む部品を読み込めませんでした")); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

export const isExcel = name => /\.(xlsx|xlsm|xls)$/i.test(name);

// ---------------------------------------------------------------- CSV
// 文字コード:UTF-8 として読めなければ Shift_JIS(Excel で作った CSV に多い)
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch (e) { return new TextDecoder("shift_jis").decode(buf); }
}

// 区切り文字(カンマ・タブ・セミコロン)を、最初の数行で一番そろっているものに決める
function sniff(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";"]) {
    const counts = lines.map(l => splitLine(l, d).length);
    const top = Math.max(0, ...counts);
    if (top < 2) continue;
    const score = counts.filter(c => c === top).length * 10 + top;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
function splitLine(line, d) { return parseCSV(line, d)[0] || []; }

// " で囲んだ欄(中にカンマや改行があってもよい)にも対応する
function parseCSV(text, d) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- 読み込み
export async function sheetNames(item) {
  if (!item.excel) return [];
  const XLSX = await loadXLSX();
  return XLSX.read(item.raw, { type: "array", bookSheets: true }).SheetNames;
}

// シートの中身を、行の並び(セルの値の配列)として読む
export async function readRows(item, sheet) {
  if (item.excel) {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(item.raw, { type: "array" });
    const ws = wb.Sheets[sheet && wb.Sheets[sheet] ? sheet : wb.SheetNames[0]];
    if (!ws || !ws["!ref"]) return [];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.s.r = 0; range.s.c = 0;               // 表がシートの途中から始まっていても、上から数える
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range });
  }
  const text = decode(item.raw);
  return parseCSV(text, sniff(text));
}

// item: { name, excel, raw: ArrayBuffer }。sheet はシートの名前(省略で最初)、skip は上から飛ばす行数
export async function parseFile(item, sheet, skip = 0) {
  return clean((await readRows(item, sheet)).slice(skip));
}

// 表の上にタイトルやメモの行があるとき、列の名前の行を探す(数値の列がいちばん多くなる飛ばし方。同じなら少ない方)
export function guessSkip(rows) {
  let best = 0, bestN = -1;
  for (let k = 0; k <= Math.min(15, rows.length - 2); k++) {
    const t = clean(rows.slice(k));
    const n = t.numeric.filter(Boolean).length;
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

// ---------------------------------------------------------------- 数値に直す
const blank = v => v == null || (typeof v === "string" && v.trim() === "");

// 「1,200」「１２」「−3.5」のような文字も数値にする。数値にできなければ NaN
export function toNumber(v) {
  if (typeof v === "number") return v;
  if (blank(v)) return NaN;
  const s = String(v).normalize("NFKC").replace(/,/g, "").replace(/[−‒–—]/g, "-").trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

// 空の行・列を消し、1 行目を列の名前にして、ほとんど数値の列を数値の列にする
// blankName(c) を渡すと、名前のない列も消さずにその名前で残す(範囲を選んだときに使う)
export function clean(rows, blankName) {
  rows = rows.map(r => (r || []).map(v => blank(v) ? null : v));
  const header = rows[0] || [];
  let body = rows.slice(1).filter(r => r.some(v => v != null));
  const ncol = Math.max(header.length, ...body.map(r => r.length), 0);
  let keep = [];
  for (let c = 0; c < ncol; c++) {
    const name = header[c] == null || String(header[c]).trim() === "" ? (blankName ? blankName(c) : "") : String(header[c]).trim();
    if (!name) continue;                                   // 名前のない列は使わない
    if (!body.some(r => r[c] != null)) continue;           // 中身が空の列も使わない
    keep.push({ c, name });
  }
  const seen = {};
  const columns = keep.map(({ name }) => {                 // 同じ名前は「名前.1」のように区別する
    if (seen[name] == null) { seen[name] = 0; return name; }
    return `${name}.${++seen[name]}`;
  });
  body = body.map(r => keep.map(({ c }) => r[c] ?? null));
  const numeric = keep.map((_, j) => {
    const vals = body.map(r => r[j]).filter(v => v != null);
    if (!vals.length) return false;
    const nums = vals.map(toNumber);
    const ok = nums.filter(Number.isFinite).length;
    if (ok < 0.8 * vals.length) return false;
    body.forEach(r => { if (r[j] != null) { const n = toNumber(r[j]); r[j] = Number.isFinite(n) ? n : null; } });
    return true;
  });
  return { columns, rows: body, numeric };
}

export const numericColumns = t => t.columns.filter((_, j) => t.numeric[j]);
export const column = (t, name) => { const j = t.columns.indexOf(name); return j < 0 ? [] : t.rows.map(r => r[j]); };

// ---------------------------------------------------------------- 元のファイルで選んだ範囲
// 列の記号(0 → A、25 → Z、26 → AA)と、範囲の書き方(B3:D20)
export function colLetter(c) {
  let s = "";
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}
export const rangeLabel = r => `${colLetter(r.c0)}${r.r0 + 1}:${colLetter(r.c1)}${r.r1 + 1}`;

// range = { r0, c0, r1, c1, header }(0 から数える。header = 1 行目を列の名前にするか)
export function tableFromRange(rows, range) {
  const part = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row = rows[r] || [];
    part.push(Array.from({ length: range.c1 - range.c0 + 1 }, (_, k) => row[range.c0 + k] ?? null));
  }
  const name = k => `列${colLetter(range.c0 + k)}`;
  if (!range.header) part.unshift(part[0] ? part[0].map((_, k) => name(k)) : []);
  return clean(part, name);
}

// ファイルの行の並びから、グラフに使う表を作る(範囲を選んでいればその範囲、なければ上から skip 行を飛ばす)
export const buildTable = (rows, f) => f.range ? tableFromRange(rows, f.range) : clean(rows.slice(f.skip || 0));
