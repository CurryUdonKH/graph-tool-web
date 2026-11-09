import test from 'node:test';
import assert from 'node:assert/strict';
import { resizePoint, pointPrimitives } from '../js/diagram/coordinate-point.mjs';
const point = () => ({ id: 1, type: 'point', x: 197, y: 297, w: 6, h: 6, text: '$P_1$', fontSize: 18 });
test('直径変更で座標と真円を保ち、不正値は変更しない', () => {
  const p = point();
  for (const diameter of [1, 4, 7.5, 100]) {
    assert.equal(resizePoint(p, diameter), true);
    assert.equal(p.x + p.w / 2, 200); assert.equal(p.y + p.h / 2, 300);
    assert.equal(p.w, diameter); assert.equal(p.h, diameter);
  }
  const before = structuredClone(p);
  for (const bad of [0, -1, 101, NaN, Infinity]) assert.equal(resizePoint(p, bad), false);
  assert.deepEqual(p, before);
});
test('黒点の実寸に枠線を加えず、点名は点の外へ配置する', () => {
  for (const labelPosition of ['right', 'left', 'top', 'bottom', 'upperRight']) {
    const p = {...point(),labelPosition};
    const [dot,label] = pointPrimitives(p);
    assert.equal(dot.rx, 3); assert.equal(dot.ry, 3); assert.equal(dot.fill, '#000000');
    assert.equal(dot.stroke, 'none'); assert.equal(label.s, '$P_1$');
    assert.ok(Math.hypot(label.x-dot.cx,label.y-dot.cy)>dot.rx);
  }
});
test('点名なしでも黒点を描き、保存後も点名・位置・直径を保持する', () => {
  assert.equal(pointPrimitives({...point(),text:''}).length,1);
  const p=point(); resizePoint(p,12);
  assert.deepEqual(pointPrimitives(JSON.parse(JSON.stringify(p))),pointPrimitives(p));
});
