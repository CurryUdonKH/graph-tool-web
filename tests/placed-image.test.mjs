import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isEmbeddedImage,imagePrimitive,resizeImage,readPlacedImage} from '../js/diagram/placed-image.mjs';
const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
test('画像は埋め込みPNG・JPEGだけを表示し、外部URLやSVGを実行しない',()=>{
  assert.ok(isEmbeddedImage(src));
  for(const bad of ['https://example.com/x.png','data:image/svg+xml;base64,PHN2Zz4=',src+'" onload="x']) assert.equal(isEmbeddedImage(bad),false);
  assert.equal(imagePrimitive({src,x:0,y:0,w:0,h:20}),null);
  assert.equal(imagePrimitive({src,x:0,y:NaN,w:20,h:20}),null);
});
test('画像の四隅からの拡縮は反対の角と縦横比を保つ',()=>{
  for(const [x,y] of [[100,50],[-100,50],[100,-50],[-100,-50]]) {
    const box=resizeImage({x:0,y:0},{x,y},2);
    assert.equal(box.w/box.h,2);
    assert.equal(x<0 ? box.x+box.w : box.x,0);
    assert.equal(y<0 ? box.y+box.h : box.y,0);
  }
  assert.equal(resizeImage({x:0,y:0},{x:1,y:1},2).h,20);
});
test('壊れたファイルと上限を超えるファイルは配置前にエラーにする',async()=>{
  await assert.rejects(readPlacedImage({size:21*1024*1024}),/20MB/);
  await assert.rejects(readPlacedImage(new Blob(['not an image'])),/PNG/);
});
test('画像だけの図でも余白を含むSVGを作れ、画像を埋め込む',async()=>{
  globalThis.document={createElement:()=>({getContext:()=>({})})};
  const {buildSVG}=await import('../js/export.js');
  const p=imagePrimitive({src,x:100,y:50,w:240,h:120});
  const result=await buildSVG([p]);
  assert.equal(result.w,264); assert.equal(result.h,144);
  assert.ok(result.svg.includes('<image href="'+src+'"'));
  assert.ok(result.svg.includes('viewBox="88 38 264 144"'));
  assert.equal(await buildSVG([{...p,src:'https://example.com/x.png'}]),null);
  const {primsMarkup}=await import('../js/prims.js');
  assert.equal(primsMarkup([{...p,src:'https://example.com/x.png'}]),'');
});
