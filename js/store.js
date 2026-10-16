// ブラウザの中(IndexedDB)に保存する。サーバーには何も送らない。
// 別の端末・別のブラウザとは共有されないので、バックアップの書き出し・読み込みを用意する。
//
// 図(diagrams)の 1 件: { id, name, created, updated, doc, snapshots: [{ time, note, doc }] }
// 散布図(graphs)の 1 件: { id, name, created, updated, files: [{ name, excel, raw: ArrayBuffer, sheet, skip, table }], state }
// reports は、やめたレポート用の図の置き場所(使っていない。一度作った版で用意したので、版の番号を保つために残す)

const DB_NAME = "graph-tool-web";
const DB_VERSION = 3;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("diagrams")) db.createObjectStore("diagrams", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("graphs")) db.createObjectStore("graphs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
    };
    req.onsuccess = () => {
      // 新しい版のページが別のタブで開かれたら、こちらは閉じて道をゆずる(次に使うときに開き直す)
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  // 容量が足りなくなっても勝手に消されないように頼んでおく(だめでも動く)
  try { navigator.storage?.persist?.(); } catch (e) {}
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存できませんでした"));
  });
}

export const nowISO = () => new Date().toISOString();

export const listDiagrams = async () =>
  ((await run("diagrams", "readonly", s => s.getAll())) || []).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
export const getDiagram = id => run("diagrams", "readonly", s => s.get(id));
export const putDiagram = rec => run("diagrams", "readwrite", s => s.put(rec));
export const deleteDiagram = id => run("diagrams", "readwrite", s => s.delete(id));
export const listGraphs = async () =>
  ((await run("graphs", "readonly", s => s.getAll())) || []).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
export const getGraph = id => run("graphs", "readonly", s => s.get(id));
export const putGraph = rec => run("graphs", "readwrite", s => s.put(rec));
export const deleteGraph = id => run("graphs", "readwrite", s => s.delete(id));
export const getSetting = key => run("settings", "readonly", s => s.get(key));
export const setSetting = (key, value) => run("settings", "readwrite", s => s.put(value, key));

export function newId() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- バックアップ
// 読み込んだファイルの中身(ArrayBuffer)は JSON に入らないので、文字(base64)にする
function toB64(buf) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

export async function exportBackup() {
  const diagrams = await run("diagrams", "readonly", s => s.getAll());
  const pack = g => ({ ...g, files: g.files.map(f => ({ ...f, raw: f.raw ? toB64(f.raw) : null })) });
  const graphs = (await run("graphs", "readonly", s => s.getAll())).map(pack);
  return { app: "graph-tool-web", version: 3, exported: nowISO(), diagrams, graphs };
}

// 読み込んだバックアップを足す。同じ id で、こちらの方が新しいものは上書きしない
export async function importBackup(data) {
  if (!data || data.app !== "graph-tool-web" || !Array.isArray(data.diagrams)) throw new Error("このツールのバックアップファイルではないようです");
  let added = 0, skipped = 0;
  const merge = async (list, get, put, ok, fix = r => r) => {
    for (const rec of list || []) {
      if (!rec || !rec.id || !ok(rec)) { skipped++; continue; }
      const cur = await get(rec.id);
      if (cur && (cur.updated || "") >= (rec.updated || "")) { skipped++; continue; }
      await put(fix(rec)); added++;
    }
  };
  await merge(data.diagrams, getDiagram, putDiagram, r => r.doc);
  const unpack = r => ({ ...r, files: r.files.map(f => ({ ...f, raw: f.raw ? fromB64(f.raw) : null })) });
  await merge(data.graphs, getGraph, putGraph, r => Array.isArray(r.files), unpack);
  return { added, skipped };
}

// ---------------------------------------------------------------- 他のタブへのお知らせ
// 同じブラウザで 2 つの画面を開いているとき、一覧を新しくするために使う
const channel = "BroadcastChannel" in window ? new BroadcastChannel("graph-tool-web") : null;
export const notify = msg => channel && channel.postMessage(msg);
export const onNotify = fn => channel && channel.addEventListener("message", e => fn(e.data));
