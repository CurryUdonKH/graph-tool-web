import test from 'node:test';
import assert from 'node:assert/strict';
import { tidySketch } from '../js/diagram/sketch-tidy.mjs';
const state = (id,x,y,w=160,h=80,text=`状態${id}`,fontSize=22) => ({id,type:'ellipse',x,y,w,h,text,fontSize,lw:1.5,fill:'#ffffff'});
const edge = (id,from,to) => ({id,type:'edge',style:'curve',from:{id:from,ang:0},to:{id:to,ang:Math.PI},c1:{dx:30,dy:-40},c2:{dx:-30,dy:-40},arrow:'end',label:'遷移',wire:false});
const doc = items => ({grid:20,W:1600,H:1000,items,nextId:20});

test('接続された同じ行の状態を揃え、元データと曲線・向きを保持', () => {
  const original=doc([state(1,100,100,160,80,'状態A',22),state(2,400,105,170,84,'状態B',24),edge(3,1,2)]);
  const snapshot=structuredClone(original), result=tidySketch(original), [a,b,e]=result.doc.items;
  assert.deepEqual(original,snapshot); assert.equal(a.w,b.w); assert.equal(a.h,b.h); assert.equal(a.fontSize,b.fontSize);
  assert.equal(a.y+a.h/2,b.y+b.h/2); assert.deepEqual(e,original.items[2]);
  assert.deepEqual(tidySketch(original),result); assert.match(result.changes[0],/状態A、状態B/);
  assert.deepEqual(tidySketch(snapshot).doc,result.doc);
});

test('長い文字は読みやすく収まる範囲で整え、異種図形と自由端は保つ', () => {
  const long=doc([state(1,100,100,160,80,'長いラベルの状態名です'),state(2,400,105),edge(3,1,2)]);
  const adjusted=tidySketch(long).doc; assert.ok(adjusted.items[0].fontSize >= 8); assert.ok(adjusted.items[0].fontSize < 22); assert.equal(adjusted.items[0].text,long.items[0].text);
  const tooLong=doc([state(1,100,100,160,80,'あ'.repeat(100)),state(2,400,105),edge(3,1,2)]); assert.deepEqual(tidySketch(tooLong).doc,tooLong);
  const mixed=doc([state(1,100,100),{...state(2,400,105),type:'rect'},edge(3,1,2)]);
  assert.deepEqual(tidySketch(mixed).doc,mixed);
  const free=doc([state(1,100,100),state(2,400,105),{...edge(3,1,2),to:{x:400,y:140}}]);
  assert.deepEqual(tidySketch(free).doc,free);
});

test('別の段の上下関係を残し、その間をつなぐ曲線も保つ', () => {
  const original=doc([state(1,100,100),state(2,400,105),state(3,100,400),state(4,400,405),edge(5,1,2),edge(6,3,4),edge(7,2,3)]);
  const clean=tidySketch(original).doc;
  assert.equal(clean.items[0].y+clean.items[0].h/2,clean.items[1].y+clean.items[1].h/2);
  assert.equal(clean.items[2].y+clean.items[2].h/2,clean.items[3].y+clean.items[3].h/2);
  assert.ok(clean.items[2].y>clean.items[0].y+clean.items[0].h);
  assert.deepEqual(clean.items.slice(4),original.items.slice(4));
});

test('3 個の間隔を整えるが、別の段や未接続の図形は移動しない', () => {
  const original=doc([state(1,100,100),state(2,330,103),state(3,650,101),edge(4,1,2),edge(5,2,3)]);
  const clean=tidySketch(original).doc;
  const centers=clean.items.slice(0,3).map(n=>n.x+n.w/2);
  assert.equal(centers[1]-centers[0],centers[2]-centers[1]);
  const disconnected=doc([state(1,100,100),state(2,330,103),state(3,650,101),edge(4,1,2)]);
  assert.deepEqual(tidySketch(disconnected).doc,disconnected);
});

test('大きさが異なる状態を揃え、重なる図形は変更しない', () => {
  const sizes=doc([state(1,100,100,160,80),state(2,400,100,300,80),edge(3,1,2)]);
  assert.equal(tidySketch(sizes).doc.items[0].w,tidySketch(sizes).doc.items[1].w);
  const overlap=doc([state(1,100,100),state(2,180,103),edge(3,1,2)]);
  assert.deepEqual(tidySketch(overlap).doc,overlap);
});

const box = (id,x,y,w,h,text='') => ({id,type:'rect',x,y,w,h,text,fontSize:18,lw:1.5,fill:'#fff'});
test('単一の入れ子を中央へ寄せ、内外の寸法と外側への接続を保つ', () => {
  const outer=box(1,195,230,610,380),inner=box(2,370,345,275,195),other=state(3,1380,275,295,285,'',22);
  const wire={id:4,type:'edge',style:'straight',from:{id:1,ax:1,ay:.5},to:{id:3,ang:Math.PI},arrow:'end',label:'',wire:false};
  const source=doc([outer,inner,other,wire]), copy=structuredClone(source), result=tidySketch(source);
  const [a,b,c,e]=result.doc.items;
  assert.deepEqual(source,copy); assert.equal(b.x+b.w/2,a.x+a.w/2); assert.equal(b.y+b.h/2,a.y+a.h/2);
  assert.equal(b.w,275); assert.equal(b.h,195); assert.deepEqual(a,outer); assert.deepEqual(c,other); assert.deepEqual(e,wire);
  assert.match(result.changes.join(' '),/内の/);
  assert.deepEqual(tidySketch(source,{nested:false}).doc,source);
});
test('複数内包、端の文字、子への接続、交差線は入れ子を動かさない', () => {
  const outer=box(1,100,100,400,300),inner=box(2,210,180,170,120);
  const multi=doc([outer,inner,box(3,115,115,40,40)]); assert.deepEqual(tidySketch(multi).doc,multi);
  const label=doc([outer,inner,{id:3,type:'text',x:470,y:120,w:40,h:30,text:'端の文字',fontSize:15}]); assert.deepEqual(tidySketch(label).doc,label);
  const childEdge=doc([outer,inner,state(3,700,100),edge(4,2,3)]); assert.deepEqual(tidySketch(childEdge).doc,childEdge);
  const cross=doc([outer,inner,{id:4,type:'edge',style:'straight',from:{x:0,y:230},to:{x:700,y:230},arrow:'end',label:'',wire:false}]); assert.deepEqual(tidySketch(cross).doc,cross);
});
test('四角と注釈の同列・同段を別々に整え、異種は混ぜない', () => {
  const a=box(1,100,100,160,80),b=box(2,400,105,165,82),c={...box(3,100,400,160,80),type:'note'},d={...box(4,103,650,165,82),type:'note'};
  const e1={...edge(5,1,2),style:'straight',from:{id:1,ax:1,ay:.5},to:{id:2,ax:0,ay:.5}},e2={...edge(6,3,4),style:'straight',from:{id:3,ax:.5,ay:1},to:{id:4,ax:.5,ay:0}};
  const result=tidySketch(doc([a,b,c,d,e1,e2])).doc.items;
  assert.equal(result[0].y+result[0].h/2,result[1].y+result[1].h/2);
  assert.equal(result[2].x+result[2].w/2,result[3].x+result[3].w/2);
  assert.deepEqual(result.slice(4),[e1,e2]);
});
test('同じ高さの孤立曲線だけを選択的に左右対称化', () => {
  const a=state(1,100,100),b=state(2,400,100);
  const e={...edge(3,1,2),label:'',c1:{dx:30,dy:-100},c2:{dx:-70,dy:-60}};
  const source=doc([a,b,e]);
  assert.deepEqual(tidySketch(source,{align:false,nested:false}).doc,source);
  const clean=tidySketch(source,{align:false,nested:false,symmetric:true}).doc.items[2];
  assert.equal(clean.c1.dx,-clean.c2.dx); assert.equal(clean.c1.dy,clean.c2.dy); assert.equal(clean.arrow,'end');
  assert.deepEqual(source.items[2],e);
  const obstacle=doc([a,b,e,{...box(4,290,30,30,120)}]); assert.deepEqual(tidySketch(obstacle,{align:false,nested:false,symmetric:true}).doc,obstacle);
  const labelled=doc([a,b,{...e,label:'遷移'}]); assert.deepEqual(tidySketch(labelled,{align:false,nested:false,symmetric:true}).doc,labelled);
  const unequal=doc([a,{...b,y:130},e]); assert.deepEqual(tidySketch(unequal,{align:false,nested:false,symmetric:true}).doc,unequal);
  const more=doc([a,b,e,state(4,700,100),edge(5,2,4)]); assert.deepEqual(tidySketch(more,{align:false,nested:false,symmetric:true}).doc,more);
  const wrongSide=doc([a,b,{...e,from:{id:1,ang:Math.PI},to:{id:2,ang:0}}]); assert.deepEqual(tidySketch(wrongSide,{align:false,nested:false,symmetric:true}).doc,wrongSide);
});


test('数値を含むデータ図や独立した文字がある図は形を変えない', () => {
  const chart=doc([state(1,100,100,160,80,'12.5'),state(2,400,105,170,84,'20'),edge(3,1,2)]);
  assert.deepEqual(tidySketch(chart,{symmetric:true}).doc,chart);
  const axes=doc([state(1,100,100),state(2,400,105),edge(3,1,2),{id:4,type:'text',x:0,y:0,w:20,h:20,text:'x',fontSize:10}]);
  assert.deepEqual(tidySketch(axes).doc,axes);
});

test('近い高さの曲線は端点を揃え、接続先・向き・ラベルを保って対称化', () => {
  const a=state(1,100,100,160,80,'状態A'),b=state(2,400,108,160,80,'状態B');
  const e={...edge(3,1,2),label:'',c1:{dx:30,dy:-100},c2:{dx:-70,dy:-60}};
  const source=doc([a,b,e]), before=structuredClone(source), clean=tidySketch(source,{align:false,nested:false,symmetric:true}).doc.items[2];
  assert.deepEqual(source,before); assert.equal(clean.from.id,1); assert.equal(clean.to.id,2); assert.equal(clean.arrow,'end'); assert.equal(clean.label,'');
  const y1=a.y+a.h/2+Math.sin(clean.from.ang)*a.h/2, y2=b.y+b.h/2+Math.sin(clean.to.ang)*b.h/2;
  assert.ok(Math.abs(y1-y2)<1e-9); assert.ok(Math.abs(clean.c1.dx+clean.c2.dx)<1e-9); assert.ok(Math.abs(clean.c1.dy-clean.c2.dy)<1e-9);
});
