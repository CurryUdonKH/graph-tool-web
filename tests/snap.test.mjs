import test from 'node:test';
import assert from 'node:assert/strict';
import { snapToGuides } from '../js/diagram/snap.mjs';
const target = [{ x: 100, y: 180, w: 80, h: 40 }], size = { w: 40, h: 40 };
test('辺の近くではグリッド位置より図形の辺を優先', () => {
  const r = snapToGuides({ x: 61, y: 50 }, { x: 60, y: 40 }, size, target, 7);
  assert.equal(r.x, 60); assert.equal(r.guideX, 100); assert.equal(r.y, 40);
});
test('グリッド外の縁にも独立して吸着する', () => {
  const r = snapToGuides({ x: 64, y: 45 }, { x: 60, y: 40 }, size, [{ ...target[0], x: 103 }], 7);
  assert.equal(r.x, 63); assert.equal(r.guideX, 103);
});
test('縁が遠ければ指定位置をそのまま使う', () => {
  const r = snapToGuides({ x: 40, y: 30 }, { x: 40, y: 20 }, size, target, 7);
  assert.deepEqual(r, { x: 40, y: 20, guideX: null, guideY: null });
});
