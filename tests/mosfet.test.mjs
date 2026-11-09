import test from 'node:test';
import assert from 'node:assert/strict';
import { circuitPins, circuitPrimitives, CIRCUIT_TYPES, analyzeCircuit, circuitPathCrossesBody } from '../js/diagram/circuit-model.mjs';
import { parseSketch } from '../js/diagram/sketch-import.mjs';
const base = type => ({id:'q',type,x:400,y:400,rotation:0,name:'Q1',value:''});
const rotate = (x,y,r) => r===0?[x,y]:r===90?[-y,x]:r===180?[-x,-y]:[y,-x];

test('N/Pチャネルの3端子はグリッドに乗り、回転後も端子の意味を保持する',()=>{
  for(const type of ['nmos','pmos']) for(const rotation of [0,90,180,270]) {
    const pins=circuitPins({...base(type),rotation});
    const d=type==='nmos'?-60:60;
    assert.deepEqual(Object.keys(pins),['gate','drain','source']);
    for(const [pin,x,y] of [['gate',-60,0],['drain',20,d],['source',20,-d]]) {
      const [rx,ry]=rotate(x,y,rotation);
      assert.deepEqual(pins[pin],{x:400+rx,y:400+ry});
      assert.equal(pins[pin].x%20,0);assert.equal(pins[pin].y%20,0);
    }
    const spec=CIRCUIT_TYPES[type];
    assert.equal(spec.width,120);assert.equal(spec.height,120);
  }
});
test('全ての接続端子に記号の線が届き、Pチャネルだけゲートに白丸を持つ',()=>{
  for(const type of ['nmos','pmos']) for(const rotation of [0,90,180,270]) {
    const c={...base(type),rotation},prims=circuitPrimitives(c);
    const verts=prims.filter(p=>p.k==='path').flatMap(p=>p.cmds.map(v=>({x:v[1],y:v[2]})));
    for(const pin of Object.values(circuitPins(c))) assert.ok(verts.some(v=>v.x===pin.x&&v.y===pin.y));
    assert.equal(prims.filter(p=>p.k==='ellipse').length,type==='pmos'?1:0);
    assert.ok(prims.filter(p=>p.k!=='text').every(p=>p.lw===1.5));
    assert.deepEqual(prims.filter(p=>p.k==='text').map(p=>p.s).sort(),['D','G','Q1','S']);
    assert.deepEqual(circuitPrimitives({...c,pinLabels:false}).filter(p=>p.k==='text').map(p=>p.s),['Q1']);
  }
});
test('MOSFETの3端子配線を別々に保ち、全方向の取り込みと保存に対応する',()=>{
  for(const type of ['nmos','pmos']) for(const rotation of [0,90,180,270]) {
    const c={...base(type),rotation,pinLabels:false},pins=circuitPins(c),body={x:340,y:340,w:120,h:120};
    const wires=Object.entries(pins).map(([pin,p],i)=>{
      const dx=p.x-400,dy=p.y-400;
      const to=Math.abs(dx)>Math.abs(dy)?{x:p.x+Math.sign(dx)*80,y:p.y}:{x:p.x,y:p.y+Math.sign(dy)*80};
      assert.equal(circuitPathCrossesBody([p,to],body),false);
      return {id:'w'+i,from:{component:'q',pin},to,points:[]};
    });
    const input={version:2,components:[c],junctions:[],wires,uncertain:[]};
    assert.equal(analyzeCircuit(input).nets.length,3);
    const doc=parseSketch(JSON.stringify(input)).doc;
    assert.equal(doc.items[0].kind,type);assert.equal(doc.items[0].pinLabels,false);
    assert.deepEqual(doc.items.filter(i=>i.circuitWire).map(i=>i.from.pin),['gate','drain','source']);
    assert.deepEqual(JSON.parse(JSON.stringify(doc)),doc);
    const bad=structuredClone(input);bad.wires[0].from.pin='bulk';
    assert.throws(()=>parseSketch(JSON.stringify(bad)));
  }
});

test('スイッチの開閉は端子と配線を変えず、記号と保存状態だけを切り替える',()=>{
  for(const rotation of [0,90,180,270]) {
    const c={...base('switch'),rotation};
    assert.deepEqual(circuitPins({...c,closed:false}),circuitPins({...c,closed:true}));
    const open=circuitPrimitives({...c,closed:false}),closed=circuitPrimitives({...c,closed:true});
    assert.notDeepEqual(open,closed);
    assert.equal(open.filter(p=>p.k==='ellipse').length,2);
    assert.ok(open.filter(p=>p.k!=='text').every(p=>p.lw===1.5));
    for(const state of [false,true]) {
      const src={version:2,components:[{...c,closed:state}],junctions:[],wires:[],uncertain:[]};
      const doc=parseSketch(JSON.stringify(src)).doc;
      assert.equal(doc.items[0].closed,state);assert.equal(doc.items[0].rotation,rotation);
    }
  }
  const bad={version:2,components:[{...base('switch'),closed:'yes'}],junctions:[],wires:[],uncertain:[]};
  assert.throws(()=>parseSketch(JSON.stringify(bad)));
});
test('回転後の3端子とスイッチに外側から接続する経路を作れる',async()=>{
  const {circuitRouteCandidates,circuitRouteConflict}=await import('../js/diagram/circuit-model.mjs');
  for(const type of ['nmos','pmos','switch']) for(const rotation of [0,90,180,270]) {
    const c={...base(type),rotation},pins=circuitPins(c),original=circuitPins(base(type));
    const spec=CIRCUIT_TYPES[type], w=rotation%180?spec.height:spec.width,h=rotation%180?spec.width:spec.height;
    const bodies=[{x:400-w/2,y:400-h/2,w,h}],routed=[];
    const nodes=Object.entries(pins).map(([pin,p])=>({...p,id:1,pin}));
    for(const [pin,start] of Object.entries(pins)) {
      const d={x:start.x-400,y:start.y-400},o=original[pin];
      const dir=Math.abs(d.x)>Math.abs(d.y)?{x:Math.sign(d.x),y:0}:{x:0,y:Math.sign(d.y)};
      const od={x:o.x-400,y:o.y-400};
      const end=Math.abs(od.x)>Math.abs(od.y)?{x:o.x+Math.sign(od.x)*100,y:o.y}:{x:o.x,y:o.y+Math.sign(od.y)*100};
      const ends=[{id:1,pin},end];
      const route=circuitRouteCandidates(start,end,dir,null,bodies).find(points=>!circuitRouteConflict(points,ends,routed,nodes));
      assert.ok(route,`${type} ${rotation} ${pin}`);
      assert.deepEqual(route[0],start);assert.deepEqual(route.at(-1),end);
      assert.ok(route.slice(1).every((p,i)=>(p.x===route[i].x)!==(p.y===route[i].y)));
      routed.push({points:route,ends});
    }
  }
});
