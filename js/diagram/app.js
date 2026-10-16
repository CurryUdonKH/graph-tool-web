// 作図ページの上の帯:図の一覧・開く・名前・自動保存・一時保存と「戻す」・削除・書き出し・バックアップ
// 保存先はブラウザの中(IndexedDB)。サーバーには何も送らない。

import { initEditor, loadDoc, replaceDoc, getDoc, getPrims, flushChanges } from "./editor.js";
import * as store from "../store.js";
import { exportWithPreview } from "../exportdialog.js";
import { $, esc, pad, hms, hm, mdhm, nextName, toast, setStatus, dialog, bindPop, bindMoreMenu } from "../ui.js";

const clone = o => JSON.parse(JSON.stringify(o));

// 今開いている図
// id: 保存先(まだ保存していない新しい図は null)、seen: 最後に読み書きしたときの更新時刻、
// sig: 最後に保存した内容(同じなら保存しない)、defaultName: 名前が空のときに使う名前
let cur = { id: null, seen: null, sig: null, defaultName: null };

// 保存は 1 つずつ順番に行う(同時に書くと、新しい内容を古い内容で上書きしてしまうことがあるため)
let chain = Promise.resolve();
function queue(fn) {
  const p = chain.then(fn);
  chain = p.catch(e => { console.error(e); setStatus(`⚠ 保存できませんでした`, true, String(e.message || e)); });
  return p;
}

// ---------------------------------------------------------------- 一覧
async function refreshList() {
  const list = await store.listDiagrams();
  const sel = $("d_pick");
  sel.innerHTML = `<option value="__new__">＋ 新しい図</option>` +
    list.map(r => `<option value="${esc(r.id)}">${esc(r.name)}(${mdhm(new Date(r.updated))})</option>`).join("");
  sel.value = cur.id && list.some(r => r.id === cur.id) ? cur.id : "__new__";
  $("d_delete").disabled = $("f_dup").disabled = !cur.id;
  const rec = cur.id ? list.find(r => r.id === cur.id) : null;
  const n = rec ? (rec.snapshots || []).length : 0;
  $("d_restore").textContent = `↩ 戻す(${n})`;
  $("d_restore").disabled = !n;
  // 名前を決めていない新しい図には、fig1、fig2 … のうち空いている番号の名前をつける
  if (!cur.id && !cur.defaultName) cur.defaultName = nextName("fig", list.map(r => r.name));
  $("d_name").placeholder = cur.id ? "" : `${cur.defaultName}(図形を置くと自動で保存)`;
  return list;
}

function currentName() {
  return $("d_name").value.trim() || cur.defaultName || "fig1";
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
  setStatus(`✓ 保存済み`, false, `${mdhm(new Date(rec.updated))} に保存した図`);
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
  setStatus(`✓ 保存済み ${hm(new Date())}`, false, "自動で保存しました");
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

// ---------------------------------------------------------------- 複製・合成
// 今の図をまるごと「…-copy」という名前で保存して、そちらを開く
function duplicateCurrent() {
  flushChanges();
  return queue(async () => {
    await doSave();
    const src = cur.id ? await store.getDiagram(cur.id) : null;
    if (!src) { toast("まだ何も描かれていません"); return; }
    const used = (await store.listDiagrams()).map(r => r.name);
    let name = `${src.name}-copy`;
    if (used.includes(name)) name = nextName(`${src.name}-copy`, used);
    const now = store.nowISO();
    const rec = { ...clone(src), id: store.newId(), name, created: now, updated: now, snapshots: [] };
    await store.putDiagram(rec);
    store.notify({ type: "saved", id: rec.id });
    return rec;
  }).then(rec => {
    if (!rec) return;
    openDiagram(rec.id);
    toast(`📄 「${rec.name}」として複製しました。今はこちらを開いています`);
  });
}

// 図形と線の端・曲がり角が入る範囲 [x0, y0, x1, y1]。何もなければ null
function docBox(items) {
  const xs = [], ys = [];
  for (const it of items) {
    if (it.type === "edge") {
      for (const q of [it.from, it.to, ...(it.points || [])]) if (q.id == null && q.x != null) { xs.push(q.x); ys.push(q.y); }
    } else { xs.push(it.x, it.x + it.w); ys.push(it.y, it.y + it.h); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}

// 別の図の中身を、今の図の下(または右)にコピーして取り込む。取り込んだ元の図は変わらない
async function mergeDiagram(srcId, where) {
  const other = await store.getDiagram(srcId);
  const add = clone((other && other.doc.items) || []);
  if (!add.length) { toast("取り込む図に何も描かれていません"); return; }
  if (getDoc().items.length) await takeSnapshot("取り込む前の状態");   // 「戻す」で取り込む前に戻れるように
  const doc = clone(getDoc()), g = doc.grid || 20;
  // 置く場所:今の図の下(または右)に 2 マスあけて。グリッドに合わせる
  const box = docBox(doc.items), obox = docBox(add);
  let dx = 0, dy = 0;
  if (box) {
    if (where === "right") { dx = box[2] + 2 * g - obox[0]; dy = box[1] - obox[1]; }
    else { dx = box[0] - obox[0]; dy = box[3] + 2 * g - obox[1]; }
    dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g;
  }
  // 番号(id)をつけ直す(今の図の図形と重ならないように)
  const base = Math.max(doc.nextId || 1, ...doc.items.map(it => it.id + 1));
  const ids = new Map(add.map((it, k) => [it.id, base + k]));
  for (const it of add) {
    it.id = ids.get(it.id);
    if (it.type === "edge") {
      for (const k of ["from", "to"]) {
        const end = it[k];
        if (end.id != null) end.id = ids.get(end.id) ?? end.id;
        else { end.x += dx; end.y += dy; }
      }
      for (const q of it.points || []) { q.x += dx; q.y += dy; }
    } else { it.x += dx; it.y += dy; }
  }
  doc.items.push(...add);
  doc.nextId = base + add.length;
  const nb = docBox(doc.items);   // はみ出すときは画面を広げる
  doc.W = Math.max(doc.W || 1600, nb[2] + 4 * g);
  doc.H = Math.max(doc.H || 1000, nb[3] + 4 * g);
  replaceDoc(doc);
  flushChanges();
  toast(`🧩 「${other.name}」を${where === "right" ? "右" : "下"}に取り込みました(元の図はそのまま)`);
}

async function openMerge() {
  const list = (await store.listDiagrams()).filter(r => r.id !== cur.id);
  if (!list.length) { dialog("別の図を取り込む", "<p>取り込める図がまだありません。先に別の図を作ってください。</p>"); return; }
  const go = await dialog("別の図を取り込む(合成)", `<p>選んだ図の中身をコピーして、この図に足します。<b>元の図は変わりません。</b>取り込む前の状態は「戻す」に残ります。</p>
    <label class="fld2"><span>取り込む図</span><select id="mg_src" style="width:100%">${list.map(r => `<option value="${esc(r.id)}">${esc(r.name)}(${mdhm(new Date(r.updated))})</option>`).join("")}</select></label>
    <div class="row"><span style="color:var(--muted);font-size:12px">置く場所</span>
      <label class="ck"><input type="radio" name="mg_where" value="below" checked>今の図の下</label>
      <label class="ck"><input type="radio" name="mg_where" value="right">今の図の右</label></div>`,
    [{ label: "やめる", value: false }, { label: "🧩 取り込む", cls: "primary", value: true }]);
  if (!go) return;
  mergeDiagram($("mg_src").value, document.querySelector("[name=mg_where]:checked").value);
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
async function doExport(fmt) {
  flushChanges();
  const prims = getPrims();
  if (!prims.length) { toast("まだ何も描かれていません"); return; }
  const busy = setTimeout(() => $("busy").classList.add("show"), 250);   // 初回はフォントなどの読み込みで少し待つ
  try {
    await exportWithPreview(fmt, prims, currentName(), null, "描いた範囲だけを書き出します(グリッド・下絵・選択の印は入りません)。",
      () => { clearTimeout(busy); $("busy").classList.remove("show"); });
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
  $("f_new").onclick = () => newDiagram();
  $("f_dup").onclick = () => duplicateCurrent();
  $("f_merge").onclick = () => openMerge();
  bindMoreMenu({ beforeBackup: async () => { flushChanges(); await chain; }, onImported: refreshList });
  $("d_delete").onclick = deleteCurrent;
  $("x_png").onclick = () => doExport("png");
  $("x_svg").onclick = () => doExport("svg");
  $("x_pdf").onclick = () => doExport("pdf");

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
