// 図の複製にグリッドを適用。接続された端は形状上の参照のまま保持する。
export function gridSketch(source, constraints = null) {
  const cleanMode = constraints !== null;
  constraints ||= {};
  const doc=structuredClone(source), g=doc.grid || 20;
  const nodes=doc.items.filter(i=>i.type!=='edge'), edges=doc.items.filter(i=>i.type==='edge');
  const originals=source.items.filter(i=>i.type!=='edge'), byId=new Map(nodes.map(n=>[n.id,n])), oldById=new Map(originals.map(n=>[n.id,n]));
  const round=x=>Math.round(x/g)*g, dim=x=>Math.max(g,round(x));
  const overlap=(a,b)=>a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h;
  const contains=(a,b)=>a.x<b.x && a.y<b.y && a.x+a.w>b.x+b.w && a.y+a.h>b.y+b.h;
  const inside=(n,p)=>p.x>n.x && p.x<n.x+n.w && p.y>n.y && p.y<n.y+n.h;
  const center=(n,axis)=>axis==='x'?n.x+n.w/2:n.y+n.h/2;
  for (const n of nodes) { n.w=dim(n.w); n.h=dim(n.h); n.x=round(n.x); n.y=round(n.y); }
  // 元の包含関係は大きい箱から小さい箱への制約として記録する。
  const containment=[];
  for (const o of originals) if (o.type==='rect'||o.type==='note') for (const i of originals) if (o!==i && contains(o,i)) containment.push({outer:o.id,inner:i.id});
  containment.sort((a,b)=>oldById.get(a.outer).w*oldById.get(a.outer).h-oldById.get(b.outer).w*oldById.get(b.outer).h);
  const centered=new Set((constraints.centered || []).map(p=>`${p.outer}:${p.inner}`));
  for (const {outer,inner} of containment) {
    const p=byId.get(outer),c=byId.get(inner),po=oldById.get(outer),co=oldById.get(inner),isCentered=centered.has(`${outer}:${inner}`);
    for (const axis of ['x','y']) {
      const size=axis==='x'?'w':'h';
      if (p[size]<c[size]+2*g) p[size]=c[size]+2*g;
      if (isCentered && Math.round((p[size]-c[size])/g)%2!==0) {
        const shrink=c[size]>g ? c[size]-g : null, expand=p[size]+g;
        if (shrink!==null && Math.abs(shrink-co[size])<=Math.abs(expand-po[size])) c[size]=shrink; else p[size]=expand;
      }
      p[axis]=round(center(po,axis)-p[size]/2);
      const min=p[axis]+g,max=p[axis]+p[size]-c[size]-g;
      c[axis]=isCentered ? p[axis]+(p[size]-c[size])/2 : Math.max(min,Math.min(max,round(co[axis])));
    }
  }
  // 清書時に決めた行・列と等間隔を、共通のグリッド単位で再配置する。
  for (const group of constraints.groups || []) {
    const list=group.ids.map(id=>byId.get(id)); if (list.some(n=>!n)) throw new Error('整列対象が見つかりません。');
    const row=group.axis==='row', along=row?'x':'y', cross=row?'y':'x', size=row?'w':'h', crossSize=row?'h':'w';
    const same=dim(list.reduce((a,n)=>a+oldById.get(n.id)[size],0)/list.length), sameCross=dim(list.reduce((a,n)=>a+oldById.get(n.id)[crossSize],0)/list.length);
    for (const n of list) { n[size]=same; n[crossSize]=sameCross; }
    const crossPos=round(list.reduce((a,n)=>a+oldById.get(n.id)[cross],0)/list.length);
    const first=round(oldById.get(list[0].id)[along]);
    const delta=list.length>2 ? Math.max(g,round((oldById.get(list.at(-1).id)[along]-oldById.get(list[0].id)[along])/(list.length-1))) : null;
    list.forEach((n,i)=>{n[cross]=crossPos;n[along]=delta===null?round(oldById.get(n.id)[along]):first+i*delta;});
  }
  for (const {outer,inner} of constraints.centered || []) {
    const p=byId.get(outer),c=byId.get(inner);
    if (!p || !c) throw new Error('入れ子の図形が見つかりません。');
    c.x=p.x+(p.w-c.w)/2; c.y=p.y+(p.h-c.h)/2;
  }
  for (const n of nodes) if (n.x<0 || n.y<0 || [n.x,n.y,n.w,n.h].some(v=>!Number.isFinite(v) || Math.abs(v/g-Math.round(v/g))>1e-7)) throw new Error('グリッド上で入れ子を保てません。図形の余白を広げてください。');
  // 他の図形との重なりや包含が丸めで変化する場合は、黙って作成しない。
  for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
    const a=nodes[i],b=nodes[j],oa=oldById.get(a.id),ob=oldById.get(b.id);
    if (overlap(oa,ob)!==overlap(a,b) || contains(oa,ob)!==contains(a,b) || contains(ob,oa)!==contains(b,a)) throw new Error('グリッドに揃えると図形の重なり・入れ子が変わります。図形の間隔を広げてください。');
  }
  const anchor=end=>{
    if (end.id==null) return {x:end.x,y:end.y};
    const n=byId.get(end.id); if(!n) throw new Error('線の接続先が見つかりません。');
    if (end.ang!=null) return {x:n.x+n.w*(1+Math.cos(end.ang))/2,y:n.y+n.h*(1+Math.sin(end.ang))/2};
    return {x:n.x+n.w*end.ax,y:n.y+n.h*end.ay};
  };
  const adjustY=(end,y)=>{
    const n=byId.get(end.id); if(!n) throw new Error('曲線の接続先が見つかりません。');
    if(end.ang!=null && n.type==='ellipse') { const v=(y-n.y-n.h/2)/(n.h/2); if(Math.abs(v)>=1) throw new Error('グリッド上で曲線の接続を揃えられません。'); return {...end,ang:Math.atan2(v,(Math.cos(end.ang)>=0?1:-1)*Math.sqrt(1-v*v))}; }
    if(end.ax===0 || end.ax===1) { const ay=(y-n.y)/n.h; if(ay<0||ay>1) throw new Error('グリッド上で曲線の接続を揃えられません。'); return {...end,ay}; }
    throw new Error('グリッド上で曲線の接続を揃えられません。');
  };
  const symmetric=new Set(constraints.symmetric || []);
  for (const e of edges) {
    for (const k of ['from','to']) if(e[k].id==null) {
      const old={...e[k]}, p={x:round(old.x),y:round(old.y)};
      for (const n of nodes) if (inside(oldById.get(n.id),old)!==inside(n,p)) throw new Error('グリッドに揃えると自由な線の端が図形に重なります。接続先を確認してください。');
      e[k]=p;
    }
    if(e.from.id==null && e.to.id==null && e.from.x===e.to.x && e.from.y===e.to.y) throw new Error('グリッドに揃えると線の両端が同じ位置になります。線を長くしてください。');
    // 清書の直線が元々ほぼ水平なら、両端を図形上で同じ高さに保つ。
    if(cleanMode && e.style==='straight' && e.from.id!=null && e.to.id!=null) {
      const beforeA=oldById.get(e.from.id),beforeB=oldById.get(e.to.id);
      const at=(n,end)=>end.ang!=null ? {x:n.x+n.w*(1+Math.cos(end.ang))/2,y:n.y+n.h*(1+Math.sin(end.ang))/2} : {x:n.x+n.w*end.ax,y:n.y+n.h*end.ay};
      const oldA=at(beforeA,e.from),oldB=at(beforeB,e.to),a=anchor(e.from),b=anchor(e.to);
      if(Math.abs(oldA.y-oldB.y)<=Math.min(beforeA.h,beforeB.h)*.1 && Math.abs(oldA.x-oldB.x)>Math.abs(oldA.y-oldB.y)*4) {
        try { const y=(a.y+b.y)/2,from=adjustY(e.from,y),to=adjustY(e.to,y); e.from=from;e.to=to; } catch { /* 接続できない場合は元の参照を保持 */ }
      }
    }
    if(e.style!=='curve' || !e.c1 || !e.c2) continue;
    let a=anchor(e.from),b=anchor(e.to);
    const c1={x:a.x+e.c1.dx,y:a.y+e.c1.dy},c2={x:b.x+e.c2.dx,y:b.y+e.c2.dy};
    if(symmetric.has(e.id)) {
      const y=(a.y+b.y)/2; e.from=adjustY(e.from,y); e.to=adjustY(e.to,y); a=anchor(e.from); b=anchor(e.to);
      const sum=a.x+b.x;
      if(Math.abs(sum/g-Math.round(sum/g))>1e-7) throw new Error('グリッド上で曲線の左右対称を保てません。対称化を外して確認してください。');
      const x1=round((c1.x+sum-c2.x)/2),x2=sum-x1,cy=round((c1.y+c2.y)/2);
      e.c1={dx:x1-a.x,dy:cy-a.y}; e.c2={dx:x2-b.x,dy:cy-b.y};
    } else { e.c1={dx:round(c1.x)-a.x,dy:round(c1.y)-a.y}; e.c2={dx:round(c2.x)-b.x,dy:round(c2.y)-b.y}; }
  }
  doc.W=Math.max(doc.W,...nodes.map(n=>n.x+n.w+g*2)); doc.H=Math.max(doc.H,...nodes.map(n=>n.y+n.h+g*2));
  return doc;
}
