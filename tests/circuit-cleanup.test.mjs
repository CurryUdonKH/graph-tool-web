import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupCircuitJunctions } from '../js/diagram/circuit-cleanup.mjs';
const dot = (id=1,x=200,y=200) => ({id,type:'circuit-junction',x:x-5,y:y-5,w:10,h:10});
const wire = (id,from,to,props={}) => ({id,type:'edge',circuitWire:true,from,to,points:[],lw:1.5,terminalEnds:'auto',label:'',...props});
function clean(items, affected) {
  return cleanupCircuitJunctions(items, r => r.id == null ? r : (()=>{const d=items.find(i=>i.id===r.id);return {x:d.x+d.w/2,y:d.y+d.h/2};})(), affected);
}
test('枝を消した後、左右どちら向きの配線も1本につながり白丸の指定を保つ',()=>{
  for(const reverseA of [false,true]) for(const reverseB of [false,true]) {
    const left={x:80,y:200},right={x:320,y:200},j={id:1};
    const a=wire(2,...(reverseA?[j,left]:[left,j]),{terminalEnds:reverseA?'end':'start'});
    const b=wire(3,...(reverseB?[right,j]:[j,right]),{terminalEnds:reverseB?'start':'end'});
    const out=clean([dot(),a,b],new Set([1]));
    assert.equal(out.length,1);assert.deepEqual(out[0].from,left);assert.deepEqual(out[0].to,right);
    assert.deepEqual(out[0].points,[]);assert.equal(out[0].terminalEnds,'both');
  }
});
test('折れ線と部品端子への接続を保って黒点を消す',()=>{
  const part={id:9,type:'circuit',x:395,y:195,w:10,h:10};
  const out=clean([dot(),part,wire(2,{x:80,y:120},{id:1},{points:[{x:80,y:200}]}),wire(3,{id:1},{id:9,pin:'gate'},{points:[{x:200,y:280},{x:400,y:280}]})],new Set([1]));
  const e=out.find(i=>i.circuitWire);
  assert.equal(out.length,2);assert.deepEqual(e.to,{id:9,pin:'gate'});
  assert.deepEqual(e.points,[{x:80,y:200},{x:200,y:200},{x:200,y:280},{x:400,y:280}]);
  assert.equal(e.terminalEnds,'auto');
});
test('残り1本は自由端にし、0本の接続点も削除するが他の黒点は残す',()=>{
  const untouched=dot(10,500,500),point={id:11,type:'point',x:0,y:0,w:6,h:6};
  const out=clean([dot(),untouched,point,wire(2,{id:1},{x:320,y:200})],new Set([1]));
  assert.deepEqual(out.find(i=>i.id===2).from,{x:200,y:200});
  assert.ok(out.includes(untouched));assert.ok(out.includes(point));assert.ok(!out.some(i=>i.id===1));
  assert.deepEqual(clean([dot(),untouched],new Set([1])),[untouched]);
});
test('3本以上の分岐と削除に無関係な点は残す',()=>{
  const items=[dot(),wire(2,{x:80,y:200},{id:1}),wire(3,{id:1},{x:320,y:200}),wire(4,{id:1},{x:200,y:320})];
  assert.equal(clean(items,new Set([1])).length,4);
  assert.equal(clean(items.slice(0,3),new Set([99])).length,3);
});
test('保存済みの不要な接続点も整理し、連続する点をつないで再保存できる',()=>{
  const original=[dot(),dot(10,300,200),wire(2,{x:80,y:200},{id:1}),wire(3,{id:1},{id:10}),wire(4,{id:10},{x:400,y:200}),dot(20,600,400)];
  const restored=JSON.parse(JSON.stringify(original));
  const out=clean(restored);
  assert.equal(out.length,2);assert.deepEqual(out[0].from,{x:80,y:200});assert.deepEqual(out[0].to,{x:400,y:200});
  assert.deepEqual(out[0].points,[]);assert.equal(out[1].id,20);
  assert.deepEqual(JSON.parse(JSON.stringify(out)),out);
  assert.equal(original.length,6);
});
