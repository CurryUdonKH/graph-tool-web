import test from 'node:test';
import assert from 'node:assert/strict';
import {worldPoint,zoomView,panView,fitView} from '../js/diagram/viewport.mjs';
test('負の座標と従来の右下の外へ移動しても図の座標を変更しない',()=>{
  const v={x:0,y:0};
  assert.deepEqual(panView(v,2,-4000,-2000),{x:-2000,y:-1000});
  assert.deepEqual(panView(v,.5,100000,200000),{x:200000,y:400000});
  assert.deepEqual(v,{x:0,y:0});
  assert.deepEqual(worldPoint({x:-2000,y:-1000},2,100,200),{x:-1950,y:-900});
});
test('負の座標でもズームの中心にある点は画面上で動かない',()=>{
  const view={x:-5000,y:32000},anchor={x:456,y:200};
  for(const zoom of [.01,.1,1,4]) {
    const next=zoomView(view,.5,zoom,anchor);
    assert.deepEqual(worldPoint(next,zoom,anchor.x,anchor.y),worldPoint(view,.5,anchor.x,anchor.y));
  }
});
test('離れた図も全体表示に収まり、対象の中心が表示の中心に一致する',()=>{
  for(const b of [{x:-20000,y:-10000,w:50000,h:30000},{x:-500,y:400,w:160,h:80}]) {
    const {view,zoom}=fitView(b,900,500,1);
    assert.ok(b.w*zoom<=900+1e-8 && b.h*zoom<=500+1e-8);
    assert.deepEqual(worldPoint(view,zoom,450,250),{x:b.x+b.w/2,y:b.y+b.h/2});
  }
});
