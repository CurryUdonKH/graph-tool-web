// 清書は検証済みの取り込み図の複製にだけ適用する。参照・矢印・文字は変更しない。
export function tidySketch(source, options = {}) {
  const { nested: doNested = true, align: doAlign = true, symmetric: doSymmetric = false } = options;
  const doc = structuredClone(source), nodes = doc.items.filter(i => i.type !== 'edge');
  const edges = doc.items.filter(i => i.type === 'edge');
  const changes = [], used = new Set(), nested = new Set(), constraints = { groups: [], centered: [], symmetric: [] };
  // 数値や独立した文字を含む図はグラフ・目盛りの可能性があるため座標を変えない。
  if (nodes.some(n => n.type === 'text' || /^\s*[+-]?(?:\d|\.\d)/.test(n.text || ''))) {
    return { doc, constraints, changes: ['数値や独立した文字を含む図は、値や配置を保つため自動で整えません。'] };
  }
  const boxTypes = new Set(['rect', 'note']);
  const name = n => n.text ? n.text.slice(0, 40) : `${{rect:'四角',note:'注釈',ellipse:'楕円'}[n.type] || '図形'} ${n.id}`;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const contains = (p, c) => c.x > p.x && c.y > p.y && c.x + c.w < p.x + p.w && c.y + c.h < p.y + p.h;
  const union = (a, b) => ({ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), w: Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x), h: Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y) });
  const intersects = (a,b) => a.x <= b.x+b.w && b.x <= a.x+a.w && a.y <= b.y+b.h && b.y <= a.y+a.h;
  const anchor = end => {
    if (end.id == null) return end;
    const n = nodes.find(v => v.id === end.id);
    if (!n) return null;
    if (end.ang != null) return { x: n.x+n.w*(1+Math.cos(end.ang))/2, y: n.y+n.h*(1+Math.sin(end.ang))/2 };
    if (end.ax == null || end.ay == null) return null;
    return { x:n.x+n.w*end.ax, y:n.y+n.h*end.ay };
  };
  // 曲線は制御点を含む外接矩形で保守的に判定する。文字幅も余裕を見て加える。
  const edgeBounds = e => {
    const a=anchor(e.from), b=anchor(e.to); if (!a || !b) return null;
    const pts=[a,b];
    if (e.style === 'curve' && e.c1 && e.c2) pts.push({x:a.x+e.c1.dx,y:a.y+e.c1.dy},{x:b.x+e.c2.dx,y:b.y+e.c2.dy});
    const pad = e.label ? Math.max(2, (e.fontSize || 18) * Array.from(e.label).length / 2) : 2;
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
    const left=Math.min(...xs)-pad, top=Math.min(...ys)-pad;
    return {x:left,y:top,w:Math.max(...xs)+pad-left,h:Math.max(...ys)+pad-top};
  };
  const blockedByEdge = (area, exempt = new Set()) => edges.some(e => {
    if (exempt.has(e.id)) return false;
    const bounds=edgeBounds(e); return !bounds || intersects(area,bounds);
  });

  // 入れ子は同列と別扱いにし、必ず元の幅・高さと親の接続を維持する。
  for (const outer of nodes.filter(n => boxTypes.has(n.type))) {
    const children=nodes.filter(n => n !== outer && boxTypes.has(n.type) && contains(outer,n));
    for (const child of children) { nested.add(outer.id); nested.add(child.id); }
    if (!children.length || !doNested) continue;
    if (children.length !== 1 || nodes.some(n => n !== outer && contains(n,outer))) {
      changes.push(`${name(outer)}：入れ子が複数または多段のため変更しません。`); continue;
    }
    const child=children[0], label=`${name(outer)} 内の ${name(child)}`;
    const proposed={...child,x:outer.x+(outer.w-child.w)/2,y:outer.y+(outer.h-child.h)/2};
    const area=union(child,proposed);
    if (outer.text || nodes.some(n => n !== outer && n !== child && overlap(outer,n)) ||
        edges.some(e => e.from.id === child.id || e.to.id === child.id) || blockedByEdge(area)) {
      changes.push(`${label}：他の図形・文字・線との関係が不明なため変更しません。`); continue;
    }
    child.x=proposed.x; child.y=proposed.y; used.add(outer.id); used.add(child.id);
    constraints.centered.push({ outer: outer.id, inner: child.id });
    changes.push(`${label}：入れ子を保ち、内側を外側の中心に揃えます。外側への線の接続は維持します。`);
  }

  // 同種の独立した図形のみ、接続が明確な近い行・列を整える。
  const types=['ellipse','rect','note'];
  if (doAlign) for (const axis of ['row','column']) for (const type of types) {
    const candidates=nodes.filter(n=>n.type===type && !nested.has(n.id) && !used.has(n.id));
    const across=n=>axis==='row' ? n.y+n.h/2 : n.x+n.w/2;
    const depth=n=>axis==='row' ? n.h : n.w;
    const along=n=>axis==='row' ? n.x+n.w/2 : n.y+n.h/2;
    candidates.sort((a,b)=>across(a)-across(b));
    const bands=[];
    for (const n of candidates) {
      const last=bands.at(-1), value=across(n);
      if (last && value-last.anchor <= Math.min(last.depth,depth(n))*.45) { last.nodes.push(n); last.depth=Math.min(last.depth,depth(n)); }
      else bands.push({anchor:value,depth:depth(n),nodes:[n]});
    }
    for (const band of bands) {
      const group=band.nodes.sort((a,b)=>along(a)-along(b)); if (group.length<2) continue;
      const names=group.map(name).join('、'), ids=new Set(group.map(n=>n.id));
      if (group.some(n => (type==='ellipse' && !n.text) || n.text.includes('\n'))) {
        changes.push(`${names}：文字がないか複数行のため変更しません。`); continue;
      }
      if (edges.some(e=>e.wire || e.from.id==null || e.to.id==null)) { changes.push(`${names}：接続先が不明な線があるため変更しません。`); continue; }
      const visited=new Set([group[0].id]); let prev;
      do { prev=visited.size; for (const e of edges) if (ids.has(e.from.id) && ids.has(e.to.id)) { if (visited.has(e.from.id)) visited.add(e.to.id); if (visited.has(e.to.id)) visited.add(e.from.id); } } while (visited.size>prev);
      if (visited.size!==ids.size) { changes.push(`${names}：接続が明確でないため変更しません。`); continue; }
      const avg=fn=>group.reduce((sum,n)=>sum+fn(n),0)/group.length;
      const w=avg(n=>n.w),h=avg(n=>n.h),cross=avg(across), longest=Math.max(...group.map(n=>Array.from(n.text).length));
      const fs=longest ? Math.min(avg(n=>n.fontSize),w*.72/longest,h*.55) : avg(n=>n.fontSize);
      if (fs<8) { changes.push(`${names}：文字が小さくなりすぎるため変更しません。`); continue; }
      const first=along(group[0]),last=along(group.at(-1)),interval=(last-first)/(group.length-1);
      const proposed=group.map((n,i)=>{const pos=group.length>2 ? first+interval*i : along(n);return {...n,x:(axis==='row'?pos:cross)-w/2,y:(axis==='row'?cross:pos)-h/2,w,h,fontSize:fs};});
      const movingEdges=new Set(edges.filter(e=>ids.has(e.from.id)||ids.has(e.to.id)).map(e=>e.id));
      if (proposed.some((p,i)=>p.x<0 || p.y<0 || proposed.some((q,j)=>i<j&&overlap(p,q)) || nodes.some(n=>!ids.has(n.id)&&overlap(p,n)) || blockedByEdge(union(group[i],p),movingEdges))) {
        changes.push(`${names}：図形や線が重なる可能性があるため変更しません。`); continue;
      }
      for (let i=0;i<group.length;i++) { Object.assign(group[i],proposed[i]); used.add(group[i].id); }
      constraints.groups.push({ axis, ids: group.map(n=>n.id) });
      const shape={ellipse:'楕円',rect:'四角',note:'注釈'}[type];
      changes.push(`${names}：${shape}の幅・高さ、文字サイズ、${axis==='row'?'中心の高さ':'中心の横位置'}${group.length>2 ? (axis==='row'?'、横の間隔':'、縦の間隔') : ''}を揃えます。線の接続先と向きは維持します。`);
    }
  }
  // 接続が明確な孤立アーチのみ、接続点の高さと制御点を揃える。
  if (doSymmetric) for (const e of edges) {
    if (e.style !== 'curve' || !e.c1 || !e.c2 || e.label || e.from.id == null || e.to.id == null || e.from.id === e.to.id) continue;
    if (edges.some(other => other !== e && [other.from.id,other.to.id].some(id => id === e.from.id || id === e.to.id))) continue;
    const a0=anchor(e.from),b0=anchor(e.to),fromNode=nodes.find(n=>n.id===e.from.id),toNode=nodes.find(n=>n.id===e.to.id);
    if (!a0 || !b0 || !fromNode || !toNode || Math.abs(a0.x-b0.x)<1 || Math.abs(a0.y-b0.y)>Math.min(fromNode.h,toNode.h)*.25) continue;
    const targetY=(a0.y+b0.y)/2;
    const setHeight=(end,node) => {
      if (end.ang != null && node.type==='ellipse') {
        const v=(targetY-(node.y+node.h/2))/(node.h/2); if (Math.abs(v)>=1) return null;
        const horizontal=Math.cos(end.ang)>=0 ? 1 : -1;
        return {...end,ang:Math.atan2(v,horizontal*Math.sqrt(1-v*v))};
      }
      if (end.ax===0 || end.ax===1) {
        const ay=(targetY-node.y)/node.h; if (ay<0 || ay>1) return null;
        return {...end,ay};
      }
      return null;
    };
    const from=setHeight(e.from,fromNode),to=setHeight(e.to,toNode); if (!from || !to) continue;
    const a=anchor(from),b=anchor(to), c1={x:a0.x+e.c1.dx,y:a0.y+e.c1.dy},c2={x:b0.x+e.c2.dx,y:b0.y+e.c2.dy};
    const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),sign=Math.sign(b.x-a.x);
    if (c1.x<=left || c1.x>=right || c2.x<=left || c2.x>=right || (c1.x-c2.x)*sign>=0 ||
        (c1.y-a.y)*(c2.y-b.y)<=0 || Math.min(Math.abs(c1.y-a.y),Math.abs(c2.y-b.y))<2 ||
        sign*(a.x-(fromNode.x+fromNode.w/2))<0 || sign*(b.x-(toNode.x+toNode.w/2))>0) continue;
    const existing=edgeBounds(e),otherNodes=nodes.filter(n=>n.id!==e.from.id && n.id!==e.to.id);
    if (!existing || otherNodes.some(n=>intersects(existing,n)) || blockedByEdge(existing,new Set([e.id]))) continue;
    const distance=(Math.abs(c1.x-a.x)+Math.abs(b.x-c2.x))/2, controlY=(c1.y+c2.y)/2;
    const candidate={...e,from,to,c1:{dx:sign*distance,dy:controlY-a.y},c2:{dx:-sign*distance,dy:controlY-b.y}},future=edgeBounds(candidate);
    if (!future || otherNodes.some(n=>intersects(future,n)) || blockedByEdge(future,new Set([e.id]))) continue;
    e.from=from; e.to=to; e.c1=candidate.c1; e.c2=candidate.c2;
    constraints.symmetric.push(e.id);
    changes.push(`${name(fromNode)} → ${name(toNode)}：接続先と向きを保ち、接続点の高さと曲線を左右対称に揃えます。`);
  }
  return {doc,constraints,changes:changes.length ? changes : ['対象なし：条件に合う図形・線は変更しません。']};
}
