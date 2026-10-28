import test from 'node:test';
import assert from 'node:assert/strict';
import { isWire, migrateWireTypes } from '../js/diagram/wiretypes.mjs';

test('矢印の有無や線の形では配線にならない', () => {
  assert.equal(isWire({ type: 'edge', style: 'elbow', arrow: 'none', wire: false }), false);
  assert.equal(isWire({ type: 'edge', style: 'straight', arrow: 'none', wire: true }), true);
});
test('旧データの種類を接続先から判定し明示した種類は保持', () => {
  const items = [
    { id: 1, type: 'gate' }, { id: 2, type: 'rect' },
    { id: 3, type: 'edge', style: 'elbow', arrow: 'none', from: { id: 1 }, to: { x: 10, y: 10 } },
    { id: 4, type: 'edge', style: 'elbow', arrow: 'none', from: { id: 2 }, to: { x: 10, y: 10 } },
    { id: 5, type: 'edge', style: 'straight', arrow: 'none', from: { id: 1 }, to: {}, wire: false },
    { id: 6, type: 'edge', style: 'elbow', arrow: 'none', from: {}, to: {}, wire: true },
  ];
  migrateWireTypes(items);
  assert.deepEqual(items.slice(2).map(isWire), [true, false, false, true]);
});
