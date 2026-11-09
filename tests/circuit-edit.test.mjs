import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCircuitEnds, circuitEditHandles } from '../js/diagram/circuit-edit.mjs';
import { circuitPins, circuitRouteConflict, circuitPathCrossesBody } from '../js/diagram/circuit-model.mjs';
const part=(kind,rotation=0)=>({id:1,type:'circuit',kind,x:340,y:340,w:120,h:120,rotation});
const wire=(point)=>({id:2,type:'edge',circuitWire:true,from:{x:80,y:200},to:point,points:[],terminalEnds:'auto'});
test('新しく置いたN/P MOSFETは全方向のG/D/Sに自由端を接続する',()=>{
  for(const kind of ['nmos','pmos']) for(const rotation of [0,90,180,270]) {
    const c=part(kind,rotation),pins=circuitPins({...c,type:kind,x:400,y:400});
    for(const [pin,p] of Object.entries(pins)) {
      const e=wire({...p}),old=structuredClone(e);
      attachCircuitEnds([c,e],[old]);
      assert.deepEqual(e.to,{id:1,pin});assert.deepEqual(e.from,old.from);
    }
  }
});
test('移動した部品と伸縮した配線のどちらからでも接続できる',()=>{
  const c=part('nmos'),p={x:420,y:340},e=wire(p);
  attachCircuitEnds([c,e],[{...c,y:500},structuredClone(e)]);
  assert.deepEqual(e.to,{id:1,pin:'drain'});
  const e2=wire(p);attachCircuitEnds([c,e2],[structuredClone(c),wire({x:420,y:300})]);
  assert.deepEqual(e2.to,{id:1,pin:'drain'});
});
test('無関係な変更・近いだけの端子・重複端子・通常の線は自動接続しない',()=>{
  const c=part('nmos');
  for(const [items,previous] of [
    [[c,wire({x:420,y:340})],[c,wire({x:420,y:340})]],
    [[c,wire({x:420,y:339})],[]],
    [[c,{...c,id:3},wire({x:420,y:340})],[]],
    [[c,{...wire({x:420,y:340}),circuitWire:false}],[]],
  ]) { const doc=structuredClone(items);attachCircuitEnds(doc,previous);assert.equal(doc.at(-1).to.id,undefined); }
});
test('接続後は端子と配線の重なりが衝突にならず、部品を貫く経路は依然として拒否する',()=>{
  const c=part('nmos'),e=wire({x:420,y:340});e.from={x:420,y:180};
  attachCircuitEnds([c,e],[]);
  const pins=Object.entries(circuitPins({...c,type:c.kind,x:400,y:400})).map(([pin,p])=>({...p,id:1,pin}));
  const pts=[e.from,pins.find(p=>p.pin==='drain')];
  assert.equal(circuitRouteConflict(pts,[e.from,e.to],[],pins),false);
  assert.equal(circuitPathCrossesBody(pts,c),false);
  assert.equal(circuitPathCrossesBody([{x:420,y:500},pts[1]],c),true);
});
test('回路配線に始点と終点の編集用の丸を出す',()=>{
  assert.deepEqual(circuitEditHandles([{k:'start'},{k:'wp'},{k:'end'},{k:'mid'}]),[{k:'start'},{k:'end'}]);
});
