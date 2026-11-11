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

test('理論曲線の定義域の途切れを線で結ばない',()=>{
  const a=options();a.legend=false;a.series=[{xs:[1,2,3,4,5],ys:[1,2,NaN,4,5],line:'dashed',color:'#abcdef',marker:null,label:'理論'}];
  const paths=buildPlot(a).prims.filter(p=>p.k==='path'&&p.stroke==='#abcdef');
  assert.equal(paths.length,2);assert.ok(paths.every(p=>p.dash));
});

test('対数回帰は逆変換して描き、対数座標では直線になる',()=>{
  for(const logX of [false,true]) {
    const a=options();a.legend=false;a.axes={x:{range:logX?[1,100]:[0,2],log:logX},y:{range:[1,100],log:true}};
    a.fits=[{slope:1,intercept:0,x0:logX?1:0,x1:logX?100:2,color:'#abcdef',logX,logY:true}];
    const result=buildPlot(a),paths=result.prims.filter(p=>p.k==='path'&&p.stroke==='#abcdef');
    assert.ok(paths.length>0);
    for(const p of paths) for(const [,x,y] of p.cmds) {
      const t=(x-result.plot.x)/result.plot.w;
      assert.ok(Math.abs(y-(result.plot.y+result.plot.h*(1-t)))<1e-8);
    }
  }
});

test('回帰直線は計算した点の範囲から表示範囲の両端まで伸ばす',()=>{
  for(const log of [false,true]) {
    const a=options();a.legend=false;
    a.axes={x:{range:log?[1,1000]:[0,10],log},y:{range:log?[1,1000]:[0,10],log}};
    a.fits=[{slope:1,intercept:0,x0:log?10:4,x1:log?100:6,color:'#abcdef',logX:log,logY:log}];
    const result=buildPlot(a),paths=result.prims.filter(p=>p.k==='path'&&p.stroke==='#abcdef');
    assert.equal(paths.length,1);
    const first=paths[0].cmds[0],last=paths[0].cmds.at(-1),p=result.plot;
    assert.ok(Math.abs(first[1]-p.x)<1e-8);assert.ok(Math.abs(last[1]-(p.x+p.w))<1e-8);
    assert.ok(Math.abs(first[2]-(p.y+p.h))<1e-8);assert.ok(Math.abs(last[2]-p.y)<1e-8);
  }
});
test('縦軸の範囲を先に超える回帰直線は上端と下端で切る',()=>{
  const a=options();a.legend=false;a.fits=[{slope:2,intercept:-5,x0:4,x1:6,color:'#abcdef'}];
  const result=buildPlot(a),path=result.prims.find(p=>p.k==='path'&&p.stroke==='#abcdef'),p=result.plot;
  assert.ok(Math.abs(path.cmds[0][2]-(p.y+p.h))<1e-8);assert.ok(Math.abs(path.cmds.at(-1)[2]-p.y)<1e-8);
  assert.ok(path.cmds.every(([,x,y])=>x>=p.x-1e-8&&x<=p.x+p.w+1e-8&&y>=p.y-1e-8&&y<=p.y+p.h+1e-8));
});
