import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSketch} from '../js/diagram/sketch-import.mjs';
import {tidySketch} from '../js/diagram/sketch-tidy.mjs';
import {gridSketch} from '../js/diagram/sketch-grid.mjs';
const stateData=()=>({version:1,nodes:[{id:'a',type:'ellipse',x:80,y:275,w:720,h:335,text:'状態A',fontSize:130},{id:'b',type:'ellipse',x:1110,y:250,w:615,h:320,text:'状態B',fontSize:125}],edges:[{id:'e',from:{node:'a',angle:-24},to:{node:'b',angle:-155},style:'curve',control1:{x:935,y:175},control2:{x:1020,y:215},arrow:'end',label:''}],uncertain:[]});
const nestedData=()=>({version:1,nodes:[{id:'outer',type:'rect',x:195,y:230,w:610,h:380,text:''},{id:'inner',type:'rect',x:370,y:345,w:275,h:195,text:''},{id:'circle',type:'ellipse',x:1380,y:275,w:295,h:285,text:''}],edges:[{id:'e',from:{node:'outer',side:'right'},to:{node:'circle',side:'left'},arrow:'end',label:''}],uncertain:[]});
const anchor=(n,e)=>e.ang!=null?{x:n.x+n.w*(1+Math.cos(e.ang))/2,y:n.y+n.h*(1+Math.sin(e.ang))/2}:{x:n.x+n.w*e.ax,y:n.y+n.h*e.ay};
const grid=x=>Math.abs(x/20-Math.round(x/20))<1e-7;
const checkNodes=doc=>doc.items.filter(i=>i.type!=='edge').forEach(n=>['x','y','w','h'].forEach(k=>assert.ok(grid(n[k]),`${k}=${n[k]}`)));

test('原画を最小限グリッドに合わせ、参照と曲線の制御点を保持',()=>{
  const raw=JSON.stringify(stateData()),source=parseSketch(raw).doc,copy=structuredClone(source), result=gridSketch(source);
  checkNodes(result); assert.deepEqual(source,copy); const [a,b,e]=result.items;
  assert.equal(e.from.id,1); assert.equal(e.to.id,2); assert.equal(e.arrow,'end');
  const p=anchor(a,e.from),q=anchor(b,e.to);
  for(const n of [p.x+e.c1.dx,p.y+e.c1.dy,q.x+e.c2.dx,q.y+e.c2.dy]) assert.ok(grid(n),String(n));
  assert.ok(Math.abs(((p.x-a.x-a.w/2)/(a.w/2))**2+((p.y-a.y-a.h/2)/(a.h/2))**2-1)<1e-9);
  assert.deepEqual(gridSketch(source),result);
});
test('清書後もグリッド上の大きさと同じ高さ、左右対称を維持',()=>{
  const raw=parseSketch(JSON.stringify(stateData())).doc,p=tidySketch(raw,{symmetric:true}),doc=gridSketch(p.doc,p.constraints),[a,b,e]=doc.items;
  checkNodes(doc); assert.equal(a.w,b.w); assert.equal(a.h,b.h); assert.equal(a.y,b.y);
  const p1=anchor(a,e.from),p2=anchor(b,e.to),c1={x:p1.x+e.c1.dx,y:p1.y+e.c1.dy},c2={x:p2.x+e.c2.dx,y:p2.y+e.c2.dy};
  assert.ok(Math.abs(p1.y-p2.y)<1e-7); assert.ok(Math.abs(c1.x+c2.x-p1.x-p2.x)<1e-7); assert.ok(Math.abs(c1.y-c2.y)<1e-7);
  for(const x of [c1.x,c1.y,c2.x,c2.y]) assert.ok(grid(x));
  assert.deepEqual(gridSketch(p.doc,p.constraints),doc);
});
test('入れ子は両モードで保ち、清書では中心も一致',()=>{
  const raw=parseSketch(JSON.stringify(nestedData())).doc,origin=gridSketch(raw),p=tidySketch(raw),clean=gridSketch(p.doc,p.constraints);
  for(const d of [origin,clean]){checkNodes(d); const [a,b,c,e]=d.items; assert.ok(b.x>a.x&&b.y>a.y&&b.x+b.w<a.x+a.w&&b.y+b.h<a.y+a.h); assert.equal(e.from.id,a.id);assert.equal(e.to.id,c.id);}
  const [a,b,c,e]=clean.items; assert.equal(a.x+a.w/2,b.x+b.w/2); assert.equal(a.y+a.h/2,b.y+b.h/2);
  assert.ok(Math.abs(anchor(a,e.from).y-anchor(c,e.to).y)<1e-7);
});
test('自由端はグリッドに揃え、重なりや消える線を拒否',()=>{
  const raw={grid:20,W:1600,H:1000,items:[{id:1,type:'edge',style:'straight',from:{x:107,y:93},to:{x:163,y:117},arrow:'end'}]};
  const e=gridSketch(raw).items[0];assert.deepEqual(e.from,{x:100,y:100});assert.deepEqual(e.to,{x:160,y:120});
  raw.items[0].to={x:109,y:94};assert.throws(()=>gridSketch(raw),/同じ位置/);
});
test('３図形の清書では同じ行と等間隔を維持',()=>{
  const raw={grid:20,W:1600,H:1000,items:[
    {id:1,type:'rect',x:101,y:101,w:151,h:77,text:'',fontSize:18},{id:2,type:'rect',x:339,y:108,w:160,h:81,text:'',fontSize:18},{id:3,type:'rect',x:669,y:102,w:162,h:79,text:'',fontSize:18},
    {id:4,type:'edge',style:'straight',from:{id:1,ax:1,ay:.5},to:{id:2,ax:0,ay:.5},arrow:'end',label:'',wire:false},
    {id:5,type:'edge',style:'straight',from:{id:2,ax:1,ay:.5},to:{id:3,ax:0,ay:.5},arrow:'end',label:'',wire:false}]};
  const p=tidySketch(raw),d=gridSketch(p.doc,p.constraints),[a,b,c]=d.items;checkNodes(d);assert.equal(a.y,b.y);assert.equal(b.y,c.y);assert.equal(b.x-a.x,c.x-b.x);
});

test('グリッドで新たな重なりが発生する場合は拒否する',()=>{
  const a={id:1,type:'rect',x:110,y:100,w:31,h:40,text:'',fontSize:18};
  const b={id:2,type:'rect',x:142,y:100,w:31,h:40,text:'',fontSize:18};
  const raw={grid:20,W:1600,H:1000,items:[a,b]};
  assert.throws(()=>gridSketch(raw),/重なり/);
});
