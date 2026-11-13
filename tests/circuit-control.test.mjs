import test from 'node:test';
import assert from 'node:assert/strict';
import {circuitPins,circuitPrimitives,analyzeCircuit,CIRCUIT_TYPES} from '../js/diagram/circuit-model.mjs';
import {parseSketch} from '../js/diagram/sketch-import.mjs';
const types=['opamp','optocoupler','resistor_zigzag','voltage_triangle','battery'];
const part=(type,rotation=0)=>({id:type,type,x:400,y:400,rotation,name:'',value:''});
test('制御回路部品の端子が回転後も外周とグリッドに合い、描画の端につながる',()=>{
  for(const type of types) for(const rotation of [0,90,180,270]) {
    const c=part(type,rotation),pins=circuitPins(c),spec=CIRCUIT_TYPES[type];
    const w=rotation%180?spec.height:spec.width,h=rotation%180?spec.width:spec.height;
    const ps=circuitPrimitives(c),ends=ps.filter(p=>p.k==='path').flatMap(p=>p.cmds.filter(cmd=>cmd[0]==='M'||cmd[0]==='L').map(cmd=>cmd.slice(1)));
    for(const p of Object.values(pins)) {
      assert.ok(Math.abs(p.x-c.x)===w/2||Math.abs(p.y-c.y)===h/2);
      assert.equal(p.x%20,0);assert.equal(p.y%20,0);
      assert.ok(ends.some(([x,y])=>x===p.x&&y===p.y));
    }
    assert.ok(ps.every(p=>p.k==='text'||p.lw===1.5));
  }
});
test('反転・非反転・出力とフォトカプラのLED側とトランジスタ側を区別する',()=>{
  assert.deepEqual(circuitPins(part('opamp')), {inverting:{x:320,y:360},noninverting:{x:320,y:440},output:{x:480,y:400}});
  assert.deepEqual(circuitPins(part('optocoupler')), {anode:{x:300,y:360},cathode:{x:300,y:440},collector:{x:500,y:360},emitter:{x:500,y:440}});
  const nets=analyzeCircuit({components:[part('optocoupler')],wires:[],junctions:[]}).nets;
  assert.equal(nets.length,4);
});
test('端子番号の変更・非表示と部品名を描画・取り込み・保存で維持する',()=>{
  const c={...part('opamp'),name:'U1B',pinNumbers:{inverting:'6',noninverting:'5',output:'7'}};
  const labels=circuitPrimitives(c).filter(p=>p.k==='text').map(p=>p.s);
  assert.deepEqual(labels,['U1B','6','5','7']);
  assert.deepEqual(circuitPrimitives({...c,pinLabels:false}).filter(p=>p.k==='text').map(p=>p.s),['U1B']);
  const input={version:2,components:[c,...types.slice(1).map((t,i)=>({...part(t),x:800+i*280}))],wires:[],junctions:[],uncertain:[]};
  const {doc}=parseSketch(JSON.stringify(input));
  assert.deepEqual(doc.items[0].pinNumbers,c.pinNumbers);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)).items,doc.items);
  input.components[0].pinNumbers={unexpected:'1'};assert.throws(()=>parseSketch(JSON.stringify(input)));
});
