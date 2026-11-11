import {linregress} from './stats.js';

// 傾きは表示座標（選択した軸だけ常用対数）での最小二乗法で求める。
export function regressSeries(series, {range=null,logX=false,logY=false}={}) {
  const xs=[],ys=[],rawX=[],inside=[];let excluded=0;
  series.xs.forEach((x,i)=>{
    const y=series.ys[i],inRange=!range||(x>=range[0]&&x<=range[1]);
    const valid=Number.isFinite(x)&&Number.isFinite(y)&&(!logX||x>0)&&(!logY||y>0);
    inside.push(inRange&&valid);
    if(!inRange)return;
    if(!valid){excluded++;return;}
    xs.push(logX?Math.log10(x):x);ys.push(logY?Math.log10(y):y);rawX.push(x);
  });
  return {r:xs.length>=3?linregress(xs,ys):null,inside,excluded,x0:Math.min(...rawX),x1:Math.max(...rawX)};
}
export const regressionEquation = (logX,logY) => `${logY?'log₁₀(y)':'y'} = 傾き × ${logX?'log₁₀(x)':'x'} + 切片`;
