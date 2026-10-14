// 回帰直線(最小二乗法)。scipy.stats.linregress と同じ値を返す。

// ガンマ関数の対数(Lanczos の近似)
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const v of c) s += v / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}

// 不完全ベータ関数の連分数(Numerical Recipes の betacf)
function betacf(a, b, x) {
  const EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// 正則化された不完全ベータ関数 I_x(a, b)
export function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

// t 分布で、|T| が t 以上になる確率(両側の p 値)
export function tTwoSided(t, df) {
  if (!isFinite(t)) return 0;
  return betaInc(df / (df + t * t), df / 2, 0.5);
}

// xs, ys の回帰直線。点が 2 個未満か、x がすべて同じときは null
// 点が 2 個のときは、標準誤差と p 値は求められないので NaN
export function linregress(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  r = Math.max(-1, Math.min(1, r));
  const df = n - 2;
  if (df === 0) return { n, slope, intercept, r, r2: r * r, stderr: NaN, interceptStderr: NaN, p: NaN };
  const ssres = Math.max(0, syy - slope * sxy);
  const stderr = Math.sqrt(ssres / df / sxx);
  let sumx2 = 0;
  for (let i = 0; i < n; i++) sumx2 += xs[i] * xs[i];
  const interceptStderr = stderr * Math.sqrt(sumx2 / n);
  const t = stderr === 0 ? Infinity : slope / stderr;
  const p = syy === 0 ? 1 : tTwoSided(Math.abs(t), df);
  return { n, slope, intercept, r, r2: r * r, stderr, interceptStderr, p };
}
