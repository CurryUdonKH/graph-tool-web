import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCellRange, selectHeader, containsCell } from '../js/scatter/range.mjs';
import { tableFromRange, buildTable, rangeLabel } from '../js/scatter/data.js';
const rows = [['時間', 'メモ', '電圧', '予備', '電流'], [1, 'a', 10, 99, 100], [2, 'b', 20, 98, 200], [3, 'c', 30, 97, 300], [4, 'd', 40, 96, 400]];

test('離れた列と行を選んでも同じ元行の値が組になる。元データを変更しない', () => {
  const original = structuredClone(rows);
  let range = selectHeader(null, 'cols', 0, rows);
  range = selectHeader(range, 'cols', 4, rows, { additive: true });
  range = selectHeader(range, 'cols', 2, rows, { additive: true });
  range = selectHeader(range, 'rows', 0, rows);
  range = selectHeader(range, 'rows', 4, rows, { additive: true });
  range = selectHeader(range, 'rows', 2, rows, { additive: true });
  assert.deepEqual(range.cols, [0, 2, 4]);
  assert.deepEqual(range.rows, [0, 2, 4]);
  const table = tableFromRange(rows, range);
  assert.deepEqual(table.columns, ['時間', '電圧', '電流']);
  assert.deepEqual(table.rows, [[2, 20, 200], [4, 40, 400]]);
  assert.deepEqual(table.numeric, [true, true, true]);
  assert.deepEqual(rows, original);
  assert.equal(containsCell(range, 2, 2), true);
  assert.equal(containsCell(range, 3, 2), false);
  assert.equal(containsCell(range, 2, 3), false);
  assert.deepEqual(buildTable(rows, JSON.parse(JSON.stringify({range}))), table);
  assert.match(rangeLabel(range), /列 A, C, E・行 1, 3, 5/);
});

test('追加選択の解除と最後の一つ、Shiftで連続選択への変更', () => {
  let range = selectHeader(null, 'cols', 0, rows);
  range = selectHeader(range, 'cols', 4, rows, { additive: true });
  range = selectHeader(range, 'cols', 0, rows, { additive: true });
  assert.deepEqual(range.cols, [4]);
  assert.deepEqual(selectHeader(range, 'cols', 4, rows, { additive: true }), range);
  assert.deepEqual(selectHeader(range, 'cols', 1, rows, { extend: true }).cols, [1, 2, 3, 4]);
});

test('行を先に選んでから列を絞れる。見出しなしは元の列記号を使う', () => {
  let range = selectHeader(null, 'rows', 2, rows);
  range = selectHeader(range, 'rows', 4, rows, { additive: true });
  range = selectHeader(range, 'cols', 0, rows);
  range = selectHeader(range, 'cols', 2, rows, { additive: true });
  const table = tableFromRange(rows, {...range, header: false});
  assert.deepEqual(table.columns, ['列A', '列C']);
  assert.deepEqual(table.rows, [[2,20], [4,40]]);
});

test('従来の四角い範囲と見出しのないセル、空のセルにも対応する', () => {
  assert.deepEqual(tableFromRange(rows, {r0:0,r1:2,c0:0,c1:2,header:true}).rows, [[1,'a',10],[2,'b',20]]);
  assert.deepEqual(tableFromRange([[null, '除外', null], [1, 9, null], [null, 8, 30]], {r0:0,r1:2,c0:0,c1:2,cols:[0,2],header:true}),
    {columns:['列A','列C'],rows:[[1,null],[null,30]],numeric:[true,true]});
});

test('セル範囲の直接入力、逆向き、絶対参照、範囲外の入力を検証する', () => {
  assert.deepEqual(parseCellRange('$E$5 : a1', rows), {r0:0,r1:4,c0:0,c1:4});
  assert.deepEqual(parseCellRange('C3', rows), {r0:2,r1:2,c0:2,c1:2});
  for (const bad of ['A0', 'A1:F5', 'A1:E6', 'A1,C3', '任意', 'A1:ZZZZZZZZZZZZZZ99999999999999999999']) assert.throws(() => parseCellRange(bad, rows));
  const long = Array.from({length:2100}, (_, i) => [i, i * 2]);
  assert.deepEqual(tableFromRange(long, {...parseCellRange('A2099:B2100',long),header:false}).rows, [[2098,4196],[2099,4198]]);
});

 test('追加選択をオンにしたまま列から行へ移っても最初の行から選べる', () => {
  let range = selectHeader(null, 'cols', 0, rows, {additive:true});
  range = selectHeader(range, 'cols', 2, rows, {additive:true});
  range = selectHeader(range, 'rows', 0, rows, {additive:true});
  range = selectHeader(range, 'rows', 2, rows, {additive:true});
  assert.deepEqual(range.cols, [0,2]);
  assert.deepEqual(range.rows, [0,2]);
  assert.deepEqual(tableFromRange(rows, range).rows, [[2,20]]);
});

import { selectArea, parseCellRanges, selectionTSV } from '../js/scatter/range.mjs';
test('離れたセル範囲は和集合として扱い、選んでいない交差セルを取り込まない', () => {
  const range = {...parseCellRanges('A2:A3, C4:C5', rows), header:false};
  assert.equal(containsCell(range, 1, 2), false);
  assert.equal(containsCell(range, 3, 0), false);
  assert.deepEqual(tableFromRange(rows, range).rows, [[1,null],[2,null],[null,30],[null,40]]);
  assert.equal(selectionTSV(rows, range), '1\t\n2\t\n\t30\n\t40');
  assert.deepEqual(tableFromRange(rows, JSON.parse(JSON.stringify(range))), tableFromRange(rows,range));
});
test('複数範囲の重なりを重複させず、通常選択は置換、同じ範囲の追加は解除する', () => {
  const a = {r0:0,r1:2,c0:0,c1:0}, b = {r0:0,r1:2,c0:2,c1:2};
  const both = selectArea(selectArea(null,a),b,true);
  assert.deepEqual(both.cols,[0,2]);
  assert.deepEqual(selectArea(both,b,true).cols,[0]);
  assert.deepEqual(selectArea(both,b).cols,[2]);
  const overlap = parseCellRanges('A1:C3, C1:E3, A1:C3',rows);
  assert.deepEqual(overlap.cols,[0,1,2,3,4]);
  assert.equal(tableFromRange(rows,overlap).rows.length,2);
  assert.equal(overlap.areas.length,2);
});
test('コピーでは空セルと改行やタブを含む文字を保ち、元の行順を変えない', () => {
  const input = [['a\tb','x"y'],['c\nd',null]];
  assert.equal(selectionTSV(input,parseCellRanges('B1:B2,A1:A2',input)), '"a\tb"\t"x""y"\n"c\nd"\t');
  assert.throws(() => parseCellRanges('A1,',input));
});
