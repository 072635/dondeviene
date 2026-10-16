// Traza una ruta por las calles reales con OSRM (datos de OpenStreetMap), a partir de puntos que el
// administrador toca en el mapa. El servidor público de OSRM es gratuito pero sin garantías; para operar
// a escala se puede usar uno propio o de pago con la variable OSRM_URL.
import { makeRoute } from '../public/js/geo.js';

const OSRM_URL = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

// Simplifica el trazo (Douglas-Peucker) quitando puntos que se desvían menos de `eps` metros.
export function simplify(pts, eps = 4) {
  if (pts.length < 3) return pts;
  const k = Math.cos(pts[0][0] * Math.PI / 180) * 111320, ky = 110540;
  const xy = (p) => [p[1] * k, p[0] * ky];
  const segDist = (p, a, b) => {
    const [px, py] = xy(p), [ax, ay] = xy(a), [bx, by] = xy(b);
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
  };
  const dp = (seg) => {
    if (seg.length < 3) return seg;
    let mi = 0, md = 0;
    for (let i = 1; i < seg.length - 1; i++) { const d = segDist(seg[i], seg[0], seg[seg.length - 1]); if (d > md) { md = d; mi = i; } }
    if (md <= eps) return [seg[0], seg[seg.length - 1]];
    return dp(seg.slice(0, mi + 1)).slice(0, -1).concat(dp(seg.slice(mi)));
  };
  return dp(pts);
}

// Kilómetros donde el trazo da vuelta en U (cambio de rumbo de más de 150°). Suele pasar cuando un punto
// quedó en el carril contrario de un boulevard: conviene moverlo o quitarlo.
export function findUturns(pts) {
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  const route = makeRoute(pts);
  const out = [];
  let prevBrg = null, prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const dist = Math.hypot((pts[i][1] - prev[1]) * k * 111320, (pts[i][0] - prev[0]) * 110540);
    if (dist < 15) continue;
    const brg = Math.atan2((pts[i][1] - prev[1]) * k, pts[i][0] - prev[0]) * 180 / Math.PI;
    if (prevBrg !== null) {
      let delta = Math.abs(brg - prevBrg);
      if (delta > 180) delta = 360 - delta;
      if (delta > 150) out.push(+(route.project(pts[i][0], pts[i][1]).d / 1000).toFixed(1));
    }
    prevBrg = brg; prev = pts[i];
  }
  return out;
}

export async function traceRoute(waypoints) {
  const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  let res;
  try {
    res = await fetch(`${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw Object.assign(new Error('No se pudo conectar con el servicio de rutas. Inténtalo de nuevo en un momento.'), { status: 502 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 'Ok' || !data.routes?.length) {
    throw Object.assign(new Error('No se encontró un camino por las calles entre esos puntos. Revisa que estén sobre calles.'), { status: 400 });
  }
  const full = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const path = simplify(full).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  return { path, km: +(data.routes[0].distance / 1000).toFixed(2), uturns: findUturns(full) };
}
