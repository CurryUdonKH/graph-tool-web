import { parseSketch, SKETCH_PROMPT, SKETCH_MAX_BYTES } from "./sketch-import.mjs";
import { previewDocPrims } from "./editor.js";
import { primsBounds, primsMarkup } from "../prims.js";
import { ready } from "../text.js";

const $ = id => document.getElementById(id);

// 読み取りと見本は現在の図に触れず、確定時だけ呼び出し元が新規保存する。
export function bindSketchImport(onImport) {
  const dlg = $("sketch_dialog"), input = $("sketch_input"), file = $("sketch_file");
  const preview = $("sketch_preview"), result = $("sketch_result"), confirm = $("sketch_confirm");
  const warningBox = $("sketch_warnings"), warningList = $("sketch_warning_list"), ack = $("sketch_ack"), error = $("sketch_error");
  let parsed = null, revision = 0, busy = false;
  $("sketch_prompt").value = SKETCH_PROMPT;
  function invalidate() {
    revision++; parsed = null; result.hidden = true; warningBox.hidden = true; ack.checked = false;
    confirm.disabled = true; error.hidden = true; error.textContent = ""; preview.replaceChildren();
  }
  function showError(message) { error.textContent = message; error.hidden = false; }
  $("f_sketch").onclick = () => { invalidate(); input.value = ""; file.value = ""; $("sketch_copy_status").textContent = ""; dlg.showModal(); };
  $("sketch_cancel").onclick = () => { if (!busy) dlg.close(); };
  dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
  dlg.addEventListener("close", invalidate);
  $("sketch_copy").onclick = async () => {
    try { await navigator.clipboard.writeText(SKETCH_PROMPT); $("sketch_copy_status").textContent = "コピーしました"; }
    catch { $("sketch_copy_status").textContent = "コピーできません。下の変換指示を開いて手動でコピーしてください。"; }
  };
  $("sketch_file_button").onclick = () => file.click();
  input.addEventListener("input", invalidate);
  file.addEventListener("change", async () => {
    invalidate(); input.value = "";
    const selected = file.files[0], at = revision; file.value = "";
    if (!selected) return;
    if (selected.size > SKETCH_MAX_BYTES) { showError("ファイルは 256 KB 以下にしてください。"); return; }
    try { const contents = await selected.text(); if (at === revision) input.value = contents; }
    catch { if (at === revision) showError("ファイルを読み込めませんでした。"); }
  });
  $("sketch_preview_button").onclick = async () => {
    invalidate(); const at = revision;
    try {
      const candidate = parseSketch(input.value);
      await ready(candidate.doc.items.map(it => it.text || it.label || ""));
      if (at !== revision || !dlg.open) return;
      const prims = previewDocPrims(candidate.doc), bounds = primsBounds(prims);
      if (!bounds) throw new Error("見本を表示できません。図形や線を確認してください。");
      const margin = 20, width = Math.max(1, bounds.w + 2 * margin), height = Math.max(1, bounds.h + 2 * margin);
      preview.setAttribute("viewBox", `${bounds.x - margin} ${bounds.y - margin} ${width} ${height}`);
      // primsMarkup は文字をエスケープし、図形・数値は検証済みの値だけから作られる。
      preview.innerHTML = primsMarkup(prims);
      warningList.replaceChildren();
      for (const message of candidate.warnings) { const li = document.createElement("li"); li.textContent = message; warningList.appendChild(li); }
      warningBox.hidden = candidate.warnings.length === 0;
      parsed = candidate; result.hidden = false; confirm.disabled = candidate.warnings.length > 0;
      result.scrollIntoView({ block: "start", behavior: "instant" });
    } catch (e) { if (at === revision) showError(e.message || "内容を確認できませんでした。"); }
  };
  ack.onchange = () => { confirm.disabled = !parsed || (parsed.warnings.length > 0 && !ack.checked); };
  confirm.onclick = async () => {
    if (!parsed || busy || (parsed.warnings.length && !ack.checked)) return;
    busy = true; confirm.disabled = true; $("sketch_cancel").disabled = true;
    try { await onImport(parsed.doc); dlg.close(); }
    catch (e) { showError(`新しい図を作成できませんでした: ${e.message || "保存に失敗しました"}`); }
    finally { busy = false; $("sketch_cancel").disabled = false; if (parsed) confirm.disabled = parsed.warnings.length > 0 && !ack.checked; }
  };
}
