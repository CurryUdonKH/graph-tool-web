// 表示位置だけを動かし、図の座標や保存データを変更しない。
export function worldPoint(view, zoom, x, y) {
  return {x:view.x+x/zoom, y:view.y+y/zoom};
}
export function zoomView(view, fromZoom, toZoom, anchor) {
  const p=worldPoint(view,fromZoom,anchor.x,anchor.y);
  return {x:p.x-anchor.x/toZoom, y:p.y-anchor.y/toZoom};
}
export function panView(view, zoom, dx, dy) {
  return {x:view.x+dx/zoom, y:view.y+dy/zoom};
}
export function fitView(bounds, width, height, maxZoom=4) {
  const zoom=Math.min(maxZoom, Math.max(1e-6,Math.min(width/Math.max(1,bounds.w),height/Math.max(1,bounds.h))));
  return {zoom,view:{x:bounds.x+bounds.w/2-width/zoom/2,y:bounds.y+bounds.h/2-height/zoom/2}};
}
