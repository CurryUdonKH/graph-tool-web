import { TERMINAL_MODES } from "./terminal-marks.mjs";
import { analyzeCircuit, circuitPins, circuitRouteConflict, circuitPathCrossesBody, CIRCUIT_TYPES } from "./circuit-model.mjs";
// AI が返すデータ専用の狭い形式。JSON を実行せず、検証後に既存の図形式へ変換する。
export const SKETCH_MAX_BYTES = 256 * 1024;
export const SKETCH_MAX_NODES = 200;
export const SKETCH_MAX_EDGES = 300;
const MAX_COORD = 10000, MAX_SIZE = 10000, MAX_TEXT = 500, MAX_WARNINGS = 50;
const TARGET_SPAN = 800, MARGIN = 100;
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
  // 外側が単一のフェンスで完全に包まれている場合だけ、その囲みを取り除く。
  // サイズ制限は囲みを含む元の入力に適用し、内容は JSON としてのみ解釈する。
  const trimmed = input.trim();
  let source = input;
  if (trimmed.startsWith("```")) {
    const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/.exec(trimmed);
    if (!fence) fail("JSON は単一のコードブロックで囲むか、そのまま貼り付けてください。前後の説明や複数のブロックは使えません。");
    source = fence[1];
  }
  let data; try { data = JSON.parse(source); } catch { fail("JSON を読み取れません。JSON だけ、または JSON を囲む単一のコードブロックだけを貼り付けてください。"); }
  rejectDuplicateKeys(source);
  if (data && data.version === 2) return parseCircuitSketch(data);
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
    if (!n || typeof n !== "object" || Array.isArray(n) || !nodeTypes.has(n.type)) {
      const value = n && typeof n.type === "string" ? `「${n.type.slice(0, 40)}」` : "";
      fail(`${path}.type ${value}は未対応です。対応する種類は rect・ellipse・note・text・trap・poly です。`);
    }
    const keys = ["id", "type", "x", "y", "w", "h", "text"];
    if (n.type === "trap") keys.push("trapDir", "inset");
    if (n.type === "poly") keys.push("sides");
    obj(n, path, keys, ["fontSize"]);
    const key = unique(n.id, `${path}.id`);
    const x = number(n.x, `${path}.x`, 0, MAX_COORD), y = number(n.y, `${path}.y`, 0, MAX_COORD);
    const w = number(n.w, `${path}.w`, 10, MAX_SIZE), h = number(n.h, `${path}.h`, 10, MAX_SIZE);
    if (x + w > MAX_COORD || y + h > MAX_COORD) fail(`${path} の図形が座標の上限を超えています。`);
    const value = literalText(limitText(text(n.text, `${path}.text`)));
    const item = { id: items.length + 1, type: n.type, x, y, w, h, text: value, fontSize: n.type === "note" || n.type === "text" ? 18 : 22, lw: n.type === "note" || n.type === "text" ? 1 : 1.5, fill: n.type === "text" ? "none" : "#ffffff" };
    if (own(n, "fontSize")) item.sourceFontSize = number(n.fontSize, `${path}.fontSize`, 1, Math.min(2000, h));
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
      obj(v, path, ["node"], ["side", "angle"]); const key = id(v.node, `${path}.node`), n = nodes.get(key);
      if (!n) fail(`${path} の接続先「${key}」が見つかりません。`);
      if (own(v, "side") === own(v, "angle")) fail(`${path} は side か angle のどちらか一方を指定してください。`);
      if (own(v, "angle")) {
        if (n.type !== "ellipse") fail(`${path}.angle は楕円にのみ指定できます。`);
        return { id: n.id, ang: number(v.angle, `${path}.angle`, -180, 180) * Math.PI / 180 };
      }
      if (["text", "trap", "poly"].includes(n.type)) fail(`${path} は文字・台形・多角形への接続を指定できません。接続が不確かなら注意事項に記載してください。`);
      if (!sides.has(v.side)) fail(`${path}.side は left・right・top・bottom のいずれかにしてください。`);
      if (n.type === "ellipse") return { id: n.id, ang: { right: 0, bottom: Math.PI / 2, left: Math.PI, top: -Math.PI / 2 }[v.side] };
      const [ax, ay] = { left: [0, .5], right: [1, .5], top: [.5, 0], bottom: [.5, 1] }[v.side];
      return { id: n.id, ax, ay };
    }
    obj(v, path, ["x", "y"]);
    return { x: number(v.x, `${path}.x`, 0, MAX_COORD), y: number(v.y, `${path}.y`, 0, MAX_COORD) };
  }
  const coords = [];
  const point = (v, path) => {
    obj(v, path, ["x", "y"]);
    return { x: number(v.x, `${path}.x`, 0, MAX_COORD), y: number(v.y, `${path}.y`, 0, MAX_COORD) };
  };
  function anchor(end) {
    if (end.id == null) return end;
    const n = items.find(it => it.id === end.id);
    if (end.ang != null) return { x: n.x + n.w / 2 * (1 + Math.cos(end.ang)), y: n.y + n.h / 2 * (1 + Math.sin(end.ang)) };
    return { x: n.x + n.w * end.ax, y: n.y + n.h * end.ay };
  }
  data.edges.forEach((e, i) => {
    const path = `edges[${i}]`; obj(e, path, ["id", "from", "to", "arrow", "label"], ["style", "control1", "control2"]); unique(e.id, `${path}.id`);
    const style = e.style ?? "straight";
    if (!["straight", "curve"].includes(style)) fail(`${path}.style は straight・curve のいずれかにしてください。`);
    if (style === "curve" && (!own(e, "control1") || !own(e, "control2"))) fail(`${path} の曲線には control1 と control2 が必要です。`);
    if (style === "straight" && (own(e, "control1") || own(e, "control2"))) fail(`${path} の直線には制御点を指定できません。`);
    if (!arrows.has(e.arrow)) fail(`${path}.arrow は none・end・both のいずれかにしてください。`);
    const from = endpoint(e.from, `${path}.from`), to = endpoint(e.to, `${path}.to`);
    if (from.id != null && from.id === to.id) fail(`${path} の同じ図形に戻る線は未対応です。注意事項に記載してください。`);
    if (from.id == null && to.id == null && from.x === to.x && from.y === to.y) fail(`${path} の始点と終点は別の位置にしてください。`);
    const item = { id: items.length + 1, type: "edge", style, from, to, label: literalText(limitText(text(e.label, `${path}.label`))), fontSize: 18, lw: 1.5, arrow: e.arrow, dash: false, wire: false };
    if (style === "curve") {
      const c1 = point(e.control1, `${path}.control1`), c2 = point(e.control2, `${path}.control2`);
      const a = anchor(from), b = anchor(to);
      item.c1 = { dx: c1.x - a.x, dy: c1.y - a.y }; item.c2 = { dx: c2.x - b.x, dy: c2.y - b.y };
      coords.push(c1, c2);
    }
    items.push(item);
  });
  const warnings = data.uncertain.map((v, i) => text(v, `uncertain[${i}]`, 300));
  if (warnings.some(v => !v.trim())) fail("注意事項は空にせず、内容を書いてください。");
  // 余白を除く全要素と制御点に、共通の倍率を適用する。小さな図は拡大しない。
  for (const item of items) {
    if (item.type === "edge") coords.push(anchor(item.from), anchor(item.to));
    else coords.push({ x: item.x, y: item.y }, { x: item.x + item.w, y: item.y + item.h });
  }
  const minX = Math.min(...coords.map(p => p.x)), minY = Math.min(...coords.map(p => p.y));
  const maxX = Math.max(...coords.map(p => p.x)), maxY = Math.max(...coords.map(p => p.y));
  const scale = Math.min(1, TARGET_SPAN / Math.max(1, maxX - minX, maxY - minY));
  for (const item of items) {
    if (item.type === "edge") {
      for (const end of [item.from, item.to]) if (end.id == null) { end.x = MARGIN + (end.x - minX) * scale; end.y = MARGIN + (end.y - minY) * scale; }
      for (const c of [item.c1, item.c2]) if (c) { c.dx *= scale; c.dy *= scale; }
    } else {
      item.x = MARGIN + (item.x - minX) * scale; item.y = MARGIN + (item.y - minY) * scale;
      item.w *= scale; item.h *= scale;
      item.fontSize = item.sourceFontSize == null
        ? Math.max(8, Math.min(item.fontSize, item.h * .35))
        : Math.max(8, item.sourceFontSize * scale);
      delete item.sourceFontSize;
    }
  }
  if (data.nodes.some(n => n.w === 2000 || n.h === 2000)) warnings.push("図形の幅または高さが以前の上限 2000 です。元画像の縦横比が保たれているか確認してください。");
  const W = Math.max(1600, Math.ceil((MARGIN * 2 + (maxX - minX) * scale) / 100) * 100), H = Math.max(1000, Math.ceil((MARGIN * 2 + (maxY - minY) * scale) / 100) * 100);
  return { doc: { grid: 20, snap: true, snapEdge: true, showGrid: true, W, H, items, nextId: items.length + 1 }, warnings };
}

// 回路は通常の図と別の形式を使い、端子と接続点の ID だけでつなぐ。
function parseCircuitSketch(data) {
  obj(data, "全体", ["version", "components", "junctions", "wires", "uncertain"], ["annotations"]);
  list(data.components, "components", SKETCH_MAX_NODES); list(data.junctions, "junctions", SKETCH_MAX_NODES); list(data.wires, "wires", SKETCH_MAX_EDGES); list(data.uncertain, "uncertain", MAX_WARNINGS);
  const annotations = data.annotations ?? []; list(annotations, "annotations", SKETCH_MAX_EDGES);
  if (!data.components.length && !data.junctions.length && !data.wires.length && !annotations.length) fail("部品、接続点、配線、または注釈が必要です。");
  const ids = new Set(), byId = new Map(), items = [], components = [], junctions = [], wires = [];
  const unique = (v, path) => { const k = id(v, path); if (ids.has(k)) fail(`${path} の ID が重複しています。`); ids.add(k); return k; };
  let snapped = false;
  const coord = (v, path) => {
    number(v, path, 80, 9920);
    const rounded = Math.round(v / 20) * 20;
    if (rounded !== v) snapped = true;
    return rounded;
  };
  // 明示的な $...$ を数式として扱い、単独の I_ph 等は複数文字の添字にする。
  // 通常の文章・日本語・単位はそのまま保持する。
  const label = (v, path) => {
    const s = text(v, path, 100), sub = /^([A-Za-z])_([A-Za-z0-9]+)$/.exec(s);
    return sub ? `$${sub[1]}_{${sub[2]}}$` : s;
  };
  data.components.forEach((c, i) => {
    const path = `components[${i}]`; obj(c, path, ["id", "type", "x", "y", "rotation", "name", "value"], ["polarized", "pinLabels", "closed", "pinNumbers"]);
    const key = unique(c.id, `${path}.id`), spec = CIRCUIT_TYPES[c.type];
    if (!Object.hasOwn(CIRCUIT_TYPES, c.type) || !spec) fail(`${path}.type は対応する回路部品にしてください。`);
    const x = coord(c.x, `${path}.x`), y = coord(c.y, `${path}.y`);
    if (![0, 90, 180, 270].includes(c.rotation)) fail(`${path}.rotation は 0・90・180・270 にしてください。`);
    if (c.polarized !== undefined && (c.type !== "capacitor" || typeof c.polarized !== "boolean")) fail(`${path}.polarized はコンデンサの真偽値にしてください。`);
    if (c.closed !== undefined && (c.type !== "switch" || typeof c.closed !== "boolean")) fail(`${path}.closed はスイッチの真偽値にしてください。`);
    if (c.pinLabels !== undefined && (!["nmos", "pmos", "opamp", "optocoupler"].includes(c.type) || typeof c.pinLabels !== "boolean")) fail(`${path}.pinLabels は端子表記のある部品の真偽値にしてください。`);
    if (c.pinNumbers !== undefined) {
      if (!['opamp','optocoupler'].includes(c.type)) fail(`${path}.pinNumbers はオペアンプかフォトカプラに指定してください。`);
      obj(c.pinNumbers, `${path}.pinNumbers`, [], spec.pins);
      for (const [pin, value] of Object.entries(c.pinNumbers)) text(value, `${path}.pinNumbers.${pin}`, 8);
    }
    const name = label(c.name, `${path}.name`), value = label(c.value, `${path}.value`);
    const vertical = c.type !== "ground" && c.rotation % 180 !== 0, w = vertical ? spec.height : spec.width, h = vertical ? spec.width : spec.height;
    const item = { id: items.length + 1, type: "circuit", kind: c.type, x: x - w / 2, y: y - h / 2, w, h, rotation: c.rotation, name, value, text: "", fontSize: 16, lw: 1.5, fill: "none", ...(c.polarized ? { polarized: true } : {}), ...(c.pinLabels !== undefined ? { pinLabels: c.pinLabels } : {}), ...(c.closed !== undefined ? { closed: c.closed } : {}), ...(c.pinNumbers ? {pinNumbers:{...c.pinNumbers}} : {}) };
    items.push(item); byId.set(key, item); components.push({ id: key, type: c.type, x, y, rotation: c.rotation });
  });
  data.junctions.forEach((j, i) => {
    const path = `junctions[${i}]`; obj(j, path, ["id", "x", "y"]); const key = unique(j.id, `${path}.id`), x = coord(j.x, `${path}.x`), y = coord(j.y, `${path}.y`);
    const item = { id: items.length + 1, type: "circuit-junction", x: x - 5, y: y - 5, w: 10, h: 10, text: "", fontSize: 16, lw: 1.5, fill: "#000000" };
    items.push(item); byId.set(key, item); junctions.push({ id: key, x, y });
  });
  const ref = (r, path) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) fail(`${path} を指定してください。`);
    if (own(r, "component")) { obj(r, path, ["component", "pin"]); id(r.component, `${path}.component`); id(r.pin, `${path}.pin`); return { component: r.component, pin: r.pin }; }
    if (own(r, "junction")) { obj(r, path, ["junction"]); id(r.junction, `${path}.junction`); return { junction: r.junction }; }
    obj(r, path, ["x", "y"]); return { x: coord(r.x, `${path}.x`), y: coord(r.y, `${path}.y`) };
  };
  data.wires.forEach((w, i) => {
    const path = `wires[${i}]`; obj(w, path, ["id", "from", "to", "points"], ["terminalEnds"]); const key = unique(w.id, `${path}.id`);
    list(w.points, `${path}.points`, 100);
    const points = w.points.map((p, j) => { obj(p, `${path}.points[${j}]`, ["x", "y"]); return { x: coord(p.x, `${path}.points[${j}].x`), y: coord(p.y, `${path}.points[${j}].y`) }; });
    if (w.terminalEnds !== undefined && !TERMINAL_MODES.includes(w.terminalEnds)) fail(`${path}.terminalEnds は auto・none・start・end・both のいずれかにしてください。`);
    wires.push({ id: key, from: ref(w.from, `${path}.from`), to: ref(w.to, `${path}.to`), points, terminalEnds: w.terminalEnds ?? "auto" });
  });
  try { analyzeCircuit({ components, junctions, wires }); }
  catch (e) { if (snapped) fail(`グリッドに合わせた結果、配線の形や接続を確認できません。${e.message}`); throw e; }
  const position = r => r.component ? circuitPins(components.find(c => c.id === r.component))[r.pin] : r.junction ? junctions.find(j => j.id === r.junction) : r;
  const docRef = r => r.component ? { id: byId.get(r.component).id, pin: r.pin } : r.junction ? { id: byId.get(r.junction).id } : { x: r.x, y: r.y };
  const allNodes = [...components.flatMap(c => Object.entries(circuitPins(c)).map(([pin, p]) => ({ ...p, id: byId.get(c.id).id, pin }))), ...junctions.map(j => ({ x: j.x, y: j.y, id: byId.get(j.id).id }))];
  for (let i = 0; i < allNodes.length; i++) for (let j = i + 1; j < allNodes.length; j++) if (allNodes[i].x === allNodes[j].x && allNodes[i].y === allNodes[j].y) fail("端子または接続点が重なっています。グリッド調整後の配置を確認してください。");
  const paths = wires.map(w => ({ points: [position(w.from), ...w.points, position(w.to)], ends: [docRef(w.from), docRef(w.to)] }));
  for (let i = 0; i < paths.length; i++) if (circuitRouteConflict(paths[i].points, paths[i].ends, paths.filter((_, k) => i !== k), allNodes) || items.some(item => item.type === "circuit" && circuitPathCrossesBody(paths[i].points, item))) fail(`wires[${i}] は接続が曖昧になるため、端子・接続点と配線を確認してください。`);
  wires.forEach(w => items.push({ id: items.length + 1, type: "edge", style: "elbow", from: docRef(w.from), to: docRef(w.to), points: w.points, label: "", fontSize: 16, lw: 1.5, arrow: "none", dash: false, wire: false, circuitWire: true, terminalEnds: w.terminalEnds }));
  const annotationPoints = [];
  annotations.forEach((a, i) => {
    const path = `annotations[${i}]`; obj(a, path, ["id", "from", "to", "label"], ["fontSize"]); unique(a.id, `${path}.id`);
    const point = (p, name) => { obj(p, name, ["x", "y"]); return { x: coord(p.x, `${name}.x`), y: coord(p.y, `${name}.y`) }; };
    const from = point(a.from, `${path}.from`), to = point(a.to, `${path}.to`);
    if (from.x === to.x && from.y === to.y) fail(`${path} の矢印の始点と終点は別の位置にしてください。`);
    const fontSize = a.fontSize === undefined ? 16 : number(a.fontSize, `${path}.fontSize`, 6, 96);
    items.push({ id: items.length + 1, type: "edge", style: "straight", from, to, label: label(a.label, `${path}.label`), fontSize, lw: 1.5, arrow: "end", dash: false, wire: false, annotation: true });
    annotationPoints.push(from, to);
  });
  const warnings = data.uncertain.map((v, i) => text(v, `uncertain[${i}]`, 300));
  if (warnings.some(v => !v.trim())) fail("注意事項は空にせず、内容を書いてください。");
  if (snapped) warnings.push("座標を20間隔のグリッドに合わせました。記号、配線と矢印の位置を見本で確認してください。");
  const allPoints = [...allNodes, ...paths.flatMap(p => p.points), ...annotationPoints];
  if (allPoints.length && (Math.max(...allPoints.map(p => p.x)) - Math.min(...allPoints.map(p => p.x)) > 2000 || Math.max(...allPoints.map(p => p.y)) - Math.min(...allPoints.map(p => p.y)) > 2000)) warnings.push("回路全体に対して固定サイズの記号や文字が小さく見える可能性があります。配線間隔を確認してください。");
  return { doc: { grid: 20, snap: true, snapEdge: true, showGrid: true, W: Math.max(1600, ...allPoints.map(p => p.x + 200)), H: Math.max(1000, ...allPoints.map(p => p.y + 200)), circuitSketch: true, items, nextId: items.length + 1 }, warnings };
}

export const SKETCH_PROMPT = `添付した手書き図を、以下の仕様の JSON に変換してください。回答は単一の json コードブロック（\`\`\`json で始まり \`\`\` で終わる形式）だけにし、ブロックの前後に説明や別の文章を付けないでください。
画像全体の左上を (0,0) とし、右と下を正とする共通の座標系で、画像内の位置と形の比率を保ってください。画像の縦横それぞれを別々に正規化しないでください。画像が大きい場合は全体の x・y・幅・高さ・制御点に同じ倍率を掛け、全座標と図形の端が 0〜10000 に収まるようにしてください。図形ごとの幅・高さだけを上限に丸めないでください。楕円の幅と高さの比を原画に合わせてください。最小の図形は幅・高さとも 10 以上です。
図形は rect（四角）、ellipse（楕円）、note（注釈枠）、text（文字）、trap（台形）、poly（多角形）です。各図形は id, type, x, y, w, h, text を持ち、幅・高さは 10〜10000、x+w と y+h は 10000 以下です。ID は英字で始まる英数字、_、- の組み合わせで重複させないでください。文字は 500 文字以内、装飾や数式は解釈しません。見える文字の大きさは任意の fontSize で画像と同じ座標の高さ（1〜2000、図形の高さ以下）として指定してください。画像全体を縮尺する場合は fontSize にも同じ倍率を掛けてください。不明なら省略し uncertain に記載してください。台形には trapDir（top・bottom・left・right）と inset（0〜0.45）、多角形には sides（3〜12 の整数）を追加してください。
各線は id, from, to, arrow, label を持ちます。端点は {"node":"図形ID","side":"left|right|top|bottom"} または {"x":数値,"y":数値} です。楕円上の位置が辺の中央でない場合は side の代わりに angle を度数（右0、下90、左180、上-90、範囲-180〜180）で指定できます。文字・台形・多角形への接続や同じ図形に戻る線は未対応です。arrow は none・end・both のいずれかです。直線は style を省略するか straight を指定します。曲線は style を curve とし、3次ベジェ曲線の control1 と control2 を画像と同じ座標系の {"x":数値,"y":数値} で両方指定してください。制御点が不明な曲線を推測して確定しないでください。
電気回路の場合は通常図の version 1 に混ぜず、次の version 2 だけを使います。components は {"id":"r1","type":"resistor|resistor_zigzag|opamp|optocoupler|voltage_triangle|battery|variable_resistor|switch|capacitor|inductor|diode|nmos|pmos|current_source|voltage_dc|voltage_ac|ground","x":中心座標,"y":中心座標,"rotation":0|90|180|270,"name":"部品名","value":"値"}、極性付きコンデンサだけ polarized:true を付けます。MOSFET は nmos（Nチャネル）・pmos（Pチャネル）の簡略記号に対応し、端子 ID は gate・drain・source です。回転0のとき gate は中心から左60、nmos は drain が右20・上60、source が右20・下60です。pmos は source が右20・上60、drain が右20・下60で、ゲートに白丸があります。端子名を非表示にする場合だけ pinLabels:false を付けます。4端子・デプレッション型・パワーMOSFETの内部ダイオードは未対応です。MOSFETの種類が不明なら推測せず uncertain に記載してください。junctions は {"id":"j1","x":数値,"y":数値}。wires は {"id":"w1","from":{"component":"r1","pin":"a"},"to":{"junction":"j1"},"points":[]} の形式です。抵抗（resistor は長方形、resistor_zigzag はギザギザ）・三角波源・2端子の可変抵抗・スイッチ・コンデンサ・コイル・交流電源・電流源の端子 ID は a と b。スイッチは2端子（単極単投）だけ対応し、閉じている場合は closed:true、開いている場合は closed:false を付けます。状態不明の場合は uncertain に記載してください。電流源の矢印は a から b への向きで、回転 90 なら下向き、270 なら上向きです。可変抵抗の斜め矢印は調整を表し第3の端子ではありません。3端子のポテンショメータは未対応です。直流電源は positive（長い線）と negative（短い線）、ダイオードは anode（三角形側）と cathode（線側）、接地は terminal です。ダイオードの向きが不明な場合は推測せず uncertain に記載してください。LED とツェナーダイオードは未対応です。直流か交流か不明な電源は推測せず uncertain に記載してください。旧形式 voltage は互換性のため読み取りますが、新しい図では使わないでください。配線端を接続しない場合は {"x":数値,"y":数値} で指定できます。異なる自由端は座標が同じでも自動接続されません。terminalEnds は省略すると自由端に白丸を自動表示します。必要な場合は auto・none・start・end・both のいずれかを指定できます。白丸は見た目だけを表し接続関係を変えません。電流・電圧を示す矢印は導線にせず、任意の annotations 配列に {"id":"a1","from":{"x":数値,"y":数値},"to":{"x":数値,"y":数値},"label":"I_ph"} として入れます。矢印は from から to を向き、記号と同様に編集できます。回路の name・value・注釈 label は、数式を $...$ で囲みます。例: $I_{ph}$、$R_{sh}$、$R_s$、$I_d$、$V_d$。日本語や通常の文章は $ の外に書いてください。JSON の文字列中では数式コマンドのバックスラッシュを二つ重ねてエスケープし、妥当な JSON にしてください。2端子部品は幅120×高さ80（回転後は80×120）、端子間は120で固定です。接地は80×80、MOSFETは120×120です。opamp は160×160で電源端子を省略した記号です。回転0の端子は inverting（中心から左80・上40）、noninverting（左80・下40）、output（右80・上下0）。optocoupler は200×160で、anode（左100・上40）、cathode（左100・下40）、collector（右100・上40）、emitter（右100・下40）の4端子です。pinNumbers に端子IDをキー、番号を文字列の値として指定できます。フォトカプラの既定番号は順に1・2・4・3、オペアンプは番号なしです。battery は複数の長短線の電池で端子は positive と negative、voltage_triangle は三角波源で端子は a と b です。固定サイズの記号と文字が小さくなり過ぎないよう、単純な回路は可能なら全体を幅 800〜1200・高さ 400〜800 程度にし、部品名や注釈が重ならないよう十分な余白を残してください。大きな回路は無理に詰めず、部品端子から出る配線をグリッドに合わせて配置してください。清書案の書き出しは幅が最大 480 pt（約 16.9 cm）になり、線や文字も同じ倍率で縮小されます。配線は水平・垂直だけで、曲がり角は points に {"x":数値,"y":数値} を列挙します。全座標は 80〜9920 の範囲とし、できるだけ 20 の倍数にしてください。20 の倍数でない座標は取り込み時にグリッドへ調整されます。記号の大きさは固定です。接続点のある分岐は必ず junction を作り、各配線の端をその ID に指定してください。交差だけでは接続しません。不確かな接続は配線にせず uncertain に記載してください。回路の例: {"version":2,"components":[{"id":"r1","type":"resistor","x":200,"y":200,"rotation":0,"name":"R1","value":"1k"},{"id":"c1","type":"capacitor","x":400,"y":200,"rotation":0,"name":"C1","value":"1uF"}],"junctions":[],"wires":[{"id":"w1","from":{"component":"r1","pin":"b"},"to":{"component":"c1","pin":"a"},"points":[]}],"uncertain":[]}\n画像から判断できない図形や接続、折れ線、論理ゲートなど未対応の要素は推測して確定せず、uncertain に日本語で列挙してください。不確かな接続は edges に追加しないでください。追加キーは禁止です。
形式例: {"version":1,"nodes":[{"id":"a","type":"rect","x":100,"y":100,"w":160,"h":80,"text":"開始","fontSize":24},{"id":"b","type":"ellipse","x":400,"y":100,"w":160,"h":80,"text":"終了"}],"edges":[{"id":"e1","from":{"node":"a","side":"right"},"to":{"node":"b","side":"left"},"style":"curve","control1":{"x":300,"y":40},"control2":{"x":350,"y":40},"arrow":"end","label":""}],"uncertain":[]}
nodes は 200 件以下、edges は 300 件以下、uncertain は 50 件以下、文字の合計は 20000 文字以下、JSON 全体は 256 KB 以下にしてください。`;
