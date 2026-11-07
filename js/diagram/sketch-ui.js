import { parseSketch, SKETCH_PROMPT, SKETCH_MAX_BYTES } from "./sketch-import.mjs";
import { tidySketch } from "./sketch-tidy.mjs";
import { gridSketch } from "./sketch-grid.mjs";
import { compactCircuitDoc } from "./circuit-compact.mjs";
import { previewDocPrims } from "./editor.js";
import { primsBounds, primsMarkup } from "../prims.js";
import { ready } from "../text.js";

const $ = id => document.getElementById(id);

// 読み取りと見本は現在の図に触れず、確定時だけ呼び出し元が新規保存する。
export function bindSketchImport(onImport) {
  const dlg = $("sketch_dialog"), input = $("sketch_input"), file = $("sketch_file");
  const preview = $("sketch_preview"), result = $("sketch_result"), confirm = $("sketch_confirm");
  const warningBox = $("sketch_warnings"), warningList = $("sketch_warning_list"), ack = $("sketch_ack"), error = $("sketch_error");
  let parsed = null, tidy = null, revision = 0, busy = false, pendingReads = 0;
  const mode = () => document.querySelector('input[name="sketch_mode"]:checked').value;
  $("sketch_prompt").value = SKETCH_PROMPT;
  function invalidate() {
    revision++; parsed = null; tidy = null; $("sketch_changes").textContent = ""; result.hidden = true; warningBox.hidden = true; ack.checked = false;
    confirm.disabled = true; confirm.hidden = true; error.hidden = true; error.textContent = ""; preview.replaceChildren();
  }
  function showError(message) { error.textContent = message; error.hidden = false; confirm.disabled = true; }
  function drawMode() {
    const clean = mode() === "tidy";
    $("sketch_tidy_options").hidden = !clean || !!parsed.rawDoc.circuitSketch;
    if (clean && parsed.rawDoc.circuitSketch) { tidy = compactCircuitDoc(parsed.rawDoc); }
    else if (clean) {
      const proposal = tidySketch(parsed.rawDoc, { align: $("tidy_align").checked, nested: $("tidy_nested").checked, symmetric: $("tidy_symmetric").checked });
      tidy = { ...proposal, doc: gridSketch(proposal.doc, proposal.constraints) };
    }
    const doc = clean ? tidy.doc : parsed.doc;
    const prims = previewDocPrims(doc), bounds = primsBounds(prims);
    if (!bounds) throw new Error("見本を表示できません。図形や線を確認してください。");
    const margin = 20, width = Math.max(1, bounds.w + 2 * margin), height = Math.max(1, bounds.h + 2 * margin);
    preview.setAttribute("viewBox", `${bounds.x - margin} ${bounds.y - margin} ${width} ${height}`);
    preview.innerHTML = primsMarkup(prims);
    $("sketch_changes").textContent = clean ? tidy.changes.join(" ") : "原画に近い配置をグリッドに合わせて表示しています。";
  }
  document.querySelectorAll('input[name="sketch_mode"]').forEach(radio => radio.addEventListener("change", () => {
    if (!parsed || busy) return;
    try { drawMode(); error.hidden = true; confirm.disabled = parsed.warnings.length > 0 && !ack.checked; } catch (e) { confirm.disabled = true; showError(e.message || "見本を表示できません。"); }
  }));
  for (const id of ["tidy_align", "tidy_nested", "tidy_symmetric"]) $(id).addEventListener("change", () => {
    if (!parsed || busy || mode() !== "tidy") return;
    try { drawMode(); error.hidden = true; confirm.disabled = parsed.warnings.length > 0 && !ack.checked; } catch (e) { confirm.disabled = true; showError(e.message || "見本を表示できません。"); }
  });
  const openSketch = () => { invalidate(); input.value = ""; file.value = ""; $("sketch_copy_status").textContent = ""; dlg.querySelector(".sketch-instructions").open = false; dlg.showModal(); };
  $("f_sketch").onclick = openSketch;
  $("b_sketch").onclick = openSketch;
  $("sketch_cancel").onclick = () => { if (!busy) dlg.close(); };
  dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
  dlg.addEventListener("close", invalidate);
  $("sketch_copy").onclick = async () => {
    try { await navigator.clipboard.writeText(SKETCH_PROMPT); $("sketch_copy_status").textContent = "コピーしました"; }
    catch { $("sketch_copy_status").textContent = "コピーできません。「詳しく見る」から手動でコピーしてください。"; }
  };
  $("sketch_file_button").onclick = () => file.click();
  input.addEventListener("input", invalidate);
  file.addEventListener("change", async () => {
    invalidate(); input.value = "";
    const selected = file.files[0], at = revision; file.value = "";
    if (!selected) return;
    if (selected.size > SKETCH_MAX_BYTES) { showError("ファイルは 256 KB 以下にしてください。"); return; }
    pendingReads++; $("sketch_preview_button").disabled = true;
    try { const contents = await selected.text(); if (at === revision) input.value = contents; }
    catch { if (at === revision) showError("ファイルを読み込めませんでした。"); }
    finally { pendingReads--; $("sketch_preview_button").disabled = pendingReads > 0; }
  });
  $("sketch_preview_button").onclick = async () => {
    if (pendingReads || busy) return;
    invalidate(); const at = revision;
    try {
      const candidate = parseSketch(input.value);
      await ready(candidate.doc.items.flatMap(it => [it.text || it.label || "", it.name || "", it.value || ""]));
      if (at !== revision || !dlg.open) return;
      candidate.rawDoc = candidate.doc;
      candidate.doc = candidate.rawDoc.circuitSketch ? candidate.rawDoc : gridSketch(candidate.rawDoc);
      parsed = candidate;
      document.querySelector('input[name="sketch_mode"][value="original"]').checked = true;
      drawMode();
      warningList.replaceChildren();
      for (const message of candidate.warnings) { const li = document.createElement("li"); li.textContent = message; warningList.appendChild(li); }
      warningBox.hidden = candidate.warnings.length === 0;
      result.hidden = false; confirm.hidden = false; confirm.disabled = candidate.warnings.length > 0;
      result.scrollIntoView({ block: "start", behavior: "instant" });
    } catch (e) { if (at === revision) showError(e.message || "内容を確認できませんでした。"); }
  };
  ack.onchange = () => { confirm.disabled = !parsed || !error.hidden || (parsed.warnings.length > 0 && !ack.checked); };
  confirm.onclick = async () => {
    if (!parsed || busy || !error.hidden || (parsed.warnings.length && !ack.checked)) return;
    busy = true; confirm.disabled = true; $("sketch_cancel").disabled = true;
    try {
      const doc = mode() === "tidy" ? tidy.doc : parsed.doc;
      const output = mode() === "tidy" && doc.circuitSketch ? { ...doc, circuitSketchClean: true } : doc;
      await onImport(output, { original: parsed.doc, input: input.value }); dlg.close();
    }
    catch (e) { showError(`新しい図を作成できませんでした: ${e.message || "保存に失敗しました"}`); }
    finally { busy = false; $("sketch_cancel").disabled = false; if (parsed) confirm.disabled = !error.hidden || (parsed.warnings.length > 0 && !ack.checked); }
  };
}
