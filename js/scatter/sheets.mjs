import { guessSkip, buildTable, rangeLabel } from './data.js';

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

// 同じシートの別の表を、範囲・列選択・編集値が独立したデータとして追加する。
export function createRangeSource(file, rows, range, existingNames) {
  const workbookName = file.workbookName || file.name;
  const base = workbookName.replace(/\.(xlsx|xlsm|xls|csv|txt|tsv)$/i, '');
  const stem = `${base}${file.sheet ? ` [${file.sheet}]` : ''} (${rangeLabel(range)})`;
  const used = new Set(existingNames);
  let name = stem, n = 2;
  while (used.has(name)) name = `${stem} (${n++})`;
  const source = {name, workbookName, excel:file.excel, raw:file.raw, sheet:file.sheet,
    sheets:[...(file.sheets || [])], skip:0, _rows:rows, range:structuredClone(range)};
  source.table = buildTable(rows, source);
  return source;
}
