import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactCircuitDoc } from '../js/diagram/circuit-compact.mjs';
import { parseSketch } from '../js/diagram/sketch-import.mjs';
const c = (id, type, x, y, rotation, name = '') => ({ id, type, x, y, rotation, name, value: '' });
const j = (id, x, y) => ({ id, x, y }), n = junction => ({ junction }), p = (component, pin) => ({ component, pin });
const w = (id, from, to, points = []) => ({ id, from, to, points });
// ユーザーが提示した座標・結線から作った検証用の再構成であり、元 JSON ではない。
const large = { version: 2, components: [c('d1','diode',3080,2560,90), c('rsh','resistor',4740,2520,90,'Rsh'), c('rs','resistor',6700,800,0,'Rs')],
  junctions: [j('j1',3080,800), j('j2',4740,800), j('j3',3080,4320), j('j4',4740,4320)], wires: [
    w('w1',n('j1'),n('j2')), w('w2',n('j1'),p('d1','anode')), w('w3',p('d1','cathode'),n('j3')), w('w4',n('j2'),p('rsh','a')), w('w5',p('rsh','b'),n('j4')), w('w6',n('j3'),n('j4')), w('w7',n('j2'),p('rs','a')), w('w8',p('rs','b'),{x:8280,y:800}), w('w9',n('j4'),{x:8280,y:4320}), w('w10',n('j1'),{x:1220,y:2080},[{x:1220,y:800}]), w('w11',{x:1220,y:3040},n('j3'),[{x:1220,y:4320}])], uncertain: [] };
test('大きすぎる回路の空白だけを縮め、部品寸法・参照・自由端・折点を保つ', () => {
  const source = parseSketch(JSON.stringify(large)).doc, before = JSON.stringify(source), result = compactCircuitDoc(source);
  assert.equal(result.applied, true); assert.equal(JSON.stringify(source), before);
  assert.ok(result.after[0] < result.before[0] / 2); assert.ok(result.after[1] < result.before[1] / 2);
  assert.deepEqual(result.doc.items.filter(x => x.type === 'circuit').map(x => [x.kind,x.w,x.h,x.rotation]), source.items.filter(x => x.type === 'circuit').map(x => [x.kind,x.w,x.h,x.rotation]));
  const wires = d => d.items.filter(x => x.circuitWire);
  assert.deepEqual(wires(result.doc).map(x => [x.from.id ?? null,x.from.pin ?? null,x.to.id ?? null,x.to.pin ?? null,x.terminalEnds]), wires(source).map(x => [x.from.id ?? null,x.from.pin ?? null,x.to.id ?? null,x.to.pin ?? null,x.terminalEnds]));
  assert.equal(wires(result.doc).flatMap(x => [x.from,x.to]).filter(x => x.id == null).length, 4);
  for (const x of wires(result.doc)) for (const pt of [...(x.points || []), ...[x.from,x.to].filter(r => r.id == null)]) assert.equal(pt.x % 20 + pt.y % 20, 0);
});
test('太陽電池の確認用回路を横長に清書し、端子と矢印を保つ', () => {
  const data = structuredClone(large);
  data.components.unshift(c('src','current_source',1220,2560,270,'I_ph'));
  data.wires[9].to = p('src','b'); data.wires[10].from = p('src','a');
  data.annotations = [
    { id:'id',from:{x:3420,y:2400},to:{x:3420,y:2720},label:'I_d' },
    { id:'vd',from:{x:3800,y:2720},to:{x:3800,y:2400},label:'V_d' },
    { id:'i',from:{x:7000,y:600},to:{x:7600,y:600},label:'I' },
    { id:'v',from:{x:8600,y:3300},to:{x:8600,y:1800},label:'V' },
  ];
  const original = parseSketch(JSON.stringify(data)).doc, result = compactCircuitDoc(original);
  assert.equal(result.applied, true);
  assert.ok(result.after[0] > result.after[1]);
  assert.ok(result.after[0] < 1200);
  assert.equal(original.circuitSketchClean, undefined);
  assert.equal(result.doc.circuitSketchClean, true);
  const notes = result.doc.items.filter(x => x.annotation);
  assert.deepEqual(notes.map(x => x.label), ['$I_{d}$','$V_{d}$','I','V']);
  assert.ok(notes[0].from.y < notes[0].to.y && notes[1].from.y > notes[1].to.y && notes[2].from.x < notes[2].to.x && notes[3].from.y > notes[3].to.y);
  assert.ok(notes[1].from.x - notes[0].from.x >= 80);
  assert.ok(notes.every(x => x.fontSize === 24));
  const wires = d => d.items.filter(x => x.circuitWire).map(x => [x.from.id ?? null,x.from.pin ?? null,x.to.id ?? null,x.to.pin ?? null,x.terminalEnds]);
  assert.deepEqual(wires(result.doc), wires(original));
});
test('通常の回路は手を加えず、電流源や注釈の位置と向きも保持する', () => {
  const small = { version: 2, components: [c('src','current_source',200,300,270)], junctions: [], wires: [w('x',p('src','b'),{x:200,y:160})], annotations: [{ id:'note',from:{x:120,y:360},to:{x:120,y:240},label:'I_ph' }], uncertain: [] };
  const original = parseSketch(JSON.stringify(small)).doc; assert.equal(compactCircuitDoc(original).applied, false);
  const big = structuredClone(small); big.wires[0].to.y = 9920; big.wires[0].from.pin = 'a';
  const source = parseSketch(JSON.stringify(big)).doc, r = compactCircuitDoc(source);
  assert.equal(r.applied, true);
  assert.equal(r.doc.items[0].rotation, 270); assert.equal(r.doc.items[0].w, 80); assert.equal(r.doc.items[0].h, 120);
  const note = r.doc.items.find(x => x.annotation); assert.equal(note.label, '$I_{ph}$'); assert.ok(note.from.y > note.to.y);
});
test('提供された回路データを清書し、元の入力・接続・開放端・数式を保つ', () => {
  const input = readFileSync(new URL('./fixtures/solar-cell-user.json', import.meta.url), 'utf8');
  const parsed = parseSketch(input), source = JSON.stringify(parsed.doc), result = compactCircuitDoc(parsed.doc);
  assert.ok(result.applied, result.changes.join(' '));
  assert.equal(JSON.stringify(parsed.doc), source);
  assert.ok(result.after[0] < result.before[0] && result.after[1] < result.before[1]);
  assert.ok(result.after[0] > result.after[1]);
  assert.deepEqual(result.doc.items.filter(x => x.type === 'circuit').map(x => x.name), ['$I_{ph}$','','$R_{sh}$','$R_{s}$']);
  assert.deepEqual(result.doc.items.filter(x => x.annotation).map(x => x.label), ['$V_{d}$','$I_{d}$','I','V']);
  const connections = d => d.items.filter(x => x.circuitWire).map(x => [x.from.id ?? null,x.from.pin ?? null,x.to.id ?? null,x.to.pin ?? null,x.terminalEnds]);
  assert.deepEqual(connections(result.doc), connections(parsed.doc));
  assert.equal(result.doc.items.filter(x => x.circuitWire && x.terminalEnds === 'end').length, 2);
});
test('黒点のない交差を残し、接続や開放端を作り替えない', () => {
  const data = { version: 2, components: [], junctions: [], wires: [w('h',{x:100,y:500},{x:5000,y:500}),w('v',{x:2500,y:100},{x:2500,y:900})], uncertain: [] };
  const source = parseSketch(JSON.stringify(data)).doc, r = compactCircuitDoc(source);
  assert.equal(r.applied, true);
  const [h,v] = r.doc.items.filter(x => x.circuitWire);
  assert.ok(h.from.x < v.from.x && v.from.x < h.to.x && v.from.y < h.from.y && h.from.y < v.to.y);
  assert.deepEqual([h.from.id,h.to.id,v.from.id,v.to.id], [undefined,undefined,undefined,undefined]);
  assert.equal(r.doc.items.filter(x => x.type === 'circuit-junction').length, 0);
});
