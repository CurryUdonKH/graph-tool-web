// 白抜きの端子記号は配線の見た目だけを表し、接続情報には使わない。
export const TERMINAL_MODES = Object.freeze(['auto', 'none', 'start', 'end', 'both']);
export const hasTerminal = (mode, end) => mode === 'both' || mode === end;
export function terminalMode(start, end) { return start ? (end ? 'both' : 'start') : (end ? 'end' : 'none'); }
export function splitTerminalMode(mode) {
  if (mode === 'auto') return ['auto', 'auto'];
  return [terminalMode(hasTerminal(mode, 'start'), false), terminalMode(false, hasTerminal(mode, 'end'))];
}
export function terminalPrimitives(mode, start, end, lw = 1.5, refs = []) {
  const marked = (side, index) => mode === 'auto' ? !!refs[index] && refs[index].id == null : hasTerminal(mode, side);
  return [marked('start', 0) && start, marked('end', 1) && end].filter(Boolean)
    .map(p => ({ k: 'ellipse', cx: p.x, cy: p.y, rx: 6, ry: 6, lw, fill: '#ffffff' }));
}
