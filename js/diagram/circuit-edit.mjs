import { circuitPins } from './circuit-model.mjs';

// 配置・移動した部品の端子に自由端を重ねたときだけ、明示的な接続にする。
// 読み込みや無関係な編集で、座標が同じだけの線を勝手につながない。
export function attachCircuitEnds(items, previous) {
  const before = new Map(previous.map(i => [i.id, i]));
  const pins = items.filter(i => i.type === 'circuit').flatMap(c => {
    const old = before.get(c.id);
    const moved = !old || ['x','y','w','h','rotation','kind'].some(k => c[k] !== old[k]);
    return Object.entries(circuitPins({...c,type:c.kind,x:c.x+c.w/2,y:c.y+c.h/2}))
      .map(([pin,p]) => ({...p,id:c.id,pin,moved}));
  });
  for (const e of items.filter(i => i.circuitWire)) for (const side of ['from','to']) {
    const p = e[side];
    if (p.id != null) continue;
    const old = before.get(e.id)?.[side];
    const moved = !old || old.id != null || old.x !== p.x || old.y !== p.y;
    const matches = pins.filter(pin => Math.abs(pin.x-p.x)<0.5 && Math.abs(pin.y-p.y)<0.5);
    if (matches.length !== 1 || (!moved && !matches[0].moved)) continue;
    e[side] = {id:matches[0].id,pin:matches[0].pin};
  }
}

export const circuitEditHandles = handles => handles.filter(h => h.k === 'start' || h.k === 'end');
