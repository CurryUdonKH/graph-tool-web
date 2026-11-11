import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,parseParameters,sampleFormula,buildTheorySeries} from '../js/scatter/theory.mjs';

test('係数・指数・三角関数・演算順位・省略された掛け算を計算する',()=>{
  assert.equal(compileFormula('y = a*exp(-x/b)','a=10,b=2')(0),10);
  assert.ok(Math.abs(compileFormula('sin(pi/2)+log(e)+log10(100)')(0)-4)<1e-12);
  assert.equal(compileFormula('-x^2+2x+3')(2),3);
  assert.equal(compileFormula('2^3^2')(0),512);
  assert.equal(compileFormula('2^-2')(0),.25);
  assert.equal(compileFormula('2(x+1)')(3),8);
  assert.equal(compileFormula('1e-3*x + pow(x,2)')(2),4.002);
  assert.equal(compileFormula('a*x','a=-2e-3')(10),-.02);
  assert.equal(compileFormula('max(2,3)+min(5,6)')(0),8);
});
test('未定義の係数・誤った構文・実行命令を受け付けない',()=>{
  for(const expr of ['x+','sin()','sin(x,2)','a*x','window.alert(1)','x;1','constructor(1)','[1]','x=2','(x']) assert.throws(()=>compileFormula(expr));
  for(const params of ['a=1,a=2','x=1','sin=2','a=Infinity','a=1e999']) assert.throws(()=>parseParameters(params));
  assert.throws(()=>compileFormula('x'.repeat(1001)));
});
test('横軸の対数間隔で曲線を評価し、描く範囲を守る',()=>{
  const s=sampleFormula(compileFormula('10*x'),.1,100,{xLog:true,yLog:true});
  assert.ok(Math.abs(s.xs[0]-.1)<1e-12);assert.equal(s.xs.at(-1),100);
  assert.ok(s.ys.every((y,i)=>Math.abs(y-10*s.xs[i])<1e-8));assert.equal(s.gaps,false);
  assert.throws(()=>sampleFormula(x=>x,0,10,{xLog:true}));
  assert.throws(()=>sampleFormula(x=>x,10,1));
});
test('極と定義域外では線を切り、両側の有効な点は残す',()=>{
  const s=sampleFormula(compileFormula('1/(x-0.12345)'),-1,1);
  assert.ok(s.gaps);assert.ok(s.ys.some(Number.isNaN));assert.ok(s.ys.some(y=>y<0));assert.ok(s.ys.some(y=>y>0));
  const root=sampleFormula(compileFormula('sqrt(x)'),-1,1);assert.ok(root.gaps);assert.ok(root.ys.some(y=>y>0));
  const log=sampleFormula(x=>x,-1,1,{yLog:true});assert.ok(log.gaps);assert.ok(log.ys.filter(Number.isFinite).every(y=>y>0));
});
test('複数の式・範囲・表示切替・エラーと保存復元を扱う',()=>{
  const curves=[{id:'a',name:'理論A',expression:'a*x^2',parameters:'a=2',rangeMode:'manual',min:'0',max:'4',color:'#112233',line:'solid'},
    {id:'b',name:'非表示',expression:'x',enabled:false},{id:'c',name:'誤り',expression:'x+'}];
  const out=buildTheorySeries(curves,{range:[0,10]});assert.equal(out.series.length,1);assert.equal(out.series[0].kind,'theory');assert.equal(out.series[0].label,'理論A');
  assert.equal(out.series[0].xs.at(-1),4);assert.equal(out.series[0].ys.at(-1),32);assert.equal(out.series[0].marker,null);assert.match(out.warns[0],/誤り/);
  assert.deepEqual(buildTheorySeries(JSON.parse(JSON.stringify(curves)),{range:[0,10]}),out);
  assert.match(buildTheorySeries([{expression:'sqrt(-1)',name:'無効'}]).warns[0],/表示できる値/);
});
