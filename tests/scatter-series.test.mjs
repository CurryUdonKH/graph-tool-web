import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScatterSeries } from '../js/scatter/series.mjs';
import { linregress } from '../js/scatter/stats.js';
const source = (name,columns,rows) => ({name,table:{columns,rows,numeric:columns.map(()=>true)}});
const state = sel => ({sel,labels:{}});

test('従来の横軸・縦軸と凡例を保存した図は同じ値を描く',()=>{
  const src=[source('a.csv',['x','y'],[[1,3],[2,5],[3,7]])];
  const st=state({'a.csv':{x:'x',ys:['y']}});st.labels['a.csv\u0000y']='測定';
  const {series,warns}=computeScatterSeries(src,st);
  assert.equal(warns.length,0);assert.deepEqual(series[0].xs,[1,2,3]);assert.deepEqual(series[0].ys,[3,5,7]);
  assert.equal(series[0].label,'測定');assert.equal(linregress(series[0].xs,series[0].ys).slope,2);
});
test('同じ表の系列ごとに別の横軸を使い、回帰にも各横軸を使う',()=>{
  const src=[source('a.csv',['x1','y1','x2','y2'],[[1,2,10,30],[2,4,20,60],[3,6,30,90]])];
  const st=state({'a.csv':{x:'x1',ys:['y1','y2'],xByY:{y2:{source:'a.csv',column:'x2'}}}});
  const {series}=computeScatterSeries(src,st);
  assert.deepEqual(series.map(s=>s.xs),[[1,2,3],[10,20,30]]);
  assert.deepEqual(series.map(s=>linregress(s.xs,s.ys).slope),[2,3]);
});
test('別ファイルの横軸を選び、空欄で行の対応をずらさない',()=>{
  const src=[source('x.csv',['時間'],[[10],[null],[30],[40]]),source('y.csv',['電圧'],[[2],[4],[null],[8]])];
  const st=state({'x.csv':{x:'時間',ys:[]},'y.csv':{x:'電圧',ys:['電圧'],xByY:{電圧:{source:'x.csv',column:'時間'}}}});
  const {series}=computeScatterSeries(src,st);
  assert.equal(series.length,1);assert.equal(series[0].xFile,'x.csv');
  assert.deepEqual(series[0].xs,[10,40]);assert.deepEqual(series[0].ys,[2,8]);
  assert.deepEqual(computeScatterSeries(src,JSON.parse(JSON.stringify(st))).series,series);
});
test('別範囲の長さが異なる場合は先頭から対応し、余った行を知らせる',()=>{
  const src=[source('範囲A',['x'],[[1],[2],[3]]),source('範囲B',['y'],[[10],[20]])];
  const st=state({'範囲A':{x:'x',ys:[]},'範囲B':{x:'y',ys:['y'],xByY:{y:{source:'範囲A',column:'x'}}}});
  const {series,warns}=computeScatterSeries(src,st);
  assert.deepEqual(series[0].xs,[1,2]);assert.deepEqual(series[0].ys,[10,20]);
  assert.match(warns[0],/横軸が3行、縦軸が2行/);
});
test('参照先を外したときは別の横軸へ勝手に切り替えず設定を保持する',()=>{
  const src=[source('a.csv',['x','y'],[[1,3],[2,5],[3,7]])];
  const st=state({'a.csv':{x:'x',ys:['y'],xByY:{y:{source:'missing.csv',column:'time'}}}});
  let out=computeScatterSeries(src,st);
  assert.equal(out.series.length,0);assert.match(out.warns[0],/見つかりません/);
  assert.equal(st.sel['a.csv'].xByY.y.source,'missing.csv');
  src.push(source('missing.csv',['time'],[[10],[20],[30]]));
  out=computeScatterSeries(src,st);assert.deepEqual(out.series[0].xs,[10,20,30]);
});
test('共通の横軸へ戻すと独立設定を解除し、他系列の設定は保つ',()=>{
  const src=[source('a.csv',['x','y','z'],[[1,2,10],[2,4,20]])];
  const st=state({'a.csv':{x:'x',ys:['y'],xByY:{y:{source:'a.csv',column:'z'}}}});
  delete st.sel['a.csv'].xByY.y;
  assert.deepEqual(computeScatterSeries(src,st).series[0].xs,[1,2]);
});
test('constructorなどの列名を個別横軸の設定と取り違えない',()=>{
  const src=[source('a.csv',['x','constructor','__proto__'],[[1,2,3],[2,4,6]])];
  const st=state({'a.csv':{x:'x',ys:['constructor','__proto__']}});
  const out=computeScatterSeries(src,st);
  assert.equal(out.warns.length,0);assert.equal(out.series.length,2);
  assert.deepEqual(out.series[1].ys,[3,6]);
});


test('入力しても反映されなかった旧凡例を復元し、新しい編集は優先する',()=>{
  const src=[source('太陽電池.xlsx',['V','I','P'],[[1,2,3],[2,4,6]])];
  const st=state({'太陽電池.xlsx':{x:'V',ys:['I','P']}});
  st.labels['太陽電池.xlsx\ufffdI']='入力済みの電流';
  st.labels['太陽電池.xlsx\ufffdP']='古い電力名';
  st.labels['太陽電池.xlsx\u0000P']='現在の電力名';
  assert.deepEqual(computeScatterSeries(src,st).series.map(s=>s.label),['入力済みの電流','現在の電力名']);
  st.labels['太陽電池.xlsx\u0000I']='変更した電流';
  const restored=JSON.parse(JSON.stringify(st));
  assert.deepEqual(computeScatterSeries(src,restored).series.map(s=>s.label),['変更した電流','現在の電力名']);
});
