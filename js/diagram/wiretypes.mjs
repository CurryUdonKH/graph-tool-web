// 配線と通常の線は、矢印や形ではなく作成時の種類で区別する。
export const isWire = e => !!e && e.type === "edge" && e.wire === true;

// 旧データには種類がない線もある。ゲート・接続点につながる矢印なしの線だけ配線とみなし、
// 判断できないものは元の図形への接続を守るため通常の線として扱う。
export function migrateWireTypes(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  for (const e of items) {
    if (e.type !== "edge" || e.wire !== undefined) continue;
    const connected = [e.from, e.to].some(end => end && ["gate", "dot"].includes(byId.get(end.id)?.type));
    e.wire = connected && e.arrow === "none" && ["straight", "elbow"].includes(e.style);
  }
}
