import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSketch, SKETCH_MAX_BYTES } from '../js/diagram/sketch-import.mjs';
const valid = () => ({ version: 1, nodes: [
  { id: 'a', type: 'rect', x: 40, y: 50, w: 160, h: 80, text: '開始' },
  { id: 'b', type: 'ellipse', x: 300, y: 50, w: 160, h: 80, text: '終了' },
], edges: [{ id: 'e1', from: { node: 'a', side: 'right' }, to: { node: 'b', side: 'left' }, arrow: 'end', label: '次へ' }], uncertain: [] });
const parse = v => parseSketch(JSON.stringify(v));

test('対応する図形と明示した接続を編集可能な図に変換', () => {
  const { doc, warnings } = parse(valid());
  assert.equal(doc.items.length, 3); assert.deepEqual(warnings, []);
  assert.deepEqual(doc.items[2].from, { id: 1, ax: 1, ay: .5 });
  assert.deepEqual(doc.items[2].to, { id: 2, ang: Math.PI });
  assert.equal(doc.items[2].wire, false); assert.equal(doc.items[2].arrow, 'end');
});
test('未対応の項目と型、数値、参照、重複 ID を拒否', () => {
  let v = valid(); v.nodes[0].type = 'gate'; assert.throws(() => parse(v), /type/);
  v = valid(); v.extra = true; assert.throws(() => parse(v), /未対応/);
  v = valid(); v.nodes[0].x = '10'; assert.throws(() => parse(v), /数値/);
  v = valid(); v.nodes[0].x = 10001; assert.throws(() => parse(v), /数値/);
  v = valid(); v.edges[0].to.node = 'missing'; assert.throws(() => parse(v), /見つかりません/);
  v = valid(); v.nodes[1].id = 'a'; assert.throws(() => parse(v), /重複/);
  v = valid(); v.edges[0].from.side = 'center'; assert.throws(() => parse(v), /side/);
  assert.throws(() => parseSketch('{"version":1,"version":1,"nodes":[],"edges":[],"uncertain":[]}'), /重複/);
  assert.throws(() => parseSketch('{"version":1,"nodes":[{"id":"a","type":"rect","x":1e400,"y":0,"w":20,"h":20,"text":""}],"edges":[],"uncertain":[]}'), /数値/);
});
test('件数・サイズ上限を拒否し、注意事項と文字を保持', () => {
  let v = valid(); v.nodes = Array.from({ length: 201 }, (_, i) => ({ ...v.nodes[0], id: `n${i}` })); assert.throws(() => parse(v), /200/);
  assert.throws(() => parseSketch(' '.repeat(SKETCH_MAX_BYTES + 1)), /256 KB/);
  v = valid(); v.uncertain = ['矢印の向きは不明']; v.nodes[0].text = '<img src=x> $x$';
  const result = parse(v); assert.deepEqual(result.warnings, ['矢印の向きは不明']); assert.equal(result.doc.items[0].text, '<img src=x> \\$x\\$');
});

test('台形・多角形の形を検証し、あいまいな接続を拒否', () => {
  const v = valid();
  v.nodes.push({ id: 't', type: 'trap', x: 80, y: 220, w: 120, h: 60, text: '', trapDir: 'top', inset: .2 });
  v.nodes.push({ id: 'p', type: 'poly', x: 300, y: 220, w: 100, h: 100, text: '', sides: 6 });
  const { doc } = parse(v); assert.equal(doc.items[2].trapDir, 'top'); assert.equal(doc.items[3].sides, 6);
  v.nodes[3].sides = 2; assert.throws(() => parse(v), /sides/);
  v.nodes[3].sides = 6; v.edges[0].from.node = 'p'; assert.throws(() => parse(v), /接続を指定できません/);
});

test('余分なキーや極端な入れ子を見逃さない', () => {
  const v = valid(); v.edges[0].from.extra = 1; assert.throws(() => parse(v), /未対応/);
  assert.throws(() => parseSketch('{"version":1,"nodes":[],"edges":[],"uncertain":' + '['.repeat(20) + '0' + ']'.repeat(20) + '}'), /深すぎ/);
});
