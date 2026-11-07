import test from 'node:test';
import assert from 'node:assert/strict';
import {paintOrder,reorderedItems} from '../js/diagram/stacking.mjs';
const circle={id:1,type:'ellipse',x:20,y:20,w:20,h:20,fill:'#fff'};
const line={id:2,type:'edge',x:30,y:0,w:0,h:70};
const other={id:3,type:'rect',x:100,y:100,w:20,h:20};
const ids=items=>items.map(i=>i.id);

test('既存図は明示的に並べ替えるまで従来の図形・線の順番を保つ',()=>{
 const doc={items:[line,circle,other]},copy=structuredClone(doc);
 assert.deepEqual(ids(paintOrder(doc)),[1,3,2]);
 assert.deepEqual(doc,copy);
});
test('最前面の白丸が交差する直線を覆い、保存後も順番を保持する',()=>{
 const doc={items:[circle,line,other]};
 const items=reorderedItems(doc,[1],'front',i=>i);
 assert.deepEqual(ids(items),[3,2,1]);
 const saved=JSON.parse(JSON.stringify({...doc,items,itemStack:1}));
 assert.deepEqual(ids(paintOrder(saved)),[3,2,1]);
 assert.deepEqual(ids(reorderedItems(saved,[1],'back',i=>i)),[1,3,2]);
 assert.deepEqual(ids(paintOrder(doc)),[1,3,2]);
});
test('1つ前・後は離れた図形を飛ばして、幅ゼロの直線も越える',()=>{
 const doc={items:[circle,other,line],itemStack:1};
 const items=reorderedItems(doc,[1],'up',i=>i);
 assert.deepEqual(ids(items),[3,2,1]);
 assert.deepEqual(ids(reorderedItems({...doc,items},[1],'down',i=>i)),[3,1,2]);
});
test('図形と線の複数選択は互いの順序と接続情報を保つ',()=>{
 const edge={...line,from:{id:1},to:{x:30,y:70}};
 const doc={items:[circle,edge,other],itemStack:1},copy=structuredClone(doc);
 assert.deepEqual(ids(reorderedItems(doc,[1,2],'front',i=>i)),[3,1,2]);
 assert.deepEqual(doc,copy);
});
