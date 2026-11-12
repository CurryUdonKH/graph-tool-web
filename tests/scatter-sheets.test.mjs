import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetSource } from '../js/scatter/sheets.mjs';
import { computeScatterSeries } from '../js/scatter/series.mjs';
import { linregress } from '../js/scatter/stats.js';
const rowsA=[['時間','電圧'],[1,2],[2,4],[3,6],[4,8]];
const rowsB=[['時間','電圧'],[10,30],[20,60],[30,90],[40,120]];
const workbook=()=>({name:'実験.xlsx',excel:true,raw:new ArrayBuffer(4),sheets:['シートA','シートB'],sheet:'シートA'});
test('別シートを追加しても元シートの修正値・範囲・設定は変更しない',()=>{
  const original=createSheetSource(workbook(),'シートA',rowsA,[]);
  original.range={r0:0,c0:0,r1:3,c1:1,header:true};original.table.rows[0][1]=99;
  const before=structuredClone(original);
  const added=createSheetSource(original,'シートB',rowsB,[original.name]);
  assert.deepEqual(original,before);assert.equal(added.range,null);assert.deepEqual(added.table.rows[0],[10,30]);
  added.table.rows[0][1]=50;assert.equal(original.table.rows[0][1],99);assert.equal(rowsB[1][1],30);
});
test('同じ列名でも2シートの横軸を個別に使って重ね、凡例も区別する',()=>{
  const a=createSheetSource(workbook(),'シートA',rowsA,[]);
  const b=createSheetSource(a,'シートB',rowsB,[a.name]);
  const state={sel:{},labels:{}};
  const {series,warns}=computeScatterSeries([a,b],state);
  assert.equal(warns.length,0);assert.equal(series.length,2);
  assert.deepEqual(series.map(s=>s.xs),[[1,2,3,4],[10,20,30,40]]);
  assert.deepEqual(series.map(s=>linregress(s.xs,s.ys).slope),[2,3]);
  assert.notEqual(series[0].label,series[1].label);
  const restored=structuredClone({files:[a,b],state});
  assert.deepEqual(computeScatterSeries(restored.files,restored.state).series,series);
});
test('同じシートを再追加しても名前が重ならず、ブック名にシート名を重ねない',()=>{
  const a=createSheetSource(workbook(),'シートA',rowsA,[]);
  const b=createSheetSource(a,'シートB',rowsB,[a.name]);
  const again=createSheetSource(b,'シートA',rowsA,[a.name,b.name]);
  assert.equal(b.name,'実験 [シートB].xlsx');
  assert.equal(again.name,'実験 [シートA] (2).xlsx');
  assert.equal(again.workbookName,'実験.xlsx');
  assert.throws(()=>createSheetSource(a,'不存在',[],[]));
});
test('追加シートを他シートの横軸として指定しても正しく対応する',()=>{
  const a=createSheetSource(workbook(),'シートA',rowsA,[]),b=createSheetSource(a,'シートB',rowsB,[a.name]);
  const st={sel:{[a.name]:{x:'時間',ys:['電圧'],xByY:{電圧:{source:b.name,column:'時間'}}},[b.name]:{x:'時間',ys:[]}},labels:{}};
  assert.deepEqual(computeScatterSeries([a,b],st).series[0].xs,[10,20,30,40]);
});

test('同一シートの横並び・縦並びの範囲を独立した横軸で重ね、保存後も保持する',async()=>{
  const {createRangeSource}=await import('../js/scatter/sheets.mjs');
  const rows=[['時間','電圧',null,'時間','電圧'],[1,2,null,10,30],[2,4,null,20,60],[3,6,null,30,90],[],['時間','電圧'],[4,16],[5,20],[6,24]];
  const file=workbook();
  const ranges=[{r0:0,r1:3,c0:0,c1:1,header:true},{r0:0,r1:3,c0:3,c1:4,header:true},{r0:5,r1:8,c0:0,c1:1,header:true}];
  const a=createRangeSource(file,rows,ranges[0],[]);
  const before=structuredClone(a);
  const b=createRangeSource(a,rows,ranges[1],[a.name]);
  const c=createRangeSource(b,rows,ranges[2],[a.name,b.name]);
  assert.deepEqual(a,before);
  assert.equal(c.name,'実験 [シートA] (A6:B9)');
  const state={sel:{},labels:{}};
  const {series,warns}=computeScatterSeries([a,b,c],state);
  assert.equal(warns.length,0);assert.equal(series.length,3);
  assert.deepEqual(series.map(s=>s.xs),[[1,2,3],[10,20,30],[4,5,6]]);
  assert.deepEqual(series.map(s=>linregress(s.xs,s.ys).slope),[2,3,4]);
  assert.equal(new Set(series.map(s=>s.label)).size,3);
  const restored=structuredClone({files:[a,b,c],state});
  assert.deepEqual(computeScatterSeries(restored.files,restored.state).series,series);
  const repeated=createRangeSource(c,rows,ranges[0],[a.name,b.name,c.name]);
  assert.notEqual(repeated.name,a.name);
  repeated.table.rows[0][1]=99;repeated.range.r0=2;
  assert.equal(a.table.rows[0][1],2);assert.equal(rows[1][1],2);assert.equal(a.range.r0,0);
});
