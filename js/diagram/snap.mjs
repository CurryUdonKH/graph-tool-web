// 移動先の辺・中心を、近くの図形の辺・中心にそろえる。
// グリッドにも吸着する場合は、呼び出し側が初期位置にグリッド上の値を渡す。
export function snapToGuides(raw, initial, size, others, tolerance) {
  let x = initial.x, y = initial.y, guideX = null, guideY = null;
  let bestX = tolerance, bestY = tolerance;
  for (const o of others) {
    for (const mine of [0, size.w / 2, size.w]) {
      for (const target of [o.x, o.x + o.w / 2, o.x + o.w]) {
        const d = Math.abs(raw.x + mine - target);
        if (d < bestX) { bestX = d; x = target - mine; guideX = target; }
      }
    }
    for (const mine of [0, size.h / 2, size.h]) {
      for (const target of [o.y, o.y + o.h / 2, o.y + o.h]) {
        const d = Math.abs(raw.y + mine - target);
        if (d < bestY) { bestY = d; y = target - mine; guideY = target; }
      }
    }
  }
  return { x, y, guideX, guideY };
}
