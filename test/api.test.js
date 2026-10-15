import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed } from '../server/db.js';
import { Live, Simulator } from '../server/live.js';
import { createApp } from '../server/app.js';
import { makeRoute, etaTo, gapsFor } from '../public/js/geo.js';
import { SEED_ROUTE } from '../server/seed-data.js';

let server, base, live;

before(async () => {
  const db = openDb(':memory:');
  seed(db, { adminEmail: 'admin@test.mx', adminPassword: 'admin-secreto', demo: true });
  live = new Live(db);
  const simulator = new Simulator(live);
  const app = createApp({ db, live, simulator, demo: true });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { live.close(); server.close(); });

// Cliente con cookie propia, como un navegador.
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, raw } = {}) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': raw ? 'text/plain' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, data };
  };
}

test('registro, sesión y salida', async () => {
  const c = client();
  const r = await c('/auth/register', { method: 'POST', body: { name: 'Ana', email: 'ana@test.mx', password: 'secreto123' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'pasajero');
  assert.equal((await c('/auth/me')).data.user.email, 'ana@test.mx');
  assert.equal((await c('/auth/register', { method: 'POST', body: { name: 'Ana', email: 'ANA@test.mx', password: 'secreto123' } })).status, 409);
  await c('/auth/logout', { method: 'POST', body: {} });
  assert.equal((await c('/auth/me')).data.user, null);
});

test('validaciones de registro', async () => {
  const c = client();
  assert.equal((await c('/auth/register', { method: 'POST', body: { name: 'X', email: 'malo', password: 'secreto123' } })).status, 400);
  assert.equal((await c('/auth/register', { method: 'POST', body: { name: 'X', email: 'x@test.mx', password: 'corta' } })).status, 400);
});

test('contraseña incorrecta y límite de intentos', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await c('/auth/login', { method: 'POST', body: { email: 'pasajero@demo.mx', password: 'mala' } })).status, 401);
  }
  assert.equal((await c('/auth/login', { method: 'POST', body: { email: 'pasajero@demo.mx', password: 'demo1234' } })).status, 429);
});

test('permisos por rol', async () => {
  const anon = client();
  assert.equal((await anon('/driver/me')).status, 401);
  assert.equal((await anon('/reports', { method: 'POST', body: { unitId: 1, reason: 'otro' } })).status, 401);
  const c = client();
  await c('/auth/register', { method: 'POST', body: { name: 'Beto', email: 'beto@test.mx', password: 'secreto123' } });
  assert.equal((await c('/driver/me')).status, 403);
  assert.equal((await c('/admin/overview')).status, 403);
});

test('solo acepta JSON en peticiones que cambian datos', async () => {
  const c = client();
  const r = await c('/auth/login', { method: 'POST', body: 'email=a', raw: true });
  assert.equal(r.status, 415);
});

test('rutas públicas con paradas y unidades', async () => {
  const { data } = await client()('/routes');
  assert.equal(data.routes[0].code, 'R-2');
  assert.equal(data.routes[0].stops.length, SEED_ROUTE.stops.length);
  assert.ok(data.routes[0].units.find((u) => u.number === '12').accessible);
});

test('turno del conductor: GPS, distancia, avisos y cierre', async () => {
  const d = client();
  assert.equal((await d('/auth/login', { method: 'POST', body: { email: 'conductor07@demo.mx', password: 'demo1234' } })).status, 200);
  assert.equal((await d('/driver/position', { method: 'POST', body: { lat: 21.14, lng: -86.8 } })).status, 409);
  const s = await d('/driver/shift/start', { method: 'POST', body: {} });
  assert.equal(s.status, 200);

  // Recorre los primeros puntos de la ruta, un punto cada 60 s.
  const pts = SEED_ROUTE.path.slice(0, 6);
  const t0 = Date.now() - pts.length * 60e3;
  let last;
  for (let i = 0; i < pts.length; i++) {
    last = await d('/driver/position', { method: 'POST', body: { lat: pts[i][0], lng: pts[i][1], accuracy: 8, ts: t0 + i * 60e3 } });
    assert.equal(last.status, 200);
  }
  assert.equal(last.data.status.hasFix, true);
  assert.equal(last.data.status.dir, 0);
  assert.ok(last.data.status.km > 3.3 && last.data.status.km < 3.9, `km = ${last.data.status.km}`);

  const ign = await d('/driver/position', { method: 'POST', body: { lat: 21.1, lng: -86.7, accuracy: 500 } });
  assert.equal(ign.data.ignored, true);

  assert.equal((await d('/driver/occupancy', { method: 'POST', body: { level: 'llena' } })).data.status.occ, 'llena');
  assert.equal((await d('/driver/occupancy', { method: 'POST', body: { level: 'x' } })).status, 400);
  assert.equal((await d('/driver/incident', { method: 'POST', body: { type: 'trafico' } })).status, 201);
  const sos = await d('/driver/incident', { method: 'POST', body: { emergency: true } });
  assert.equal(sos.data.event.level, 'crit');
  assert.ok((await d('/driver/alerts')).data.alerts.length >= 2);

  // Otro conductor no puede abrir turno en la misma unidad.
  const a = client();
  await a('/auth/login', { method: 'POST', body: { email: 'admin@test.mx', password: 'admin-secreto' } });
  await a('/admin/users', { method: 'POST', body: { name: 'Otro', email: 'otro@test.mx', password: 'secreto123', role: 'conductor', unitId: 2 } });
  const o = client();
  await o('/auth/login', { method: 'POST', body: { email: 'otro@test.mx', password: 'secreto123' } });
  assert.equal((await o('/driver/shift/start', { method: 'POST', body: {} })).status, 409);

  const end = await d('/driver/shift/end', { method: 'POST', body: {} });
  assert.ok(end.data.km > 2);
});

test('reportes ciudadanos', async () => {
  const c = client();
  await c('/auth/login', { method: 'POST', body: { email: 'pasajero@demo.mx', password: 'demo1234' } }).catch(() => {});
  const r2 = client();
  await r2('/auth/register', { method: 'POST', body: { name: 'Caro', email: 'caro@test.mx', password: 'secreto123' } });
  assert.equal((await r2('/reports', { method: 'POST', body: { unitId: 1, reason: 'nada' } })).status, 400);
  const ok = await r2('/reports', { method: 'POST', body: { unitId: 1, reason: 'no_se_detuvo', comment: 'Pasó de largo' } });
  assert.equal(ok.status, 201);
});

test('administración: tablero, alta de conductor, paradas, trazo y simulador', async () => {
  const a = client();
  await a('/auth/login', { method: 'POST', body: { email: 'admin@test.mx', password: 'admin-secreto' } });
  const ov = await a('/admin/overview?route=1');
  assert.equal(ov.status, 200);
  assert.ok(ov.data.kpis.kmReal > 2);
  assert.ok(ov.data.kpis.reportsToday >= 1);

  const sim = await a('/admin/simulator', { method: 'POST', body: { on: true } });
  assert.equal(sim.data.simulator, true);
  const ov2 = await a('/admin/overview?route=1');
  assert.ok(ov2.data.units.length >= 5);
  assert.ok(ov2.data.pairs.length >= 5);
  await a('/admin/simulator', { method: 'POST', body: { on: false } });

  const u = await a('/admin/users', { method: 'POST', body: { name: 'Luis', email: 'luis@test.mx', password: 'secreto123', role: 'conductor' } });
  assert.equal(u.status, 201);
  assert.equal((await a(`/admin/users/${u.data.user.id}`, { method: 'PATCH', body: { unitId: 3 } })).data.user.unitId, 3);
  assert.equal((await a(`/admin/users/${u.data.user.id}`, { method: 'PATCH', body: { password: 'x' } })).status, 400);

  const shifts = (await a('/admin/shifts')).data.shifts;
  assert.ok(shifts.length >= 1);
  const tr = await a('/admin/routes/1/path-from-shift', { method: 'POST', body: { shiftId: shifts[shifts.length - 1].id } });
  assert.equal(tr.status, 400); // 6 puntos: muy pocos para un trazo

  const stops = SEED_ROUTE.stops.map((s) => ({ ...s, name: s.name }));
  stops[1].name = 'Las Perlas';
  const st = await a('/admin/routes/1/stops', { method: 'PUT', body: { stops } });
  assert.equal(st.status, 200);
  assert.equal(st.data.route.stops[1].name, 'Las Perlas');
  assert.equal((await a('/admin/routes/1/stops', { method: 'PUT', body: { stops: [stops[0]] } })).status, 400);

  const un = await a('/admin/units', { method: 'POST', body: { number: '40', routeId: 1, accessible: true } });
  assert.equal(un.status, 201);
  assert.equal((await a('/admin/units', { method: 'POST', body: { number: '40', routeId: 1 } })).status, 409);
});

test('geometría: proyección, tiempo de llegada y separación', () => {
  const r = makeRoute(SEED_ROUTE.path, SEED_ROUTE.stops);
  assert.ok(r.L > 18000 && r.L < 23000, `L = ${r.L}`);
  const p = r.project(SEED_ROUTE.stops[5].lat, SEED_ROUTE.stops[5].lng);
  assert.ok(p.off < 50);
  const bus = { id: 1, s: r.stopD[5] - 630 }; // 630 m antes de Punta Cancún, de ida
  const e = etaTo(r, bus, 5, 0);
  assert.ok(Math.abs(e.rel - 630) < 1);
  assert.ok(Math.abs(e.eta - 100) < 1);
  const g = gapsFor(r, bus, [bus, { id: 2, s: bus.s + 1260 }, { id: 3, s: bus.s - 3780 }]);
  assert.equal(g.ahead.unit.id, 2);
  assert.equal(g.behind.unit.id, 3);
});
