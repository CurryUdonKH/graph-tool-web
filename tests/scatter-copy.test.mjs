import {test} from 'node:test';
import assert from 'node:assert/strict';
import {duplicateGraphRecord} from '../js/scatter/copy.mjs';

test('Excel・範囲・系列・軸・凡例を保ち、コピーの編集を元へ反映しない', () => {
  const original = {id:'original',name:'実験',created:'old',updated:'old',files:[{name:'測定.xlsx',sheet:'シートB',sheets:['シートA','シートB'],raw:new Uint8Array([1,2,3]).buffer,range:{cols:[0,2],rows:[1,3]},table:{columns:['x','y'],rows:[[1,2]]}}],state:{sel:{'測定.xlsx':{x:'x',ys:['y'],xByY:{y:{source:'測定.xlsx',column:'x'}}}},axes:{x:{auto:false,min:-1,max:5}},labels:{'測定.xlsx\0y':'測定B'},legendPosition:'bottom-left',fit:false}};
  const copy = duplicateGraphRecord(original,{id:'copy',now:'new',names:['実験']});
  assert.equal(copy.name,'実験-copy');assert.equal(copy.id,'copy');assert.equal(copy.created,'new');assert.equal(copy.updated,'new');
  assert.deepEqual(copy.files,original.files);assert.deepEqual(copy.state,original.state);
  copy.files[0].table.rows[0][1]=99;copy.files[0].range.rows.push(4);new Uint8Array(copy.files[0].raw)[0]=9;
  copy.state.sel['測定.xlsx'].ys.push('z');copy.state.axes.x.min=-10;copy.state.labels['測定.xlsx\0y']='変更';
  assert.equal(original.files[0].table.rows[0][1],2);assert.deepEqual(original.files[0].range.rows,[1,3]);assert.equal(new Uint8Array(original.files[0].raw)[0],1);
  assert.deepEqual(original.state.sel['測定.xlsx'].ys,['y']);assert.equal(original.state.axes.x.min,-1);assert.equal(original.state.labels['測定.xlsx\0y'],'測定B');
});
test('同じ名前のコピーを上書きせず、空いている連番を選ぶ', () => {
  const rec=duplicateGraphRecord({id:'a',name:'測定',state:{},files:[]},{id:'b',now:'today',names:['測定','測定-copy','測定-copy2','測定-copy4']});
  assert.equal(rec.name,'測定-copy3');
});
