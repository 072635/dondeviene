// Geometría de rutas compartida entre el servidor y el navegador.
// Una ruta es un trazo de ida [[lat,lng],...]; el regreso recorre el mismo trazo al revés.
// Posición en el ciclo: s ∈ [0, 2L). Ida: s = d. Regreso: s = 2L - d.

export const VEFF = 6.3; // m/s promedio con paradas (~23 km/h)

export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function makeRoute(path, stops = []) {
  if (!Array.isArray(path) || path.length < 2) throw new Error('El trazo necesita al menos 2 puntos');
  const lat0 = path[0][0] * Math.PI / 180;
  const kx = Math.cos(lat0) * 111320, ky = 110540;
  const xy = path.map(([la, lo]) => [lo * kx, la * ky]);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
  const L = cum[cum.length - 1];

  // Proyecta un punto sobre el trazo: distancia a lo largo (d) y separación lateral (off) en metros.
  function project(lat, lng) {
    const q = [lng * kx, lat * ky];
    let best = Infinity, bd = 0;
    for (let i = 1; i < xy.length; i++) {
      const a = xy[i - 1], b = xy[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const e = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
      if (e < best) { best = e; bd = cum[i - 1] + t * (cum[i] - cum[i - 1]); }
    }
    return { d: bd, off: best };
  }

  function pointAt(d) {
    d = Math.max(0, Math.min(L, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const a = path[i - 1], b = path[i];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  const stopD = stops.map((s, i) =>
    i === 0 ? 0 : i === stops.length - 1 ? L : project(s.lat, s.lng).d);

  return { path, cum, L, LOOP: 2 * L, project, pointAt, stopD };
}

export const mod = (x, m) => ((x % m) + m) % m;

// Posición de una parada en el ciclo según el sentido (0 = ida, 1 = regreso).
export function stopLoopPos(route, k, dir) {
  const n = route.stopD.length;
  if (k === 0) return 0;
  if (k === n - 1) return route.L;
  return dir === 0 ? route.stopD[k] : route.LOOP - route.stopD[k];
}

export function loopPos(route, d, dir) {
  return dir === 0 ? d : route.LOOP - d;
}

// Tiempo estimado (s) para que una unidad llegue a la parada k en el sentido dir.
export function etaTo(route, unit, k, dir) {
  const rel = mod(stopLoopPos(route, k, dir) - unit.s, route.LOOP);
  return { rel, eta: rel < 30 ? 0 : rel / VEFF };
}

// Unidad de adelante y de atrás sobre el ciclo.
export function gapsFor(route, unit, units) {
  let ah = null, bh = null;
  for (const o of units) {
    if (o.id === unit.id) continue;
    const da = mod(o.s - unit.s, route.LOOP), db = mod(unit.s - o.s, route.LOOP);
    if (!ah || da < ah.dist) ah = { unit: o, dist: da };
    if (!bh || db < bh.dist) bh = { unit: o, dist: db };
  }
  if (ah) ah.t = ah.dist / VEFF;
  if (bh) bh.t = bh.dist / VEFF;
  return { ahead: ah, behind: bh };
}

export function headway(route, nUnits) {
  return nUnits > 0 ? route.LOOP / VEFF / nUnits : 0;
}

export function nearestStop(route, d) {
  let n = 0;
  route.stopD.forEach((sd, k) => { if (Math.abs(sd - d) < Math.abs(route.stopD[n] - d)) n = k; });
  return n;
}
