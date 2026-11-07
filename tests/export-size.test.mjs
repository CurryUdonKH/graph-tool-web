import { test } from 'node:test';
import assert from 'node:assert/strict';

test('書き出し幅の指定は縦横を同じ倍率で縮め、指定しない図は従来の寸法を保つ', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  const { buildSVG } = await import('../js/export.js');
  const prims = [{ k: 'rect', x: 0, y: 0, w: 1000, h: 500, lw: 1 }];
  const normal = await buildSVG(prims), scaled = await buildSVG(prims, null, 480);
  assert.ok(normal.w > 480);
  assert.equal(scaled.w, 480);
  assert.ok(Math.abs(normal.w / normal.h - scaled.w / scaled.h) < 1e-10);
  assert.equal(normal.svg.match(/viewBox="([^"]+)"/)[1], scaled.svg.match(/viewBox="([^"]+)"/)[1]);
  const small = await buildSVG([{ k: 'rect', x: 0, y: 0, w: 100, h: 50, lw: 1 }], null, 480);
  assert.ok(small.w < 480);
});
