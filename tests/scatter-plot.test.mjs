import {test} from 'node:test';
import assert from 'node:assert/strict';

// 図形の配置を検証するため、文字幅だけを一定にする。
globalThis.window = {};
globalThis.document = {head:{appendChild() {}},createElement: () => ({getContext: () => ({measureText: s => ({width: s.length * 6})})})};
const {buildPlot} = await import('../js/scatter/plot.js');
const options = () => ({series: [{xs:[9.6,9.7],ys:[9.6,9.7],label:'系列A',color:'#123456',marker:'o'}],fits:[],legend:true,axes:{x:{range:[0,10]},y:{range:[0,10]}}});
const label = result => result.prims.find(p => p.k === 'text' && p.s === '系列A');

test('凡例は既定の右上に固定され、点の位置が変わっても移動しない', () => {
  const a = options(), first = label(buildPlot(a));
  a.series[0].xs = [0,1]; a.series[0].ys = [0,1];
  assert.deepEqual(label(buildPlot(a)), first);
  assert.deepEqual(label(buildPlot({...a,legendPosition:'top-right'})), first);
});
test('凡例の四隅指定を描画に反映し、自動指定も選べる', () => {
  const a = options(), tr = label(buildPlot(a));
  const tl = label(buildPlot({...a,legendPosition:'top-left'}));
  const br = label(buildPlot({...a,legendPosition:'bottom-right'}));
  const bl = label(buildPlot({...a,legendPosition:'bottom-left'}));
  assert.ok(tl.x < tr.x); assert.equal(tl.y,tr.y);
  assert.ok(br.y > tr.y); assert.equal(br.x,tr.x);
  assert.equal(bl.x,tl.x); assert.equal(bl.y,br.y);
  assert.notDeepEqual(label(buildPlot({...a,legendPosition:'auto'})),tr);
});
test('任意の縦横範囲をそのまま使い、範囲外の点を描かない', () => {
  const a = options(); a.legend = false;
  a.axes = {x:{range:[-2,4]},y:{range:[10,20]}};
  a.series[0].xs = [-3,-2,0,4,5]; a.series[0].ys = [15,10,25,20,15];
  const r = buildPlot(a), points = r.prims.filter(p => p.k === 'ellipse');
  assert.deepEqual(r.lim,{x:[-2,4],y:[10,20]}); assert.equal(points.length,2);
  assert.equal(points[0].cx,r.plot.x); assert.equal(points[1].cx,r.plot.x+r.plot.w);
});
