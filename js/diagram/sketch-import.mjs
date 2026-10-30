// AI が返すデータ専用の狭い形式。JSON を実行せず、検証後に既存の図形式へ変換する。
export const SKETCH_MAX_BYTES = 256 * 1024;
export const SKETCH_MAX_NODES = 200;
export const SKETCH_MAX_EDGES = 300;
const MAX_COORD = 10000, MAX_SIZE = 2000, MAX_TEXT = 500, MAX_WARNINGS = 50;
const nodeTypes = new Set(["rect", "ellipse", "note", "text", "trap", "poly"]);
const sides = new Set(["left", "right", "top", "bottom"]);
const arrows = new Set(["none", "end", "both"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function fail(message) { throw new Error(message); }
function obj(v, path, required, optional = []) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${path} はオブジェクトにしてください。`);
  for (const k of Object.keys(v)) if (![...required, ...optional].includes(k)) fail(`${path} に未対応の項目「${k}」があります。`);
  for (const k of required) if (!own(v, k)) fail(`${path} に「${k}」が必要です。`);
}
function list(v, path, max) { if (!Array.isArray(v) || v.length > max) fail(`${path} は ${max} 件以下の配列にしてください。`); }
function number(v, path, min, max) { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(`${path} は ${min}〜${max} の有限の数値にしてください。`); return v; }
function text(v, path, max = MAX_TEXT) {
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail(`${path} は ${max} 文字以内の文字列にしてください。`);
  return v;
}
function id(v, path) { if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(v)) fail(`${path} は英字で始まる 40 文字以内の英数字・_・- にしてください。`); return v; }
// 図の数式記法として処理されないよう、入力された $ は文字として扱う。
const literalText = s => s.replace(/\$/g, "\\$");
// JSON.parse は重複キーを最後の値で上書きするため、曖昧な入力を別途拒否する。
function rejectDuplicateKeys(source) {
  let p = 0;
  const ws = () => { while (/\s/.test(source[p] || "") && p < source.length) p++; };
  function str() {
    const start = p++;
    while (p < source.length) { const c = source[p++]; if (c === "\\") p++; else if (c === '"') return JSON.parse(source.slice(start, p)); }
    fail("文字列を読み取れません。");
  }
  function value(depth) {
    if (depth > 16) fail("JSON の入れ子が深すぎます。");
    ws(); const c = source[p];
    if (c === '"') { str(); return; }
    if (c === "{") {
      p++; ws(); const keys = new Set(); if (source[p] === "}") { p++; return; }
      while (true) {
        ws(); const key = str(); if (keys.has(key)) fail(`項目「${key}」が重複しています。`); keys.add(key);
        ws(); p++; value(depth + 1); ws(); if (source[p++] === "}") return;
      }
    }
    if (c === "[") {
      p++; ws(); if (source[p] === "]") { p++; return; }
      while (true) { value(depth + 1); ws(); if (source[p++] === "]") return; }
    }
    while (p < source.length && !/[\s,\]}]/.test(source[p])) p++;
  }
  value(0);
}

export function parseSketch(input) {
  if (typeof input !== "string") fail("JSON を入力してください。");
  if (new TextEncoder().encode(input).length > SKETCH_MAX_BYTES) fail("JSON は 256 KB 以下にしてください。");
  let data; try { data = JSON.parse(input); } catch { fail("JSON を読み取れません。形式を確認してください。"); }
  rejectDuplicateKeys(input);
  obj(data, "全体", ["version", "nodes", "edges", "uncertain"]);
  if (data.version !== 1) fail("version は 1 にしてください。");
  list(data.nodes, "nodes", SKETCH_MAX_NODES); list(data.edges, "edges", SKETCH_MAX_EDGES); list(data.uncertain, "uncertain", MAX_WARNINGS);
  if (!data.nodes.length && !data.edges.length) fail("図形か線を 1 件以上入れてください。");
  const ids = new Set(), nodes = new Map(), items = [];
  let totalText = 0;
  const limitText = value => { totalText += value.length; if (totalText > 20000) fail("文字の合計は 20000 文字以下にしてください。"); return value; };
  const unique = (value, path) => { const key = id(value, path); if (ids.has(key)) fail(`${path} の ID が重複しています。`); ids.add(key); return key; };
  data.nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!n || typeof n !== "object" || Array.isArray(n) || !nodeTypes.has(n.type)) fail(`${path}.type は rect・ellipse・note・text・trap・poly のいずれかにしてください。`);
    const keys = ["id", "type", "x", "y", "w", "h", "text"];
    if (n.type === "trap") keys.push("trapDir", "inset");
    if (n.type === "poly") keys.push("sides");
    obj(n, path, keys);
    const key = unique(n.id, `${path}.id`);
    const x = number(n.x, `${path}.x`, 0, MAX_COORD), y = number(n.y, `${path}.y`, 0, MAX_COORD);
    const w = number(n.w, `${path}.w`, 10, MAX_SIZE), h = number(n.h, `${path}.h`, 10, MAX_SIZE);
    if (x + w > MAX_COORD || y + h > MAX_COORD) fail(`${path} の図形が座標の上限を超えています。`);
    const value = literalText(limitText(text(n.text, `${path}.text`)));
    const item = { id: items.length + 1, type: n.type, x, y, w, h, text: value, fontSize: n.type === "note" || n.type === "text" ? 18 : 22, lw: n.type === "note" || n.type === "text" ? 1 : 1.5, fill: n.type === "text" ? "none" : "#ffffff" };
    if (n.type === "trap") {
      if (!["top", "bottom", "left", "right"].includes(n.trapDir)) fail(`${path}.trapDir は top・bottom・left・right のいずれかにしてください。`);
      item.trapDir = n.trapDir; item.inset = number(n.inset, `${path}.inset`, 0, .45);
    }
    if (n.type === "poly") {
      if (!Number.isInteger(n.sides) || n.sides < 3 || n.sides > 12) fail(`${path}.sides は 3〜12 の整数にしてください。`);
      item.sides = n.sides;
    }
    items.push(item); nodes.set(key, item);
  });
  function endpoint(v, path) {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${path} は接続先または座標にしてください。`);
    if (own(v, "node")) {
      obj(v, path, ["node", "side"]); const key = id(v.node, `${path}.node`), n = nodes.get(key);
      if (!n) fail(`${path} の接続先「${key}」が見つかりません。`);
      if (["text", "trap", "poly"].includes(n.type)) fail(`${path} は文字・台形・多角形への接続を指定できません。接続が不確かなら注意事項に記載してください。`);
      if (!sides.has(v.side)) fail(`${path}.side は left・right・top・bottom のいずれかにしてください。`);
      if (n.type === "ellipse") return { id: n.id, ang: { right: 0, bottom: Math.PI / 2, left: Math.PI, top: -Math.PI / 2 }[v.side] };
      const [ax, ay] = { left: [0, .5], right: [1, .5], top: [.5, 0], bottom: [.5, 1] }[v.side];
      return { id: n.id, ax, ay };
    }
    obj(v, path, ["x", "y"]);
    return { x: number(v.x, `${path}.x`, 0, MAX_COORD), y: number(v.y, `${path}.y`, 0, MAX_COORD) };
  }
  data.edges.forEach((e, i) => {
    const path = `edges[${i}]`; obj(e, path, ["id", "from", "to", "arrow", "label"]); unique(e.id, `${path}.id`);
    if (!arrows.has(e.arrow)) fail(`${path}.arrow は none・end・both のいずれかにしてください。`);
    const from = endpoint(e.from, `${path}.from`), to = endpoint(e.to, `${path}.to`);
    if (from.id != null && from.id === to.id) fail(`${path} の同じ図形に戻る線は未対応です。注意事項に記載してください。`);
    if (from.id == null && to.id == null && from.x === to.x && from.y === to.y) fail(`${path} の始点と終点は別の位置にしてください。`);
    items.push({ id: items.length + 1, type: "edge", style: "straight", from, to, label: literalText(limitText(text(e.label, `${path}.label`))), fontSize: 18, lw: 1.5, arrow: e.arrow, dash: false, wire: false });
  });
  const warnings = data.uncertain.map((v, i) => text(v, `uncertain[${i}]`, 300));
  if (warnings.some(v => !v.trim())) fail("注意事項は空にせず、内容を書いてください。");
  let maxX = 0, maxY = 0;
  for (const item of items) {
    if (item.type === "edge") {
      for (const end of [item.from, item.to]) if (end.id == null) { maxX = Math.max(maxX, end.x); maxY = Math.max(maxY, end.y); }
    } else { maxX = Math.max(maxX, item.x + item.w); maxY = Math.max(maxY, item.y + item.h); }
  }
  const W = Math.max(1600, Math.ceil((maxX + 200) / 100) * 100), H = Math.max(1000, Math.ceil((maxY + 200) / 100) * 100);
  return { doc: { grid: 20, snap: true, snapEdge: true, showGrid: true, W, H, items, nextId: items.length + 1 }, warnings };
}

export const SKETCH_PROMPT = `添付した手書き図を、以下の仕様の JSON だけに変換してください。説明や Markdown は付けないでください。\n座標は左上が (0,0)、右と下を正とし、0〜10000 の範囲にしてください。\n図形は rect（四角）、ellipse（楕円）、note（注釈枠）、text（文字）、trap（台形）、poly（多角形）だけです。各図形は id, type, x, y, w, h, text を持ち、w と h は 10〜2000 です。ID は英字で始まる英数字、_、- の組み合わせで重複させないでください。文字は 500 文字以内、装飾や数式の解釈は行いません。台形には短い辺を示す trapDir（top・bottom・left・right）と inset（0〜0.45）を、多角形には sides（3〜12 の整数）を追加してください。\n線は直線のみです。各線は id, from, to, arrow, label を持ちます。端点は {"node":"図形ID","side":"left|right|top|bottom"} または {"x":数値,"y":数値} とし、文字・台形・多角形への接続や同じ図形に戻る線は使わないでください。arrow は none（矢印なし）、end（終点に矢印）、both（両端に矢印）のいずれかです。\n画像から判断できない図形や接続、曲線、折れ線、論理ゲートなど未対応の要素は推測して確定せず、uncertain に日本語で列挙してください。不確かな接続は edges に追加しないでください。追加キーは禁止です。\n形式例: {"version":1,"nodes":[{"id":"a","type":"rect","x":100,"y":100,"w":160,"h":80,"text":"開始"},{"id":"b","type":"ellipse","x":400,"y":100,"w":160,"h":80,"text":"終了"}],"edges":[{"id":"e1","from":{"node":"a","side":"right"},"to":{"node":"b","side":"left"},"arrow":"end","label":""}],"uncertain":[]}\nnodes は 200 件以下、edges は 300 件以下、uncertain は 50 件以下、文字の合計は 20000 文字以下、JSON 全体は 256 KB 以下にしてください。`;
