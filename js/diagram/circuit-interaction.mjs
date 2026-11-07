// SVG の描き直しでクリック先が変わっても、連続した操作を同じ終点へのダブルクリックとして扱う。
export function circuitDoubleClick(previous, current) {
  return !!previous && current.t - previous.t >= 0 && current.t - previous.t < 900 &&
    Math.hypot(current.x - previous.x, current.y - previous.y) < 10;
}
