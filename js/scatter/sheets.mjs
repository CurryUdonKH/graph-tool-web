import { guessSkip, buildTable } from './data.js';

// 追加先は独立した表にし、元シートの範囲・修正済みの値・選択設定を保持する。
export function createSheetSource(file, sheet, rows, existingNames) {
  if (!file.excel || !file.sheets?.includes(sheet)) throw new Error('追加するシートを選んでください。');
  const workbookName = file.workbookName || file.name;
  const ext = workbookName.match(/\.(xlsx|xlsm|xls)$/i)?.[0] || '';
  const base = ext ? workbookName.slice(0,-ext.length) : workbookName;
  const stem = `${base} [${sheet}]`;
  const used = new Set(existingNames);
  let name = stem + ext, n = 2;
  while (used.has(name)) name = `${stem} (${n++})${ext}`;
  const source = {name,workbookName,excel:true,raw:file.raw,sheet,sheets:[...file.sheets],skip:guessSkip(rows),range:null,_rows:rows};
  source.table = buildTable(rows,source);
  return source;
}
