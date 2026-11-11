import {test} from 'node:test';
import assert from 'node:assert/strict';
import {regressSeries,regressionEquation} from '../js/scatter/regression.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} ≠ ${b}`);
test('通常・片対数・両対数の最小二乗の傾きと切片',()=>{
  let r=regressSeries({xs:[1,2,3,4],ys:[3,5,7,9]}).r;near(r.slope,2);near(r.intercept,1);
  r=regressSeries({xs:[1,10,100],ys:[3,5,7]},{logX:true}).r;near(r.slope,2);near(r.intercept,3);
  r=regressSeries({xs:[0,1,2],ys:[1,10,100]},{logY:true}).r;near(r.slope,1);near(r.intercept,0);
  r=regressSeries({xs:[1,10,100],ys:[2,200,20000]},{logX:true,logY:true}).r;near(r.slope,2);near(r.intercept,Math.log10(2));near(r.r2,1);
});
test('対数で無効な点と回帰範囲外を除き、元の単位で描画範囲を返す',()=>{
  const r=regressSeries({xs:[-1,0,1,10,100,1000],ys:[2,2,2,200,20000,2000000]},{range:[-1,100],logX:true,logY:true});
  assert.equal(r.excluded,2);assert.equal(r.r.n,3);near(r.r.slope,2);assert.deepEqual(r.inside,[false,false,true,true,true,false]);assert.equal(r.x0,1);assert.equal(r.x1,100);
  assert.equal(regressSeries({xs:[0,1,2],ys:[1,10,100]},{logX:true}).r,null);
});
test('結果欄にどの座標の傾きかを明示する',()=>{
  assert.equal(regressionEquation(true,true),'log₁₀(y) = 傾き × log₁₀(x) + 切片');
  assert.equal(regressionEquation(false,true),'log₁₀(y) = 傾き × x + 切片');
});
