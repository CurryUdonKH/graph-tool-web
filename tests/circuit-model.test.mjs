import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circuitPins, analyzeCircuit, splitCircuitPoints } from '../js/diagram/circuit-model.mjs';

const component = (id, type, x, y, rotation = 0) => ({ id, type, x, y, rotation });
const pin = (component, pin) => ({ component, pin });
const junction = id => ({ junction: id });
const wire = (id, from, to, points = []) => ({ id, from, to, points });
const netOf = (result, kind, id, pinName) => result.nets.find(n => n.some(v => v[0] === kind && v[1] === id && (pinName === undefined || v[2] === pinName)));

test('折れた既存配線に接続点を置いても元の経路と折点を保つ', () => {
  const points = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 100 }, { x: 160, y: 100 }];
  assert.deepEqual(splitCircuitPoints(points, { x: 80, y: 40 }), {
    before: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }],
    after: [{ x: 80, y: 40 }, { x: 80, y: 100 }, { x: 160, y: 100 }],
  });
  assert.deepEqual(splitCircuitPoints(points, { x: 80, y: 0 }), {
    before: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
    after: [{ x: 80, y: 0 }, { x: 80, y: 100 }, { x: 160, y: 100 }],
  });
  assert.throws(() => splitCircuitPoints(points, { x: 81, y: 40 }));
});

test('部品ごとに端子を持ち、回転しても端子名と極性を保つ', () => {
  for (const type of ['resistor', 'capacitor', 'inductor']) assert.deepEqual(Object.keys(circuitPins(component('x', type, 100, 100))), ['a', 'b']);
  assert.deepEqual(circuitPins(component('v', 'voltage', 100, 100, 90)), { positive: { x: 100, y: 40 }, negative: { x: 100, y: 160 } });
  assert.deepEqual(circuitPins(component('g', 'ground', 100, 100, 180)), { terminal: { x: 100, y: 140 } });
  assert.throws(() => circuitPins(component('x', 'unknown', 0, 0)));
});

test('直列では配線で指定した端子だけがつながり、部品の両端は別の接続になる', () => {
  const c = { components: [component('v', 'voltage', 0, 0), component('r', 'resistor', 160, 0), component('g', 'ground', 260, 40)], junctions: [], wires: [wire('a', pin('v', 'negative'), pin('r', 'a')), wire('b', pin('r', 'b'), pin('g', 'terminal'))] };
  const result = analyzeCircuit(c);
  assert.ok(netOf(result, 'pin', 'v', 'negative').some(v => v[1] === 'r' && v[2] === 'a'));
  assert.notEqual(netOf(result, 'pin', 'r', 'a'), netOf(result, 'pin', 'r', 'b'));
});

test('並列の分岐は明示した接続点で接続する', () => {
  const c = { components: [component('r', 'resistor', 0, 0), component('c', 'capacitor', 0, 80)], junctions: [{ id: 'j', x: -100, y: 0 }], wires: [wire('1', pin('r', 'a'), junction('j')), wire('2', pin('c', 'a'), junction('j'), [{ x: -100, y: 80 }])] };
  const result = analyzeCircuit(c);
  assert.equal(netOf(result, 'pin', 'r', 'a'), netOf(result, 'pin', 'c', 'a'));
});

test('配線が交差しても接続点の指定なしにはつながらない', () => {
  const c = { components: [component('h', 'resistor', 0, 0), component('v', 'inductor', 0, 0, 90)], junctions: [], wires: [wire('h', pin('h', 'a'), pin('h', 'b')), wire('v', pin('v', 'a'), pin('v', 'b'))] };
  const result = analyzeCircuit(c);
  assert.notEqual(netOf(result, 'pin', 'h', 'a'), netOf(result, 'pin', 'v', 'a'));
});

test('曖昧な端、存在しない端子、斜めの線や重複 ID は拒否する', () => {
  const base = { components: [component('r', 'resistor', 0, 0)], junctions: [{ id: 'j', x: 0, y: 40 }], wires: [] };
  for (const bad of [wire('1', { x: -60, y: 0 }, junction('j')), wire('1', pin('r', 'missing'), junction('j')), wire('1', pin('r', 'a'), junction('j'))]) assert.throws(() => analyzeCircuit({ ...base, wires: [bad] }));
  assert.throws(() => analyzeCircuit({ ...base, components: [...base.components, component('r', 'inductor', 0, 0)] }));
  assert.deepEqual(base.components[0], component('r', 'resistor', 0, 0));
});

test('五種類の記号・極性・部品名と値を共通の描画一覧にできる', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  for (const type of ['resistor', 'capacitor', 'inductor', 'voltage', 'ground']) {
    const prims = circuitPrimitives({ ...component('x', type, 100, 100, 90), name: 'R1', value: '10 kΩ' });
    assert.ok(prims.some(p => p.k === 'path'));
    assert.equal(prims.find(p => p.k === 'text').s, 'R1  10 kΩ');
    assert.ok(prims.filter(p => p.k !== 'text').every(p => p.lw === 1.5));
  }
  const plain = circuitPrimitives(component('c', 'capacitor', 100, 100));
  const polarized = circuitPrimitives({ ...component('c', 'capacitor', 100, 100), polarized: true });
  assert.equal(polarized.length, plain.length + 2);
  assert.ok(circuitPrimitives(component('v', 'voltage', 100, 100)).some(p => p.k === 'ellipse'));
});

test('十字交差は非接続、重なりや未指定の線端・接続点は拒否する', async () => {
  const { circuitRouteConflict: conflict } = await import('../js/diagram/circuit-model.mjs');
  const p = (x, y) => ({ x, y }), a = { id: 1, pin: 'a' }, b = { id: 2, pin: 'b' }, c = { id: 3 }, d = { id: 4 };
  const existing = [{ points: [p(0, 0), p(100, 0)], ends: [a, b] }];
  assert.equal(conflict([p(50, -50), p(50, 50)], [c, d], existing), false);
  assert.equal(conflict([p(50, 0), p(50, 50)], [c, d], existing), true);
  assert.equal(conflict([p(20, 0), p(80, 0)], [c, d], existing), true);
  assert.equal(conflict([p(0, 0), p(0, 50)], [a, d], existing), false);
  assert.equal(conflict([p(50, -50), p(50, 50)], [c, d], [], [{ id: 5, x: 50, y: 0 }]), true);
});

test('回路の取り込みは端子 ID を保持し、JSON とコードブロックを受け付ける', async () => {
  const { parseSketch } = await import('../js/diagram/sketch-import.mjs');
  const input = { version: 2, components: [
    { id: 'r', type: 'resistor', x: 200, y: 200, rotation: 0, name: 'R1', value: '1k' },
    { id: 'c', type: 'capacitor', x: 400, y: 200, rotation: 0, name: 'C1', value: '1uF', polarized: true },
  ], junctions: [], wires: [{ id: 'w', from: { component: 'r', pin: 'b' }, to: { component: 'c', pin: 'a' }, points: [] }], uncertain: ['値を確認'] };
  const json = JSON.stringify(input), parsed = parseSketch(json);
  assert.deepEqual(parseSketch(`\`\`\`json\n${json}\n\`\`\``), parsed);
  assert.equal(parsed.doc.items[1].polarized, true);
  assert.deepEqual(parsed.doc.items[2].from, { id: 1, pin: 'b' });
  assert.deepEqual(parsed.warnings, ['値を確認']);
  const bad = structuredClone(input); bad.wires[0].to.pin = 'unknown';
  assert.throws(() => parseSketch(JSON.stringify(bad)));
  const bad2 = structuredClone(input); bad2.components[0].type = 'toString';
  assert.throws(() => parseSketch(JSON.stringify(bad2)));
});

test('配線が記号の内部を横切る経路を拒否し、端子から外向きは許可する', async () => {
  const { circuitPathCrossesBody: crosses } = await import('../js/diagram/circuit-model.mjs');
  const body = { x: 40, y: 60, w: 120, h: 80 };
  assert.equal(crosses([{ x: 0, y: 100 }, { x: 200, y: 100 }], body), true);
  assert.equal(crosses([{ x: 0, y: 100 }, { x: 40, y: 100 }], body), false);
});

test('直流は長い正極と短い負極、交流は極性のない波線を使う', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  const dc = circuitPrimitives(component('dc', 'voltage_dc', 100, 100));
  const ac = circuitPrimitives(component('ac', 'voltage_ac', 100, 100));
  const vertical = dc.filter(p => p.k === 'path' && p.cmds.length === 2 && p.cmds[0][1] === p.cmds[1][1]);
  assert.deepEqual(vertical.map(p => [p.cmds[0][1], Math.abs(p.cmds[1][2] - p.cmds[0][2])]), [[92, 44], [108, 24]]);
  assert.equal(dc.some(p => p.k === 'ellipse'), false);
  assert.equal(ac.filter(p => p.k === 'ellipse').length, 1);
  assert.ok(ac.some(p => p.k === 'path' && p.cmds.some(c => c[0] === 'C')));
  assert.deepEqual(Object.keys(circuitPins(component('ac', 'voltage_ac', 100, 100))), ['a', 'b']);
  for (const type of ['voltage_dc', 'voltage_ac']) for (const angle of [0, 90, 180, 270]) {
    const pins = circuitPins(component('v', type, 100, 100, angle));
    const expected = angle === 0 ? [[40, 100], [160, 100]] : angle === 90 ? [[100, 40], [100, 160]] : angle === 180 ? [[160, 100], [40, 100]] : [[100, 160], [100, 40]];
    assert.deepEqual(Object.values(pins).map(p => [p.x, p.y]), expected);
  }
});

test('従来の電圧源の描画と端子は自動変換せず維持する', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  const legacy = component('v', 'voltage', 100, 100);
  const before = structuredClone(legacy), prims = circuitPrimitives(legacy);
  assert.deepEqual(legacy, before);
  assert.deepEqual(circuitPins(legacy), { positive: { x: 40, y: 100 }, negative: { x: 160, y: 100 } });
  assert.equal(prims.length, 6);
  assert.equal(prims[2].k, 'ellipse');
  assert.deepEqual(prims[3].cmds, [['M', 81, 100], ['L', 91, 100]]);
  assert.deepEqual(prims[4].cmds, [['M', 86, 95], ['L', 86, 105]]);
  assert.deepEqual(prims[5].cmds, [['M', 109, 100], ['L', 119, 100]]);
});

test('回路取込は電源の種類と端子を保持し、交流の正負指定を拒否する', async () => {
  const { parseSketch, SKETCH_PROMPT } = await import('../js/diagram/sketch-import.mjs');
  const input = { version: 2, components: [
    { id: 'dc', type: 'voltage_dc', x: 200, y: 200, rotation: 0, name: 'DC', value: '5V' },
    { id: 'ac', type: 'voltage_ac', x: 400, y: 200, rotation: 0, name: 'AC', value: '100V' },
    { id: 'old', type: 'voltage', x: 600, y: 200, rotation: 0, name: '旧', value: '' },
  ], junctions: [], wires: [
    { id: 'w', from: { component: 'dc', pin: 'positive' }, to: { component: 'ac', pin: 'a' }, points: [{ x: 120, y: 120 }, { x: 340, y: 120 }] },
  ], uncertain: [] };
  // 直角の曲がり角を明示する。
  input.wires[0].points = [{ x: 140, y: 120 }, { x: 340, y: 120 }];
  const doc = parseSketch(JSON.stringify(input)).doc;
  assert.deepEqual(doc.items.slice(0, 3).map(s => s.kind), ['voltage_dc', 'voltage_ac', 'voltage']);
  assert.deepEqual(doc.items[3].from, { id: 1, pin: 'positive' });
  assert.deepEqual(doc.items[3].to, { id: 2, pin: 'a' });
  input.wires[0].to.pin = 'negative';
  assert.throws(() => parseSketch(JSON.stringify(input)));
  assert.match(SKETCH_PROMPT, /voltage_dc\|voltage_ac/);
  assert.match(SKETCH_PROMPT, /不明な電源は推測せず/);
});

test('ダイオードは三角形の側がアノード、棒の側がカソードで、回転しても端子名を保つ', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  const d = component('d', 'diode', 100, 100);
  const parts = circuitPrimitives({ ...d, name: 'D1', value: '1N4148' });
  assert.deepEqual(circuitPins(d), { anode: { x: 40, y: 100 }, cathode: { x: 160, y: 100 } });
  assert.deepEqual(parts[2].cmds, [['M', 70, 80], ['L', 110, 100], ['L', 70, 120], ['L', 70, 80]]);
  assert.deepEqual(parts[3].cmds, [['M', 110, 80], ['L', 110, 120]]);
  assert.equal(parts.find(p => p.k === 'text').s, 'D1  1N4148');
  for (const [rotation, anode, cathode] of [
    [0, [40, 100], [160, 100]], [90, [100, 40], [100, 160]],
    [180, [160, 100], [40, 100]], [270, [100, 160], [100, 40]],
  ]) {
    const pins = circuitPins({ ...d, rotation });
    assert.deepEqual([pins.anode.x, pins.anode.y], anode);
    assert.deepEqual([pins.cathode.x, pins.cathode.y], cathode);
  }
});

test('ダイオードの取込でアノードとカソードへの接続を維持し、未対応の種類を拒否する', async () => {
  const { parseSketch, SKETCH_PROMPT } = await import('../js/diagram/sketch-import.mjs');
  const input = { version: 2, components: [
    { id: 'd', type: 'diode', x: 200, y: 200, rotation: 0, name: 'D1', value: '1N4148' },
    { id: 'r', type: 'resistor', x: 400, y: 200, rotation: 0, name: 'R1', value: '1k' },
  ], junctions: [], wires: [{ id: 'w', from: { component: 'd', pin: 'cathode' }, to: { component: 'r', pin: 'a' }, points: [] }], uncertain: [] };
  const doc = parseSketch(JSON.stringify(input)).doc;
  assert.equal(doc.items[0].kind, 'diode');
  assert.equal(doc.items[0].value, '1N4148');
  assert.deepEqual(doc.items[2].from, { id: 1, pin: 'cathode' });
  const wrongPin = structuredClone(input); wrongPin.wires[0].from.pin = 'positive';
  assert.throws(() => parseSketch(JSON.stringify(wrongPin)));
  for (const type of ['led', 'zener']) { const bad = structuredClone(input); bad.components[0].type = type; assert.throws(() => parseSketch(JSON.stringify(bad))); }
  assert.match(SKETCH_PROMPT, /anode（三角形側）と cathode（線側）/);
});

test('2端子の可変抵抗は抵抗と同じ端子で、斜め矢印を回転して表示する', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  const d = component('r', 'variable_resistor', 100, 100);
  assert.deepEqual(Object.keys(circuitPins(d)), ['a', 'b']);
  const plain = circuitPrimitives({ ...d, type: 'resistor' });
  const varied = circuitPrimitives({ ...d, name: 'VR1', value: '10k' });
  assert.equal(varied.filter(p => p.k === 'path').length, plain.filter(p => p.k === 'path').length + 2);
  assert.deepEqual(varied[3].cmds, [['M', 68, 127], ['L', 128, 73]]);
  assert.deepEqual(circuitPrimitives({ ...d, rotation: 90 })[3].cmds, [['M', 73, 68], ['L', 127, 128]]);
  assert.equal(varied.find(p => p.k === 'text').s, 'VR1  10k');
  assert.deepEqual(circuitPins({ ...d, rotation: 90 }), { a: { x: 100, y: 40 }, b: { x: 100, y: 160 } });
});

test('電流源は a から b へ矢印が向き、回転後も端子と矢印が同じ向きになる', async () => {
  const { circuitPrimitives } = await import('../js/diagram/circuit-model.mjs');
  const c = component('i', 'current_source', 200, 300, 270);
  assert.deepEqual(circuitPins(c), { a: { x: 200, y: 360 }, b: { x: 200, y: 240 } });
  const p = circuitPrimitives(c);
  assert.ok(p.some(x => x.k === 'ellipse' && x.cx === 200 && x.cy === 300));
  assert.ok(p.some(x => x.k === 'path' && JSON.stringify(x.cmds) === JSON.stringify([['M', 200, 315], ['L', 200, 285]])));
});

test('電流・電圧の矢印は編集可能な注釈として取り込み、電気接続に含めない', async () => {
  const { parseSketch, SKETCH_PROMPT } = await import('../js/diagram/sketch-import.mjs');
  const base = { version: 2, components: [{ id: 'i', type: 'current_source', x: 200, y: 300, rotation: 270, name: 'I_ph', value: '' }],
    junctions: [], wires: [{ id: 'w', from: { component: 'i', pin: 'b' }, to: { x: 200, y: 160 }, points: [] }],
    annotations: [{ id: 'a', from: { x: 120, y: 360 }, to: { x: 120, y: 240 }, label: 'I_ph' }], uncertain: [] };
  const doc = parseSketch(JSON.stringify(base)).doc;
  const mark = doc.items.find(x => x.annotation);
  assert.deepEqual([mark.style, mark.wire, mark.arrow, mark.label], ['straight', false, 'end', '$I_{ph}$']);
  assert.deepEqual([mark.from, mark.to], [{ x: 120, y: 360 }, { x: 120, y: 240 }]);
  assert.equal(doc.items.find(x => x.circuitWire).from.pin, 'b');
  assert.match(SKETCH_PROMPT, /current_source/); assert.match(SKETCH_PROMPT, /annotations/);
  const bad = structuredClone(base); bad.annotations[0].to = bad.annotations[0].from;
  assert.throws(() => parseSketch(JSON.stringify(bad)));
  const noAnnotations = structuredClone(base); delete noAnnotations.annotations;
  assert.doesNotThrow(() => parseSketch(JSON.stringify(noAnnotations)));
  const wide = structuredClone(base); wide.annotations[0].from.x = 9000; wide.annotations[0].to.x = 9000;
  assert.match(parseSketch(JSON.stringify(wide)).warnings.join(' '), /小さく見える/);
});

test('太陽電池等価回路の並列・直列と開放出力を保って取り込む', async () => {
  const { parseSketch } = await import('../js/diagram/sketch-import.mjs');
  const comps = [component('src', 'current_source', 200, 300, 270), component('diode', 'diode', 400, 300, 90), component('sh', 'resistor', 600, 300, 90), component('rs', 'resistor', 800, 200)];
  const dots = [{ id: 't1', x: 200, y: 200 }, { id: 't2', x: 400, y: 200 }, { id: 't3', x: 600, y: 200 }, { id: 'b1', x: 200, y: 400 }, { id: 'b2', x: 400, y: 400 }, { id: 'b3', x: 600, y: 400 }];
  const wires = [wire('w1', junction('t1'), pin('src', 'b')), wire('w2', pin('src', 'a'), junction('b1')), wire('w3', junction('t2'), pin('diode', 'anode')), wire('w4', pin('diode', 'cathode'), junction('b2')), wire('w5', junction('t3'), pin('sh', 'a')), wire('w6', pin('sh', 'b'), junction('b3')), wire('w7', junction('t1'), junction('t2')), wire('w8', junction('t2'), junction('t3')), wire('w9', junction('b1'), junction('b2')), wire('w10', junction('b2'), junction('b3')), wire('w11', junction('t3'), pin('rs', 'a')), wire('w12', pin('rs', 'b'), { x: 960, y: 200 }), wire('w13', junction('b3'), { x: 960, y: 400 })];
  const result = analyzeCircuit({ components: comps, junctions: dots, wires });
  const top = netOf(result, 'pin', 'src', 'b'), bottom = netOf(result, 'pin', 'src', 'a');
  assert.equal(top, netOf(result, 'pin', 'diode', 'anode')); assert.equal(top, netOf(result, 'pin', 'sh', 'a')); assert.equal(top, netOf(result, 'pin', 'rs', 'a'));
  assert.equal(bottom, netOf(result, 'pin', 'diode', 'cathode')); assert.equal(bottom, netOf(result, 'pin', 'sh', 'b')); assert.notEqual(top, bottom);
  assert.notEqual(top, netOf(result, 'pin', 'rs', 'b')); assert.notEqual(bottom, netOf(result, 'pin', 'rs', 'b'));
  const input = { version: 2, components: comps.map(c => ({ ...c, name: c.id, value: '' })), junctions: dots, wires, annotations: [{ id: 'note', from: { x: 960, y: 360 }, to: { x: 960, y: 240 }, label: 'V' }], uncertain: [] };
  const parsed = parseSketch(JSON.stringify(input));
  assert.equal(parsed.doc.items.filter(i => i.circuitWire).length, 13);
  assert.equal(parsed.doc.items.filter(i => i.annotation).length, 1);
  assert.deepEqual(parsed.warnings, []);
});

test('回路の端数座標を一度だけグリッドに合わせ、参照と元のデータを保つ', async () => {
  const { parseSketch } = await import('../js/diagram/sketch-import.mjs');
  const data = { version: 2, components: [{...component('r','resistor',201,203), name:'R',value:''}],
    junctions: [{id:'j',x:401,y:202}],
    wires: [wire('w1',pin('r','b'),junction('j')),wire('w2',junction('j'),{x:602,y:302},[{x:402,y:302}])],
    annotations: [{id:'v',from:{x:702,y:403},to:{x:702,y:203},label:'V'}],uncertain:[] };
  const input = JSON.stringify(data), result = parseSketch(input), repeated = parseSketch(input);
  assert.equal(JSON.stringify(data), input);
  assert.deepEqual(result.doc, repeated.doc);
  assert.ok(result.warnings.some(x => /グリッドに合わせ/.test(x)));
  const part = result.doc.items.find(x => x.type === 'circuit');
  assert.equal(part.y + part.h / 2, 200);
  const dot = result.doc.items.find(x => x.type === 'circuit-junction');
  assert.deepEqual([dot.x + 5,dot.y + 5],[400,200]);
  const w = result.doc.items.filter(x => x.circuitWire);
  assert.deepEqual(w[0].to, {id:dot.id});
  assert.deepEqual(w[1].points, [{x:400,y:300}]);
  assert.deepEqual(w[1].to, {x:600,y:300});
  const note = result.doc.items.find(x => x.annotation);
  assert.deepEqual([note.from.x,note.from.y,note.to.x,note.to.y],[700,400,700,200]);
  for (const bad of ['201', 79, 9921, null]) {
    const value = structuredClone(data); value.components[0].y = bad;
    assert.throws(() => parseSketch(JSON.stringify(value)));
  }
  const collapsed = structuredClone(data); collapsed.junctions[0].x = 261;
  assert.throws(() => parseSketch(JSON.stringify(collapsed)), /重な|グリッド/);
  const missing = structuredClone(data); missing.wires[0].from.pin = 'missing';
  assert.throws(() => parseSketch(JSON.stringify(missing)));
  const short = structuredClone(data); short.annotations[0].to = {x:703,y:403};
  assert.throws(() => parseSketch(JSON.stringify(short)), /始点と終点/);
  const collapsedWire = structuredClone(data); collapsedWire.wires[1].points = [{x:400,y:201}];
  assert.throws(() => parseSketch(JSON.stringify(collapsedWire)), /グリッド/);
});

test('回路の添字と明示した数式を保持し、一般の文章は変えない', async () => {
  const { parseSketch, SKETCH_PROMPT } = await import('../js/diagram/sketch-import.mjs');
  const data = {version:2,components:[
    {id:'a',type:'resistor',x:200,y:200,rotation:0,name:'I_ph',value:'日本語 $\\overline{I}$'},
    {id:'b',type:'resistor',x:400,y:200,rotation:0,name:'R_sh',value:'10 kΩ'},
  ],junctions:[],wires:[],annotations:[{id:'v',from:{x:600,y:400},to:{x:600,y:200},label:'$V_{d}$'}],uncertain:[]};
  const original = JSON.stringify(data), items = parseSketch(original).doc.items;
  assert.equal(items[0].name, '$I_{ph}$'); assert.equal(items[0].value, '日本語 $\\overline{I}$');
  assert.equal(items[1].name, '$R_{sh}$'); assert.equal(items[1].value, '10 kΩ');
  assert.equal(items[2].label, '$V_{d}$'); assert.equal(JSON.stringify(data), original);
  assert.match(SKETCH_PROMPT, /バックスラッシュを二つ重ね/);
});

test('白丸は独立した表示で、分割時は元の外側の端にだけ残る', async () => {
  const { terminalPrimitives, splitTerminalMode } = await import('../js/diagram/terminal-marks.mjs');
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  assert.deepEqual(splitTerminalMode('both'), ['start', 'end']);
  assert.deepEqual(splitTerminalMode('start'), ['start', 'none']);
  assert.deepEqual(splitTerminalMode('end'), ['none', 'end']);
  for (const [mode, coords] of [['none', []], ['start', [0]], ['end', [100]], ['both', [0, 100]]]) {
    const marks = terminalPrimitives(mode, a, b);
    assert.deepEqual(marks.map(m => m.cx), coords);
    assert.ok(marks.every(m => m.fill === '#ffffff' && m.rx === 6));
  }
});

test('自動白丸は位置ではなく端の接続参照だけで決まり、分岐しても自動設定を保つ', async () => {
  const { terminalPrimitives, splitTerminalMode } = await import('../js/diagram/terminal-marks.mjs');
  const a = { x: 100, y: 100 }, b = { x: 200, y: 100 }, marks = (from, to) => terminalPrimitives('auto', a, b, 1.5, [from, to]).map(m => m.cx);
  assert.deepEqual(marks({ x: 100, y: 100 }, { x: 200, y: 100 }), [100, 200]);
  assert.deepEqual(marks({ id: 1, pin: 'a' }, { x: 200, y: 100 }), [200]);
  assert.deepEqual(marks({ id: 2 }, { id: 1, pin: 'a' }), []);
  assert.deepEqual(marks({ x: 100, y: 100 }, { id: 2 }), [100]);
  assert.deepEqual(splitTerminalMode('auto'), ['auto', 'auto']);
  assert.deepEqual(terminalPrimitives(undefined, a, b, 1.5, [a, b]), []);
  assert.deepEqual(terminalPrimitives('start', a, b, 1.5, [{ id: 1 }, b]).map(m => m.cx), [100]);
});

test('自由端は同じ座標でも別の端として保持し、白丸は接続を変更しない', async () => {
  const a = { components: [], junctions: [], wires: [
    wire('one', { x: 100, y: 100 }, { x: 200, y: 100 }),
    wire('two', { x: 200, y: 100 }, { x: 300, y: 100 }),
  ] };
  const result = analyzeCircuit(a);
  assert.notEqual(netOf(result, 'free', 'one'), netOf(result, 'free', 'two'));
  const { parseSketch } = await import('../js/diagram/sketch-import.mjs');
  const src = { version: 2, components: [], junctions: [], wires: [
    { id: 'w', from: { x: 100, y: 100 }, to: { x: 200, y: 100 }, points: [], terminalEnds: 'both' },
  ], uncertain: [] };
  const item = parseSketch(JSON.stringify(src)).doc.items[0];
  assert.deepEqual(item.from, { x: 100, y: 100 });
  assert.deepEqual(item.to, { x: 200, y: 100 });
  assert.equal(item.terminalEnds, 'both');
  src.wires[0].terminalEnds = 'incorrect';
  assert.throws(() => parseSketch(JSON.stringify(src)));
});

test('端子の近くの自由端と、端子からの開放配線は別々の接続のまま', async () => {
  const data = { components: [component('r', 'resistor', 300, 200)], junctions: [], wires: [
    wire('open', pin('r', 'b'), { x: 500, y: 200 }),
    wire('near', { x: 100, y: 200 }, { x: 220, y: 200 }),
  ] };
  const result = analyzeCircuit(data);
  assert.ok(netOf(result, 'pin', 'r', 'b').some(v => v[0] === 'free' && v[1] === 'open'));
  assert.notEqual(netOf(result, 'pin', 'r', 'a'), netOf(result, 'free', 'near'));
  const { parseSketch } = await import('../js/diagram/sketch-import.mjs');
  const sketch = { version: 2, ...data, components: [{ ...data.components[0], name: 'R', value: '' }], uncertain: [] };
  const doc = parseSketch(JSON.stringify(sketch)).doc;
  const wires = doc.items.filter(x => x.circuitWire);
  assert.ok(wires.every(w => w.terminalEnds === 'auto'));
  assert.deepEqual(wires[0].from, { id: 1, pin: 'b' });
  assert.deepEqual(wires[0].to, { x: 500, y: 200 });
  assert.deepEqual(wires[1].to, { x: 220, y: 200 });
});

test('可変抵抗と白丸の指定を回路取込で保持し、3端子にはしない', async () => {
  const { parseSketch, SKETCH_PROMPT } = await import('../js/diagram/sketch-import.mjs');
  const src = { version: 2, components: [{ id: 'r', type: 'variable_resistor', x: 200, y: 200, rotation: 90, name: 'VR1', value: '10k' }],
    junctions: [], wires: [{ id: 'w', from: { component: 'r', pin: 'b' }, to: { x: 200, y: 400 }, points: [], terminalEnds: 'end' }], uncertain: [] };
  const doc = parseSketch(JSON.stringify(src)).doc;
  assert.equal(doc.items[0].kind, 'variable_resistor');
  assert.deepEqual(doc.items[1].from, { id: 1, pin: 'b' });
  assert.equal(doc.items[1].terminalEnds, 'end');
  const bad = structuredClone(src); bad.wires[0].from.pin = 'wiper';
  assert.throws(() => parseSketch(JSON.stringify(bad)));
  assert.match(SKETCH_PROMPT, /terminalEnds/);
  assert.match(SKETCH_PROMPT, /3端子のポテンショメータは未対応/);
});
