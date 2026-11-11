// 入力された数式を、許可した演算と数学関数だけで計算する。
const FUNCTIONS = Object.freeze({sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,
  sinh:Math.sinh,cosh:Math.cosh,tanh:Math.tanh,exp:Math.exp,log:Math.log,ln:Math.log,log10:Math.log10,
  sqrt:Math.sqrt,abs:Math.abs,pow:Math.pow,min:Math.min,max:Math.max});
const CONSTANTS = Object.freeze({pi:Math.PI,e:Math.E});
const own = (o,k) => Object.hasOwn(o,k);

export function parseParameters(text = '') {
  if (text.length > 1000) throw new Error('係数は1000文字以内で入力してください');
  const params = Object.create(null);
  for (const entry of text.normalize('NFKC').split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean)) {
    const match = entry.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/);
    if (!match) throw new Error('係数は a=1, b=2 の形で入力してください');
    const [,name,value] = match;
    if (name === 'x' || own(FUNCTIONS,name) || own(CONSTANTS,name)) throw new Error(`「${name}」は係数名に使えません`);
    if (own(params,name)) throw new Error(`係数「${name}」が重複しています`);
    if (!Number.isFinite(+value)) throw new Error(`係数「${name}」は有限の数値にしてください`);
    params[name] = +value;
  }
  return params;
}

export function compileFormula(input, parameters = '') {
  const source = String(input).normalize('NFKC').replace(/−/g,'-').replace(/×/g,'*').replace(/÷/g,'/').replace(/π/g,'pi').replace(/^\s*y\s*=\s*/i,'').trim();
  if (!source) throw new Error('y = の右側の数式を入力してください');
  if (source.length > 1000) throw new Error('数式は1000文字以内で入力してください');
  const params = parseParameters(parameters), tokens = [];
  const pattern = /\s*(?:(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|([a-zA-Z][a-zA-Z0-9_]*)|(\*\*|[+\-*/^(),]))/y;
  let offset=0;
  while (offset<source.length) {
    pattern.lastIndex=offset; const match=pattern.exec(source);
    if (!match) throw new Error(`「${source[offset]}」は数式に使えません`);
    tokens.push(match[1] ? {type:'number',value:Number(match[1]+(match[2]||''))} : match[3] ? {type:'name',value:match[3]} : {type:match[4]==='**'?'^':match[4]});
    offset=pattern.lastIndex;
    if(tokens.length>256) throw new Error('数式が長すぎます。短く分けてください');
  }
  tokens.push({type:'end'}); let index=0, depth=0;
  const peek=()=>tokens[index].type;
  const take=type=>{if(peek()!==type) throw new Error(`「${type}」の前後を確認してください`);return tokens[index++];};
  function primary() {
    if(++depth>32) throw new Error('かっこの入れ子が多すぎます');
    let fn;
    if(peek()==='number') {const n=take('number').value;fn=()=>n;}
    else if(peek()==='(') {take('(');fn=sum();take(')');}
    else if(peek()==='name') {
      const name=take('name').value;
      if(own(FUNCTIONS,name)) {
        take('(');const args=[sum()];while(peek()===','){take(',');args.push(sum());}take(')');
        if((name==='pow' && args.length!==2) || (!['pow','min','max'].includes(name) && args.length!==1)) throw new Error(`関数「${name}」の引数の数を確認してください`);
        fn=x=>FUNCTIONS[name](...args.map(a=>a(x)));
      } else if(name==='x') fn=x=>x;
      else if(own(CONSTANTS,name)) fn=()=>CONSTANTS[name];
      else if(own(params,name)) fn=()=>params[name];
      else throw new Error(`「${name}」が未定義です。係数なら「${name}=数値」を指定してください`);
    } else throw new Error('数式が途中で終わっているか、演算子の位置が正しくありません');
    depth--; return fn;
  }
  function power(){const a=primary();if(peek()==='^'){take('^');const b=unary();return x=>a(x)**b(x);}return a;}
  function unary(){if(peek()==='+'||peek()==='-'){const sign=tokens[index++].type;const a=unary();return sign==='-'?x=>-a(x):a;}return power();}
  function product(){let a=unary();while(['*','/','number','name','('].includes(peek())){const op=peek();if(op==='*'||op==='/')index++;const b=unary(),left=a;a=op==='/'?x=>left(x)/b(x):x=>left(x)*b(x);}return a;}
  function sum(){let a=product();while(peek()==='+'||peek()==='-'){const op=tokens[index++].type,b=product(),left=a;a=op==='+'?x=>left(x)+b(x):x=>left(x)-b(x);}return a;}
  const fn=sum();if(peek()!=='end')throw new Error('かっこ・カンマ・演算子の位置を確認してください');
  return fn;
}

// 不連続な箇所や定義域外を飛び越して線で結ばない。対数軸は対数間隔で標本化する。
export function sampleFormula(fn, min, max, {xLog=false,yLog=false}={}) {
  if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max)throw new Error('描く範囲の最小値は最大値より小さくしてください');
  if(xLog&&min<=0)throw new Error('対数の横軸では、描く範囲の最小値を0より大きくしてください');
  const lo=xLog?Math.log10(min):min, hi=xLog?Math.log10(max):max;
  const xs=[],ys=[];let calls=0, gaps=false;
  const point=t=>{const x=xLog?10**t:t;const y=++calls>4096?NaN:fn(x);return {t,x,y:Number.isFinite(y)&&(!yLog||y>0)?y:NaN};};
  const append=p=>{xs.push(p.x);ys.push(p.y);if(!Number.isFinite(p.y))gaps=true;};
  function interval(a,b,depth){
    const m=point((a.t+b.t)/2), valid=[a,m,b].every(p=>Number.isFinite(p.y));
    const transform=y=>yLog?Math.log10(y):y;
    const curved=valid&&Math.abs(transform(m.y)-(transform(a.y)+transform(b.y))/2)>.01*(1+Math.abs(transform(a.y))+Math.abs(transform(b.y))+Math.abs(transform(m.y)));
    if((curved||!valid)&&depth<7&&calls<4096&&[a,m,b].some(p=>Number.isFinite(p.y))){interval(a,m,depth+1);interval(m,b,depth+1);}
    else {if(!valid||curved)append({x:m.x,y:NaN});else append(m);append(b);}
  }
  let a=point(lo);append(a);
  for(let i=1;i<=128;i++){const b=point(lo+(hi-lo)*i/128);interval(a,b,0);a=b;}
  return {xs,ys,gaps};
}

export function buildTheorySeries(curves=[], {range=[0,1],xLog=false,yLog=false}={}) {
  const series=[],warns=[];
  for(const curve of curves) {
    if(curve.enabled===false)continue;
    const name=curve.name?.trim()||'理論曲線';
    try {
      const fn=compileFormula(curve.expression,curve.parameters);
      const limits=curve.rangeMode==='manual'?[curve.min===''?NaN:Number(curve.min),curve.max===''?NaN:Number(curve.max)]:range;
      const sampled=sampleFormula(fn,...limits,{xLog,yLog});
      if(!sampled.ys.some(Number.isFinite))throw new Error('この範囲には表示できる値がありません');
      if(sampled.gaps)warns.push(`${name}：計算できない値・不連続な箇所${yLog?'・0以下の値':''}では線を切っています`);
      series.push({kind:'theory',curveId:curve.id,key:`theory:${curve.id}`,x:'x',y:'y',label:name,...sampled,
        color:/^#[0-9a-f]{6}$/i.test(curve.color)?curve.color:'#c75420',marker:null,line:curve.line==='solid'?'solid':'dashed',lw:1.5});
    }catch(e){warns.push(`${name}：${e.message}`);}
  }
  return {series,warns};
}
