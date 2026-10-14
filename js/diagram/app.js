// 作図ページの上の帯:図の一覧・開く・名前・自動保存・一時保存と「戻す」・削除・書き出し・バックアップ
// 保存先はブラウザの中(IndexedDB)。サーバーには何も送らない。

import { initEditor, loadDoc, replaceDoc, getDoc, getPrims, flushChanges } from "./editor.js";
import * as store from "../store.js";
import { exportPNG, exportSVG, exportPDF } from "../export.js";
import { $, esc, pad, stamp, hms, mdhm, toast, setStatus, dialog, bindPop, bindMoreMenu } from "../ui.js";

const clone = o => JSON.parse(JSON.stringify(o));

// 今開いている図
// id: 保存先(まだ保存していない新しい図は null)、seen: 最後に読み書きしたときの更新時刻、
// sig: 最後に保存した内容(同じなら保存しない)、defaultName: 名前が空のときに使う名前
let cur = { id: null, seen: null, sig: null, defaultName: null };

// 保存は 1 つずつ順番に行う(同時に書くと、新しい内容を古い内容で上書きしてしまうことがあるため)
let chain = Promise.resolve();
function queue(fn) {
  const p = chain.then(fn);
  chain = p.catch(e => { console.error(e); setStatus(`⚠ 保存できませんでした(${e.message || e})`, true); });
  return p;
}

// ---------------------------------------------------------------- 一覧
async function refreshList() {
  const list = await store.listDiagrams();
  const sel = $("d_pick");
  sel.innerHTML = `<option value="__new__">＋ 新しい図</option>` +
    list.map(r => `<option value="${esc(r.id)}">${esc(r.name)}(${mdhm(new Date(r.updated))})</option>`).join("");
  sel.value = cur.id && list.some(r => r.id === cur.id) ? cur.id : "__new__";
  $("d_delete").disabled = !cur.id;
  const rec = cur.id ? list.find(r => r.id === cur.id) : null;
  const n = rec ? (rec.snapshots || []).length : 0;
  $("d_restore").textContent = `↩ 戻す(${n})`;
  $("d_restore").disabled = !n;
  return list;
}

function currentName() {
  return $("d_name").value.trim() || cur.defaultName || (cur.defaultName = `diagram-${stamp()}`);
}

// ---------------------------------------------------------------- 開く・新しく作る
async function openDiagram(id) {
  flushChanges();
  await chain;
  const rec = await store.getDiagram(id);
  if (!rec) { toast("その図が見つかりませんでした"); await refreshList(); return; }
  loadDoc(rec.doc);
  cur = { id: rec.id, seen: rec.updated, sig: JSON.stringify([rec.name, rec.doc]), defaultName: null };
  $("d_name").value = rec.name;
  setStatus(`${mdhm(new Date(rec.updated))} に保存した図`);
  await store.setSetting("lastDiagram", rec.id);
  await refreshList();
}

async function newDiagram() {
  flushChanges();
  await chain;
  loadDoc(null);
  cur = { id: null, seen: null, sig: null, defaultName: null };
  $("d_name").value = "";
  setStatus("");
  await store.setSetting("lastDiagram", null);
  await refreshList();
}

// ---------------------------------------------------------------- 自動保存
function save() { return queue(doSave); }
async function doSave() {
  const doc = getDoc();
  if (!cur.id && !doc.items.length) return;          // 何も描いていない新しい図は保存しない
  let name = currentName();
  if (JSON.stringify([name, doc]) === cur.sig) return;
  let rec = cur.id ? await store.getDiagram(cur.id) : null;
  if (rec && cur.seen && rec.updated !== cur.seen) {
    // 別の画面(タブ)で同じ図が変更されていた → 上書きせず、こちらの内容は別の図として残す
    name = `${name}-copy`;
    rec = null;
    toast("同じ図が別の画面で変更されていたため、こちらは名前に -copy をつけた別の図として保存しました");
  }
  const now = store.nowISO(), created = !rec;
  if (!rec) rec = { id: store.newId(), created: now, snapshots: [] };
  const renamed = rec.name !== name;
  Object.assign(rec, { name, updated: now, doc: clone(doc) });
  await store.putDiagram(rec);
  cur.id = rec.id; cur.seen = now; cur.sig = JSON.stringify([name, doc]);
  if (document.activeElement !== $("d_name") && $("d_name").value.trim() !== name) $("d_name").value = name;
  setStatus(`✅ 自動保存しました(${hms(new Date())})`);
  store.notify({ type: "saved", id: rec.id });
  if (created) await store.setSetting("lastDiagram", rec.id);
  if (created || renamed) await refreshList();
}

// ---------------------------------------------------------------- 一時保存と「戻す」
function takeSnapshot(note = "") {
  flushChanges();
  return queue(async () => {
    const doc = getDoc();
    if (!doc.items.length) { if (!note) toast("まだ何も描かれていません"); return false; }
    await doSave();
    const rec = await store.getDiagram(cur.id);
    rec.snapshots = [{ time: store.nowISO(), note, doc: clone(doc) }, ...(rec.snapshots || [])].slice(0, 30);  // 30 個まで
    rec.updated = cur.seen = store.nowISO();
    await store.putDiagram(rec);
    store.notify({ type: "saved", id: rec.id });
    await refreshList();
    if (!note) toast("📌 今の状態を一時保存しました");
    return true;
  });
}

async function fillRestore() {
  const rec = cur.id ? await store.getDiagram(cur.id) : null;
  const snaps = rec ? rec.snapshots || [] : [];
  const pop = $("p_restore");
  pop.innerHTML = `<div class="cap">一時保存した状態に戻します。戻す前の状態も自動で一時保存されるので、やり直せます。</div>` +
    snaps.map((sn, i) => `<button class="item" data-i="${i}">${mdhm(new Date(sn.time))}:${pad(new Date(sn.time).getSeconds())}` +
      (sn.note ? `(${esc(sn.note)})` : "") + ` <small>・ 図形 ${sn.doc.items.length} 個</small></button>`).join("");
  pop.querySelectorAll("[data-i]").forEach(b => b.onclick = async () => {
    pop.classList.remove("open");
    const sn = snaps[+b.dataset.i];
    await takeSnapshot("戻す前の状態");
    replaceDoc(sn.doc);
    flushChanges();
    toast(`↩ ${hms(new Date(sn.time))} の状態に戻しました`);
  });
}

// ---------------------------------------------------------------- 削除
async function deleteCurrent() {
  if (!cur.id) return;
  const name = $("d_name").value.trim() || currentName();
  const ok = await dialog("図を削除", `<p>「${esc(name)}」を削除します。一時保存したものも消えます。<b>元に戻せません。</b></p>`,
    [{ label: "やめる", value: false }, { label: "削除する", cls: "danger", value: true }]);
  if (!ok) return;
  flushChanges();
  await queue(async () => {
    await store.deleteDiagram(cur.id);
    store.notify({ type: "deleted", id: cur.id });
    cur = { id: null, seen: null, sig: null, defaultName: null };
  });
  loadDoc(null);
  $("d_name").value = "";
  setStatus("");
  await store.setSetting("lastDiagram", null);
  await refreshList();
  toast(`🗑 「${name}」を削除しました`);
}

// ---------------------------------------------------------------- 書き出し
async function doExport(fn) {
  flushChanges();
  const prims = getPrims();
  if (!prims.length) { toast("まだ何も描かれていません"); return; }
  const busy = setTimeout(() => $("busy").classList.add("show"), 250);   // 初回はフォントなどの読み込みで少し待つ
  try {
    await fn(prims, currentName());
  } catch (e) {
    console.error(e);
    dialog("書き出せませんでした", `<p>${esc(e.message || e)}</p>`);
  } finally {
    clearTimeout(busy); $("busy").classList.remove("show");
  }
}

// ---------------------------------------------------------------- はじめ
async function start() {
  initEditor({ onChange: () => save() });

  $("d_pick").onchange = e => e.target.value === "__new__" ? newDiagram() : openDiagram(e.target.value);
  let nameTimer = null;
  $("d_name").addEventListener("input", () => { clearTimeout(nameTimer); nameTimer = setTimeout(save, 500); });
  $("d_name").addEventListener("change", () => { clearTimeout(nameTimer); save(); });
  $("d_name").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) e.target.blur(); });
  $("d_snap").onclick = () => takeSnapshot();
  bindPop("d_restore", "p_restore", fillRestore);
  bindMoreMenu({ beforeBackup: async () => { flushChanges(); await chain; }, onImported: refreshList });
  $("d_delete").onclick = deleteCurrent;
  $("x_png").onclick = () => doExport(exportPNG);
  $("x_svg").onclick = () => doExport(exportSVG);
  $("x_pdf").onclick = () => doExport(exportPDF);

  // 画面を閉じる・隠すときは、待っている変更をすぐ保存する
  addEventListener("pagehide", flushChanges);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushChanges(); });
  // 別の画面(タブ)で保存・削除されたら、一覧を新しくする
  store.onNotify(() => refreshList());

  // 開いたときは、前回さわっていた図の続きから
  try {
    const list = await store.listDiagrams();
    const last = await store.getSetting("lastDiagram");
    const pick = list.find(r => r.id === last) || (last === null ? null : list[0]);
    if (pick) await openDiagram(pick.id); else await refreshList();
  } catch (e) {
    console.error(e);
    dialog("保存の機能が使えません", `<p>このブラウザでは図を保存できないようです(プライベートブラウズでは使えないことがあります)。描くことと書き出しはできます。</p><p><small>${esc(e.message || e)}</small></p>`);
  }
}
start();
