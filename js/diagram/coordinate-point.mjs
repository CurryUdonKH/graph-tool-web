// 座標上の黒点。配線の接続点とは独立し、接続数によって消えない。
export function resizePoint(point, diameter) {
  if (!Number.isFinite(diameter) || diameter < 1 || diameter > 100) return false;
  const cx = point.x + point.w / 2, cy = point.y + point.h / 2;
  point.w = point.h = diameter;
  point.x = cx - diameter / 2; point.y = cy - diameter / 2;
  return true;
}
export function pointPrimitives(point) {
  const cx = point.x + point.w / 2, cy = point.y + point.h / 2, r = point.w / 2;
  const out = [{ k: "ellipse", cx, cy, rx: r, ry: r, lw: 0, stroke: "none", fill: "#000000" }];
  if (!point.text) return out;
  const gap = r + 6;
  const positions = {
    right: [cx + gap, cy, "left", "center"], left: [cx - gap, cy, "right", "center"],
    top: [cx, cy - gap, "center", "bottom"], bottom: [cx, cy + gap, "center", "top"],
    upperRight: [cx + gap, cy - gap, "left", "bottom"],
  };
  const [x, y, ha, va] = positions[point.labelPosition] || positions.upperRight;
  out.push({ k: "text", x, y, s: point.text, size: point.fontSize || 18, ha, va, styles: point.textStyles, src: point.id });
  return out;
}
