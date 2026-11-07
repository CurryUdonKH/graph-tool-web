import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circuitDoubleClick } from '../js/diagram/circuit-interaction.mjs';

test('配線の終点は描き直し後でも時間と画面上の位置で連続クリックを判定する', () => {
  const first = { t: 1000, x: 400, y: 300 };
  assert.equal(circuitDoubleClick(first, { t: 1550, x: 404, y: 302 }), true);
  assert.equal(circuitDoubleClick(first, { t: 1899, x: 400, y: 300 }), true);
  assert.equal(circuitDoubleClick(first, { t: 1900, x: 400, y: 300 }), false);
  assert.equal(circuitDoubleClick(first, { t: 1200, x: 410, y: 300 }), false);
  assert.equal(circuitDoubleClick(null, { t: 1200, x: 400, y: 300 }), false);
});
