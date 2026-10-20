import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed } from '../server/db.js';
import { Live, Simulator } from '../server/live.js';
import { createApp } from '../server/app.js';
import { PushWatcher } from '../server/push.js';
import { makeRoute, etaTo, etaToPoint, gapsFor } from '../public/js/geo.js';
import { SEED_ROUTE } from '../server/seed-data.js';

let server, base, live, push;
const pushed = [];

before(async () => {
  const db = openDb(':memory:');
  seed(db, { adminEmail: 'admin@test.mx', adminPassword: 'admin-secreto', demo: true });
  live = new Live(db);
  const simulator = new Simulator(live);
  // Servicio de rutas simulado: une los puntos en línea recta (las pruebas no dependen de internet).
  const traceRoute = async (w) => ({ path: w, km: +(makeRoute(w).L / 1000).toFixed(2), uturns: [] });
  push = new PushWatcher(db, live, { send: async (sub, payload) => { pushed.push({ sub, payload }); } });
  const app = createApp({ db, live, simulator, demo: true, traceRoute, push, signupLimit: 1000 });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { live.close(); push.close(); server.close(); });

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
  assert.equal((await c('/auth/register', { method: 'POST', body: { name: 'X', email: 'x@test.mx', password: '12345678' } })).status, 400);
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

  // Recorre los primeros 3.5 km de la ruta, un punto cada 60 s.
  const geoR = makeRoute(SEED_ROUTE.path, SEED_ROUTE.stops);
  const pts = [0, 700, 1400, 2100, 2800, 3500].map((d) => geoR.pointAt(d));
  const t0 = Date.now() - pts.length * 60e3;
  let last;
  for (let i = 0; i < pts.length; i++) {
    last = await d('/driver/position', { method: 'POST', body: { lat: pts[i][0], lng: pts[i][1], accuracy: 8, ts: t0 + i * 60e3 } });
    assert.equal(last.status, 200);
  }
  assert.equal(last.data.status.hasFix, true);
  assert.equal(last.data.status.dir, 0);
  assert.ok(last.data.status.km > 3.2 && last.data.status.km < 3.6, `km = ${last.data.status.km}`);

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

test('pasajero esperando: aviso anónimo, conductor lo ve adelante y se borra al pasar la unidad', async () => {
  const anon = client();
  const id = 'pasajeroPrueba_0123456789';
  // Un punto cerca de Punta Cancún (km 9), a pie de la ruta.
  const geoR = makeRoute(SEED_ROUTE.path, SEED_ROUTE.stops);
  const spot = geoR.pointAt(9000);
  assert.equal((await anon('/waiting', { method: 'POST', body: { id: 'corto', routeId: 1, lat: spot[0], lng: spot[1], dir: 0 } })).status, 400);
  assert.equal((await anon('/waiting', { method: 'POST', body: { id, routeId: 1, lat: 21.30, lng: -86.80, dir: 0 } })).status, 400); // lejos de la ruta
  const ok = await anon('/waiting', { method: 'POST', body: { id, routeId: 1, lat: spot[0], lng: spot[1], dir: 0 } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.d > 8000 && ok.data.d < 10000, `d = ${ok.data.d}`);
  assert.equal(live.snapshot(1).waiting.length, 1);
  assert.equal(live.snapshot(1).waiting[0].lat, undefined); // nunca se comparte la coordenada exacta

  // Un conductor de ida antes de ese punto lo ve en "gente esperando adelante".
  const a = client();
  await a('/auth/login', { method: 'POST', body: { email: 'admin@test.mx', password: 'admin-secreto' } });
  await a('/admin/users', { method: 'POST', body: { name: 'Espera', email: 'espera@test.mx', password: 'secreto123', role: 'conductor', unitId: 4 } });
  const d = client();
  await d('/auth/login', { method: 'POST', body: { email: 'espera@test.mx', password: 'secreto123' } });
  await d('/driver/shift/start', { method: 'POST', body: {} });
  const t0 = Date.now() - 10 * 60e3;
  let st;
  for (let i = 0; i < 4; i++) {
    const [lat, lng] = geoR.pointAt(5000 + i * 1000);
    st = await d('/driver/position', { method: 'POST', body: { lat, lng, accuracy: 8, ts: t0 + i * 60e3 } });
  }
  assert.equal(st.data.status.waitingAhead.length, 1);
  assert.ok(st.data.status.waitingAhead[0].km > 0);

  // La unidad pasa por el punto: el aviso se borra y el pasajero queda como atendido.
  const [plat, plng] = geoR.pointAt(9600);
  await d('/driver/position', { method: 'POST', body: { lat: plat, lng: plng, accuracy: 8, ts: t0 + 5 * 60e3 } });
  live.pruneWaiting();
  assert.equal(live.snapshot(1).waiting.length, 0);
  const again = await anon('/waiting', { method: 'POST', body: { id, routeId: 1, lat: spot[0], lng: spot[1], dir: 0 } });
  assert.equal(again.data.served, true);
  await d('/driver/shift/end', { method: 'POST', body: {} });

  // Cancelar quita el aviso.
  const id2 = 'otroPasajero_0123456789ab';
  await anon('/waiting', { method: 'POST', body: { id: id2, routeId: 1, lat: spot[0], lng: spot[1], dir: 1 } });
  assert.equal(live.snapshot(1).waiting.length, 1);
  await anon('/waiting/cancel', { method: 'POST', body: { id: id2 } });
  assert.equal(live.snapshot(1).waiting.length, 0);
});

test('geometría: llegada a un punto cualquiera de la ruta', () => {
  const r = makeRoute(SEED_ROUTE.path, SEED_ROUTE.stops);
  const bus = { s: 5000 };
  assert.ok(Math.abs(etaToPoint(r, bus, 6000, 0).rel - 1000) < 1);
  // De regreso, el mismo punto queda casi una vuelta completa después.
  assert.ok(etaToPoint(r, bus, 6000, 1).rel > r.L);
  // Cerca de la terminal de inicio todos los camiones van de ida.
  assert.equal(etaToPoint(r, { s: 0 }, 50, 1).rel, 0);
});

test('administración: crear una ruta nueva, agregar paradas y asignarle una unidad', async () => {
  const a = client();
  await a('/auth/login', { method: 'POST', body: { email: 'admin@test.mx', password: 'admin-secreto' } });
  const w = [[21.1600, -86.8500], [21.1700, -86.8400], [21.1800, -86.8300]];
  assert.equal((await a('/admin/routes', { method: 'POST', body: { code: 'r-1', name: 'Prueba', waypoints: [w[0]] } })).status, 400);
  const r = await a('/admin/routes', { method: 'POST', body: { code: 'r-1', name: 'Centro ⟷ Prueba', waypoints: w } });
  assert.equal(r.status, 201);
  assert.equal(r.data.route.code, 'R-1');
  assert.equal(r.data.route.stops.length, 2);
  assert.equal((await a('/admin/routes', { method: 'POST', body: { code: 'R-1', name: 'Otra', waypoints: w } })).status, 409);
  const id = r.data.route.id;

  // Paradas capturadas en desorden: se guardan en el orden de la ruta.
  const stops = [r.data.route.stops[0], { name: 'Final', lat: 21.18, lng: -86.83 }, { name: 'En medio', lat: 21.17, lng: -86.84 }];
  const st = await a(`/admin/routes/${id}/stops`, { method: 'PUT', body: { stops } });
  assert.equal(st.status, 200);
  assert.deepEqual(st.data.route.stops.map((x) => x.name), ['Inicio', 'En medio', 'Final']);

  // Redibujar el trazo mueve las terminales.
  const tr = await a(`/admin/routes/${id}/trace`, { method: 'POST', body: { waypoints: [[21.1610, -86.8500], [21.1810, -86.8300]] } });
  assert.equal(tr.status, 200);
  assert.equal(tr.data.route.stops[0].lat, 21.161);

  // La unidad 40 pasa a la ruta nueva y aparece en su lista.
  const units = (await a('/admin/units')).data.units;
  const u40 = units.find((u) => u.number === '40');
  assert.equal((await a(`/admin/units/${u40.id}`, { method: 'PATCH', body: { routeId: id } })).status, 200);
  const routes = (await client()('/routes')).data.routes;
  assert.ok(routes.find((x) => x.id === id).units.some((u) => u.number === '40'));
  assert.equal((await a(`/admin/units/${u40.id}`, { method: 'PATCH', body: { routeId: 999 } })).status, 400);
});

test('un chofer se registra solo y queda en revisión hasta que le asignan unidad', async () => {
  const c = client();
  const base = { name: 'Chofer Nuevo', email: 'nuevo@test.mx', password: 'secreto123', role: 'conductor', unitNumber: '15' };
  assert.equal((await c('/auth/register', { method: 'POST', body: base })).status, 400); // sin teléfono
  const r = await c('/auth/register', { method: 'POST', body: { ...base, phone: '998 123 4567' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'conductor');
  const me = (await c('/driver/me')).data;
  assert.equal(me.unit, null);
  assert.equal(me.requestedUnit, '15');
  assert.notEqual((await c('/driver/shift/start', { method: 'POST', body: {} })).status, 200);
  // Nadie puede registrarse como administrador.
  const x = await client()('/auth/register', { method: 'POST', body: { name: 'X', email: 'x2@test.mx', password: 'secreto123', role: 'admin' } });
  assert.equal(x.data.user.role, 'pasajero');

  const a = client();
  await a('/auth/login', { method: 'POST', body: { email: 'admin@test.mx', password: 'admin-secreto' } });
  const u = (await a('/admin/users')).data.users.find((y) => y.email === 'nuevo@test.mx');
  assert.equal(u.requested_unit, '15');
  assert.ok((await a('/admin/events')).data.events.some((e) => e.kind === 'registro'));
});

test('notificación push cuando la unidad está a 3 minutos', async () => {
  const c = client();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
  const r = live.route(1);
  const body = { id: 'telefono-de-prueba-01', subscription: sub, routeId: 1, d: 9000, dir: 0, minutes: 3, label: 'Punta Cancún' };
  assert.ok((await c('/config')).data.pushKey);
  // Solo se aceptan servicios push reales (el servidor no manda peticiones a cualquier dirección).
  assert.equal((await c('/push/watch', { method: 'POST', body: { ...body, subscription: { ...sub, endpoint: 'https://ejemplo.com/x' } } })).status, 400);
  assert.equal((await c('/push/watch', { method: 'POST', body })).status, 200);

  // Una unidad a 5 km: todavía no avisa. A 1 km (unos 2.6 min): avisa una sola vez.
  const unit = { unitId: 9001, number: '99', routeId: 1, hasFix: true, offRoute: false, ts: Date.now(), s: 4000 };
  live.units.set(9001, unit);
  push.check();
  assert.equal(pushed.length, 0);
  unit.s = 8000; unit.ts = Date.now();
  push.check(); push.check();
  live.units.delete(9001);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].sub.endpoint, sub.endpoint);
  assert.match(pushed[0].payload.body, /Unidad 99 llega en ~3 min a Punta Cancún/);

  // Cancelar quita el aviso pendiente.
  await c('/push/watch', { method: 'POST', body });
  await c('/push/cancel', { method: 'POST', body: { id: body.id } });
  assert.equal(push.watches.size, 0);
  assert.ok(r);
});
