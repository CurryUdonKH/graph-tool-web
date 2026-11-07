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

test('大きな座標を縦横同じ倍率で縮め、文字と縦横比を維持', () => {
  const v = { version: 1, nodes: [
    { id: 'stateA', type: 'ellipse', x: 1150, y: 3750, w: 2000, h: 2000, text: '状態A' },
    { id: 'stateB', type: 'ellipse', x: 5900, y: 3400, w: 2000, h: 2000, text: '状態B' },
  ], edges: [], uncertain: ['曲線が不明'] };
  const { doc, warnings } = parse(v), [a, b] = doc.items;
  const scale = 800 / 6750;
  assert.ok(Math.abs(a.w - 2000 * scale) < 1e-9);
  assert.equal(a.w, a.h);
  assert.ok(Math.abs((b.x - a.x) / (b.y - a.y) - 4750 / -350) < 1e-9);
  assert.equal(a.fontSize, 22);
  assert.ok(warnings.some(w => w.includes('以前の上限')));
  assert.ok(warnings.includes('曲線が不明'));
  v.nodes[0].w = 2800; v.nodes[0].h = 1400;
  const ellipse = parse(v).doc.items[0]; assert.equal(ellipse.w / ellipse.h, 2);
});

test('旧形式の小さな図は拡大せず、異なる大きさでも共通倍率', () => {
  const v = valid(); v.nodes[0].w = 20; v.nodes[0].h = 10;
  let d = parse(v).doc; assert.equal(d.items[0].w, 20); assert.equal(d.items[0].h, 10); assert.equal(d.items[0].fontSize, 8);
  v.nodes[1].x = 7000; d = parse(v).doc;
  assert.ok(d.items[0].w < 20); assert.ok(Math.abs(d.items[1].w / d.items[0].w - 8) < 1e-9);
});

test('曲線の制御点を端点相対に変換し、一様に縮尺する', () => {
  const v = valid(); v.nodes[1].x = 4000;
  Object.assign(v.edges[0], { style: 'curve', control1: { x: 800, y: 0 }, control2: { x: 3200, y: 0 } });
  const { doc } = parse(v); const [a, b, e] = doc.items, factor = 800 / 4120;
  assert.equal(e.style, 'curve'); assert.equal(e.arrow, 'end'); assert.equal(e.wire, false);
  assert.ok(Math.abs(e.c1.dx - (800 - 200) * factor) < 1e-9);
  assert.ok(Math.abs(e.c1.dy - (0 - 90) * factor) < 1e-9);
  assert.ok(Math.abs(e.c2.dx - (3200 - 4000) * factor) < 1e-9);
  assert.ok(Math.abs((b.x - a.x) - 3960 * factor) < 1e-9);
  delete v.edges[0].control2; assert.throws(() => parse(v), /control/);
  v.edges[0].control2 = { x: -1, y: 0 }; assert.throws(() => parse(v), /数値/);
  v.edges[0].control2 = { x: 200, y: 0, other: true }; assert.throws(() => parse(v), /未対応/);
  v.edges[0].control2 = { x: 200, y: 0 }; v.edges[0].style = 'straight'; assert.throws(() => parse(v), /制御点/);
});

test('原画に合わせた文字と楕円上の接続位置を共通倍率で保持', () => {
  const v = { version: 1, nodes: [
    { id: 'a', type: 'ellipse', x: 80, y: 275, w: 720, h: 335, text: '状態A', fontSize: 134 },
    { id: 'b', type: 'ellipse', x: 1110, y: 250, w: 615, h: 320, text: '状態B', fontSize: 128 },
  ], edges: [{ id: 'e', from: { node: 'a', angle: -35 }, to: { node: 'b', angle: -145 }, style: 'curve', control1: { x: 860, y: 50 }, control2: { x: 1110, y: 40 }, arrow: 'end', label: '' }], uncertain: [] };
  const { doc } = parse(v), [a, b, e] = doc.items;
  assert.ok(Math.abs(a.w / a.h - 720 / 335) < 1e-12);
  assert.ok(Math.abs(b.w / b.h - 615 / 320) < 1e-12);
  assert.ok(Math.abs(a.fontSize / a.h - 134 / 335) < 1e-12);
  assert.ok(Math.abs(b.fontSize / b.h - 128 / 320) < 1e-12);
  assert.ok(Math.abs(e.from.ang - (-35 * Math.PI / 180)) < 1e-12);
  assert.ok(Math.abs(e.to.ang - (-145 * Math.PI / 180)) < 1e-12);
  v.nodes[0].fontSize = 336; assert.throws(() => parse(v), /fontSize/);
  v.nodes[0].fontSize = 134; v.edges[0].from.side = 'right'; assert.throws(() => parse(v), /どちらか一方/);
  delete v.edges[0].from.side; v.edges[0].from.angle = 181; assert.throws(() => parse(v), /angle/);
  v.edges[0].from.angle = -35; v.nodes[0].type = 'rect'; assert.throws(() => parse(v), /楕円/);
});

test('素の JSON と単一のコードブロックを同じ図として検証する', () => {
  const raw = JSON.stringify(valid());
  const expected = parseSketch(raw);
  for (const input of [
    ` \n${raw}\n `,
    '```json\n' + raw + '\n```',
    ' \t\r\n```json\r\n' + raw + '\r\n```\r\n ',
    '```\n' + raw + '\n```',
    '```json  \n  ' + raw + '  \n```   ',
  ]) assert.deepEqual(parseSketch(input), expected);
  const v=valid(); v.nodes[0].text='本文中の ``` は文字';
  assert.equal(parseSketch('```json\n'+JSON.stringify(v)+'\n```').doc.items[0].text,'本文中の ``` は文字');
});

test('複数ブロック、説明、壊れた囲み、JSON以外を拒否する', () => {
  const raw=JSON.stringify(valid()), block='```json\n'+raw+'\n```';
  for (const input of [
    block+'\n'+block,
    '説明\n'+block,
    block+'\n説明',
    '```json\n'+raw,
    '```json '+raw+'\n```',
    '```javascript\n'+raw+'\n```',
    '```json\n'+raw+'\n``',
    '```json\n'+raw+'\n```\n```\n'+raw+'\n```',
    '```json\nalert(1)\n```',
    raw+'\n説明',
  ]) assert.throws(() => parseSketch(input), /コードブロック|JSON/);
  assert.throws(() => parseSketch('```json\n{"version":1,"version":1,"nodes":[],"edges":[],"uncertain":[]}\n```'), /重複/);
  assert.throws(() => parseSketch('```json\n'+ ' '.repeat(SKETCH_MAX_BYTES) +'\n```'), /256 KB/);
});
