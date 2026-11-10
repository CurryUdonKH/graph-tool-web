import { numericColumns, column } from './data.js';

export const seriesXRef = (sel, y) => Object.hasOwn(sel.xByY || {}, y) ? sel.xByY[y] : null;

// 各系列の横軸を独立に選ぶ。別データ同士は表の先頭から同じ順番の行を組にする。
export function computeScatterSeries(src, st) {
  const series = [], warns = [];
  st.sel ||= {}; st.labels ||= {};
  for (const f of src) {
    const nums = numericColumns(f.table);
    if (!nums.length) {
      warns.push(`「${f.name}」に数値の列が見つかりません。表の上にタイトル行がある場合は、「データ」のファイル設定から「上から飛ばす行数」を増やしてみてください。`);
      continue;
    }
    let sel = st.sel[f.name];
    if (!sel) sel = st.sel[f.name] = {x:nums[0], ys:null};
    if (!nums.includes(sel.x)) sel.x = nums[0];
    sel.xByY ||= {};
    if (!sel.ys) sel.ys = nums.filter(c => c !== sel.x).slice(0,1);
    sel.ys = sel.ys.filter(y => nums.includes(y) && (y !== sel.x || nums.length === 1 || seriesXRef(sel,y)));
    for (const y of sel.ys) {
      const ref = seriesXRef(sel,y), xfile = ref ? src.find(s => s.name === ref.source) : f, x = ref ? ref.column : sel.x;
      if (!xfile || !numericColumns(xfile.table).includes(x)) {
        warns.push(`「${f.name} / ${y}」の横軸「${ref?.source} / ${x}」が見つかりません。データ欄で横軸を選び直してください。`);
        continue;
      }
      const xcol = column(xfile.table,x), ycol = column(f.table,y), xs = [], ys = [];
      const length = Math.min(xcol.length,ycol.length);
      if (xcol.length !== ycol.length) warns.push(`「${f.name} / ${y}」は横軸が${xcol.length}行、縦軸が${ycol.length}行です。先頭から${length}行を対応させ、余った行は使いません。`);
      for (let i=0;i<length;i++) {
        if (Number.isFinite(xcol[i]) && Number.isFinite(ycol[i])) { xs.push(xcol[i]); ys.push(ycol[i]); }
      }
      if (!xs.length) warns.push(`「${f.name} / ${y}」に横軸と縦軸が両方とも数値になる行がありません。`);
      const key = `${f.name}\u0000${y}`;
      const name = f.name.replace(/\.[^.]+$/,'');
      series.push({file:f.name,xFile:xfile.name,x,y,key,xs,ys,label:st.labels[key] ?? (src.length>1 ? `${name}: ${y}` : y)});
    }
  }
  return {series,warns};
}
