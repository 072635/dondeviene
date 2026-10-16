import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPassword, verifyPassword, createSession, destroySession, sessionCookie, clearCookie,
  loadUser, requireRole, publicUser, makeLoginLimiter,
} from './auth.js';
import { makeRoute, haversine } from '../public/js/geo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = ['vacia', 'media', 'llena'];
const REASONS = ['no_se_detuvo', 'manejo_peligroso', 'cobro_incorrecto', 'sin_aire_sucia', 'mal_trato', 'otro'];
const INCIDENTS = { trafico: 'Tráfico lento', accidente: 'Accidente en la vía', falla: 'Falla mecánica', gente: 'Parada con mucha gente' };
const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'ionic://localhost']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function createApp({ db, live, secureCookies = false, simulator = null, demo = false }) {
  const app = express();
  const limiter = makeLoginLimiter();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // La app nativa carga sus pantallas desde el teléfono (capacitor://localhost o https://localhost) y llama a esta API.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && NATIVE_ORIGINS.has(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-DV-Client',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(loadUser(db));

  // Las peticiones que cambian datos deben ser JSON: así un formulario de otro sitio no puede enviarlas.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Envía los datos como JSON.' });
    }
    next();
  });
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    });
    next();
  });

  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const unitById = db.prepare('SELECT * FROM units WHERE id = ?');
  const activeShiftOf = db.prepare('SELECT * FROM shifts WHERE driver_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1');
  const logEvent = (e) => {
    const r = db.prepare('INSERT INTO events (route_id, unit_id, shift_id, kind, level, text, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.routeId ?? null, e.unitId ?? null, e.shiftId ?? null, e.kind, e.level, e.text, e.lat ?? null, e.lng ?? null, Date.now());
    const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid);
    if (e.routeId) live.notifyAdmins(e.routeId, 'event', ev);
    return ev;
  };

  // La app web usa una cookie que JavaScript no puede leer; la app nativa recibe el token para guardarlo en el teléfono.
  const login = (req, res, user) => {
    const { token, expires } = createSession(db, user.id);
    if (req.get('X-DV-Client') === 'native') return res.json({ user: publicUser(user), token });
    res.setHeader('Set-Cookie', sessionCookie(token, expires, secureCookies));
    return res.json({ user: publicUser(user) });
  };

  // ---------- Cuenta ----------
  app.post('/api/auth/register', (req, res) => {
    const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
    const phone = str(req.body.phone, 20) || null;
    if (!name) return res.status(400).json({ error: 'Escribe tu nombre.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
    const r = db.prepare('INSERT INTO users (name, email, phone, pass, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email, phone, hashPassword(password), 'pasajero', Date.now());
    return login(req, res.status(201), userById.get(r.lastInsertRowid));
  });

  app.post('/api/auth/login', (req, res) => {
    const email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
    const key = `${req.ip}|${email}`;
    if (!limiter.check(key)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.pass)) {
      limiter.fail(key);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    if (!user.active) return res.status(403).json({ error: 'Esta cuenta está desactivada. Habla con la administración.' });
    limiter.reset(key);
    return login(req, res, user);
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    res.setHeader('Set-Cookie', clearCookie(secureCookies));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.get('/api/config', (_req, res) => {
    res.json({ demo: !!demo });
  });

  app.post('/api/auth/password', requireRole(), (req, res) => {
    const current = String(req.body.current || ''), next = String(req.body.password || '');
    if (!verifyPassword(current, req.user.pass)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    if (next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });

  // ---------- Rutas y transmisión en vivo (público) ----------
  app.get('/api/routes', (_req, res) => {
    const units = db.prepare('SELECT id, number, route_id, accessible FROM units WHERE active = 1 ORDER BY number').all();
    res.json({
      routes: [...live.routes.values()].map((r) => ({
        ...live.publicRoute(r),
        units: units.filter((u) => u.route_id === r.id).map((u) => ({ id: u.id, number: u.number, accessible: !!u.accessible })),
      })),
    });
  });

  app.get('/api/stream', (req, res) => {
    const routeId = Number(req.query.route);
    if (!live.route(routeId)) return res.status(404).json({ error: 'Ruta no encontrada.' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const remove = live.addClient(res, routeId, req.user?.role === 'admin');
    req.on('close', remove);
  });

  // ---------- Pasajeros esperando (anónimo, sin cuenta) ----------
  const waitHits = new Map();
  const WAIT_ID = /^[A-Za-z0-9_-]{16,64}$/;
  app.post('/api/waiting', (req, res) => {
    const now = Date.now();
    const h = waitHits.get(req.ip) || { start: now, n: 0 };
    if (now - h.start > 60e3) { h.start = now; h.n = 0; }
    h.n++; waitHits.set(req.ip, h);
    if (h.n > 20) return res.status(429).json({ error: 'Demasiados avisos seguidos. Espera un momento.' });
    const id = String(req.body.id || ''), lat = num(req.body.lat), lng = num(req.body.lng);
    if (!WAIT_ID.test(id) || id.startsWith('sim-')) return res.status(400).json({ error: 'Identificador inválido.' });
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'Ubicación inválida.' });
    const r = live.setWaiting(id, Number(req.body.routeId), lat, lng, req.body.dir === 1 ? 1 : 0);
    if (r.error) return res.status(400).json(r);
    res.json(r);
  });

  app.post('/api/waiting/cancel', (req, res) => {
    const id = String(req.body.id || '');
    if (WAIT_ID.test(id) && !id.startsWith('sim-')) live.cancelWaiting(id);
    res.json({ ok: true });
  });

  // ---------- Reportes ciudadanos ----------
  app.post('/api/reports', requireRole(), (req, res) => {
    const reason = str(req.body.reason, 40);
    if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Elige un motivo.' });
    const unit = unitById.get(Number(req.body.unitId));
    if (!unit) return res.status(400).json({ error: 'Elige la unidad.' });
    const recent = db.prepare('SELECT COUNT(*) n FROM reports WHERE user_id = ? AND created_at > ?').get(req.user.id, Date.now() - 3600e3).n;
    if (recent >= 10) return res.status(429).json({ error: 'Ya enviaste muchos reportes en la última hora.' });
    const stopId = req.body.stopId ? Number(req.body.stopId) : null;
    const r = db.prepare('INSERT INTO reports (user_id, route_id, unit_id, stop_id, reason, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, unit.route_id, unit.id, stopId, reason, str(req.body.comment, 500) || null, Date.now());
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(r.lastInsertRowid);
    live.notifyAdmins(unit.route_id, 'report', rep);
    res.status(201).json({ report: rep });
  });

  // ---------- Conductor ----------
  const driver = express.Router();
  driver.use(requireRole('conductor', 'admin'));

  driver.get('/me', (req, res) => {
    const unit = req.user.unit_id ? unitById.get(req.user.unit_id) : null;
    const shift = activeShiftOf.get(req.user.id) || null;
    const route = unit ? live.route(unit.route_id) : null;
    res.json({
      unit: unit && { id: unit.id, number: unit.number, accessible: !!unit.accessible, plate: unit.plate },
      route: route && live.publicRoute(route),
      shift: shift && { id: shift.id, startedAt: shift.started_at },
      status: shift && unit ? live.driverStatus(unit.id) : null,
    });
  });

  driver.post('/shift/start', (req, res) => {
    const unit = req.user.unit_id ? unitById.get(req.user.unit_id) : null;
    if (!unit) return res.status(400).json({ error: 'Tu cuenta no tiene unidad asignada. Pide a la administración que te asigne una.' });
    let shift = activeShiftOf.get(req.user.id);
    const busy = db.prepare('SELECT * FROM shifts WHERE unit_id = ? AND ended_at IS NULL AND driver_id != ?').get(unit.id, req.user.id);
    if (busy) return res.status(409).json({ error: `La Unidad ${unit.number} ya tiene un turno abierto con otro conductor.` });
    if (!shift) {
      const r = db.prepare('INSERT INTO shifts (unit_id, driver_id, started_at) VALUES (?, ?, ?)').run(unit.id, req.user.id, Date.now());
      shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
      live.startShift(unit, shift.id, req.user.id);
      logEvent({ routeId: unit.route_id, unitId: unit.id, shiftId: shift.id, kind: 'turno', level: 'info', text: `Unidad ${unit.number} inició turno (${req.user.name})` });
    } else if (!live.units.get(unit.id) || live.units.get(unit.id).sim) {
      live.restore(unit, shift);
    }
    res.json({ shift: { id: shift.id, startedAt: shift.started_at }, status: live.driverStatus(unit.id) });
  });

  driver.post('/shift/end', (req, res) => {
    const shift = activeShiftOf.get(req.user.id);
    if (!shift) return res.json({ ok: true });
    const st = live.units.get(shift.unit_id);
    const km = st && !st.sim ? st.km / 1000 : shift.km, trips = st && !st.sim ? st.trips : shift.trips;
    db.prepare('UPDATE shifts SET ended_at = ?, km = ?, trips = ? WHERE id = ?').run(Date.now(), km, trips, shift.id);
    live.endShift(shift.unit_id);
    const unit = unitById.get(shift.unit_id);
    logEvent({ routeId: unit.route_id, unitId: unit.id, shiftId: shift.id, kind: 'turno', level: 'info', text: `Unidad ${unit.number} terminó turno · ${km.toFixed(1)} km, ${trips} vueltas` });
    res.json({ ok: true, km: +km.toFixed(1), trips });
  });

  const requireShift = (req, res, next) => {
    const shift = activeShiftOf.get(req.user.id);
    if (!shift) return res.status(409).json({ error: 'Inicia tu turno primero.' });
    if (!live.units.get(shift.unit_id) || live.units.get(shift.unit_id).sim) live.restore(unitById.get(shift.unit_id), shift);
    req.shift = shift;
    next();
  };

  driver.post('/position', requireShift, (req, res) => {
    const lat = num(req.body.lat), lng = num(req.body.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'Ubicación inválida.' });
    const accuracy = num(req.body.accuracy);
    if (accuracy !== null && accuracy > 150) return res.json({ ignored: true, status: live.driverStatus(req.shift.unit_id) });
    live.updatePosition(req.shift.unit_id, { lat, lng, accuracy, ts: num(req.body.ts) ?? Date.now() });
    res.json({ status: live.driverStatus(req.shift.unit_id) });
  });

  driver.post('/occupancy', requireShift, (req, res) => {
    if (!LEVELS.includes(req.body.level)) return res.status(400).json({ error: 'Nivel de ocupación inválido.' });
    live.setOccupancy(req.shift.unit_id, req.body.level);
    res.json({ status: live.driverStatus(req.shift.unit_id) });
  });

  driver.post('/incident', requireShift, (req, res) => {
    const unit = unitById.get(req.shift.unit_id);
    const st = live.units.get(unit.id);
    const where = st?.hasFix ? live.driverStatus(unit.id).nearStop : null;
    if (req.body.emergency === true) {
      const ev = logEvent({ routeId: unit.route_id, unitId: unit.id, shiftId: req.shift.id, kind: 'emergencia', level: 'crit',
        text: `EMERGENCIA · Unidad ${unit.number} (${req.user.name})${where ? ` cerca de ${where}` : ''}`, lat: st?.lat, lng: st?.lng });
      return res.status(201).json({ event: ev });
    }
    const label = INCIDENTS[req.body.type];
    if (!label) return res.status(400).json({ error: 'Tipo de aviso inválido.' });
    const ev = logEvent({ routeId: unit.route_id, unitId: unit.id, shiftId: req.shift.id, kind: 'incidente', level: 'warn',
      text: `Unidad ${unit.number}: ${label.toLowerCase()}${where ? ` cerca de ${where}` : ''}`, lat: st?.lat, lng: st?.lng });
    res.status(201).json({ event: ev });
  });

  driver.get('/alerts', requireShift, (req, res) => {
    const unit = unitById.get(req.shift.unit_id);
    const rows = db.prepare(`SELECT id, text, level, created_at FROM events WHERE route_id = ? AND kind IN ('incidente','emergencia')
                             AND created_at > ? ORDER BY id DESC LIMIT 5`).all(unit.route_id, Date.now() - 2 * 3600e3);
    res.json({ alerts: rows });
  });

  app.use('/api/driver', driver);

  // ---------- Administración ----------
  const admin = express.Router();
  admin.use(requireRole('admin'));

  admin.get('/overview', (req, res) => {
    const routeId = Number(req.query.route) || [...live.routes.keys()][0];
    const route = live.route(routeId);
    if (!route) return res.status(404).json({ error: 'Ruta no encontrada.' });
    const ov = live.overview(routeId);
    const today = startOfDay();
    const shiftsKm = db.prepare(`SELECT COALESCE(SUM(s.km),0) km FROM shifts s JOIN units u ON u.id = s.unit_id
                                 WHERE u.route_id = ? AND s.started_at >= ?`).get(routeId, today).km;
    const simKm = ov.units.filter((u) => u.sim).reduce((a, u) => a + u.km, 0);
    const totalUnits = db.prepare('SELECT COUNT(*) n FROM units WHERE route_id = ? AND active = 1').get(routeId).n;
    const reportsToday = db.prepare('SELECT COUNT(*) n FROM reports WHERE route_id = ? AND created_at >= ?').get(routeId, today).n;
    const openAlerts = db.prepare(`SELECT COUNT(*) n FROM events WHERE route_id = ? AND level != 'info' AND resolved_at IS NULL`).get(routeId).n;
    res.json({
      route: { id: route.id, code: route.code, name: route.name },
      ...ov,
      kpis: {
        unitsOnline: ov.units.filter((u) => !u.stale).length, totalUnits,
        compliance: ov.compliance, kmToday: +(shiftsKm + simKm).toFixed(1), kmReal: +shiftsKm.toFixed(1),
        reportsToday, openAlerts,
      },
      simulator: !!simulator?.running,
    });
  });

  admin.get('/events', (req, res) => {
    const rows = db.prepare(`SELECT e.*, u.number unit_number FROM events e LEFT JOIN units u ON u.id = e.unit_id
                             ORDER BY e.id DESC LIMIT ?`).all(Math.min(200, Number(req.query.limit) || 50));
    res.json({ events: rows });
  });

  admin.post('/events/:id/resolve', (req, res) => {
    db.prepare('UPDATE events SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(Date.now(), Number(req.params.id));
    res.json({ ok: true });
  });

  admin.get('/reports', (_req, res) => {
    const rows = db.prepare(`SELECT r.*, u.number unit_number, us.name user_name, s.name stop_name FROM reports r
      LEFT JOIN units u ON u.id = r.unit_id LEFT JOIN users us ON us.id = r.user_id LEFT JOIN stops s ON s.id = r.stop_id
      ORDER BY r.id DESC LIMIT 200`).all();
    res.json({ reports: rows });
  });

  admin.patch('/reports/:id', (req, res) => {
    if (!['nuevo', 'revisado', 'atendido'].includes(req.body.status)) return res.status(400).json({ error: 'Estado inválido.' });
    db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(req.body.status, Number(req.params.id));
    res.json({ ok: true });
  });

  admin.get('/units', (_req, res) => {
    const rows = db.prepare(`SELECT u.*, r.code route_code,
      (SELECT name FROM users WHERE unit_id = u.id AND role = 'conductor' LIMIT 1) driver_name FROM units u JOIN routes r ON r.id = u.route_id ORDER BY u.number`).all();
    res.json({ units: rows });
  });

  admin.post('/units', (req, res) => {
    const number = str(req.body.number, 10), routeId = Number(req.body.routeId);
    if (!number) return res.status(400).json({ error: 'Escribe el número de la unidad.' });
    if (!live.route(routeId)) return res.status(400).json({ error: 'Elige una ruta.' });
    if (db.prepare('SELECT 1 FROM units WHERE number = ?').get(number)) return res.status(409).json({ error: `Ya existe la Unidad ${number}.` });
    const r = db.prepare('INSERT INTO units (number, route_id, plate, accessible) VALUES (?, ?, ?, ?)')
      .run(number, routeId, str(req.body.plate, 15) || null, req.body.accessible ? 1 : 0);
    res.status(201).json({ unit: unitById.get(r.lastInsertRowid) });
  });

  admin.patch('/units/:id', (req, res) => {
    const unit = unitById.get(Number(req.params.id));
    if (!unit) return res.status(404).json({ error: 'Unidad no encontrada.' });
    const plate = req.body.plate !== undefined ? str(req.body.plate, 15) || null : unit.plate;
    const accessible = req.body.accessible !== undefined ? (req.body.accessible ? 1 : 0) : unit.accessible;
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : unit.active;
    db.prepare('UPDATE units SET plate = ?, accessible = ?, active = ? WHERE id = ?').run(plate, accessible, active, unit.id);
    const st = live.units.get(unit.id);
    if (st) st.accessible = !!accessible;
    res.json({ unit: unitById.get(unit.id) });
  });

  admin.get('/users', (req, res) => {
    const role = ['pasajero', 'conductor', 'admin'].includes(req.query.role) ? req.query.role : null;
    const rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.unit_id, u.active, u.created_at, un.number unit_number
      FROM users u LEFT JOIN units un ON un.id = u.unit_id ${role ? 'WHERE u.role = ?' : ''} ORDER BY u.role, u.name`).all(...(role ? [role] : []));
    res.json({ users: rows });
  });

  admin.post('/users', (req, res) => {
    const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
    const role = req.body.role === 'admin' ? 'admin' : 'conductor';
    if (!name) return res.status(400).json({ error: 'Escribe el nombre.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    const unitId = req.body.unitId ? Number(req.body.unitId) : null;
    if (unitId && !unitById.get(unitId)) return res.status(400).json({ error: 'Esa unidad no existe.' });
    const r = db.prepare('INSERT INTO users (name, email, phone, pass, role, unit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, str(req.body.phone, 20) || null, hashPassword(password), role, unitId, Date.now());
    res.status(201).json({ user: publicUser(userById.get(r.lastInsertRowid)) });
  });

  admin.patch('/users/:id', (req, res) => {
    const user = userById.get(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.id === req.user.id && req.body.active === false) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    let unitId = user.unit_id;
    if (req.body.unitId !== undefined) {
      unitId = req.body.unitId ? Number(req.body.unitId) : null;
      if (unitId && !unitById.get(unitId)) return res.status(400).json({ error: 'Esa unidad no existe.' });
    }
    if (typeof req.body.password === 'string' && req.body.password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : user.active;
    db.prepare('UPDATE users SET unit_id = ?, active = ? WHERE id = ?').run(unitId, active, user.id);
    if (typeof req.body.password === 'string') {
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(req.body.password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    res.json({ user: publicUser(userById.get(user.id)) });
  });

  admin.get('/shifts', (req, res) => {
    const rows = db.prepare(`SELECT s.*, u.number unit_number, us.name driver_name,
      (SELECT COUNT(*) FROM positions p WHERE p.shift_id = s.id) points
      FROM shifts s JOIN units u ON u.id = s.unit_id JOIN users us ON us.id = s.driver_id ORDER BY s.id DESC LIMIT 100`).all();
    res.json({ shifts: rows });
  });

  // Usa la ida de un turno grabado como trazo de la ruta.
  admin.post('/routes/:id/path-from-shift', (req, res) => {
    const route = live.route(Number(req.params.id));
    if (!route) return res.status(404).json({ error: 'Ruta no encontrada.' });
    const pts = db.prepare('SELECT lat, lng FROM positions WHERE shift_id = ? ORDER BY ts').all(Number(req.body.shiftId)).map((p) => [p.lat, p.lng]);
    if (pts.length < 10) return res.status(400).json({ error: 'Ese turno tiene muy pocos puntos GPS para formar un trazo.' });
    let far = 0, farD = 0;
    pts.forEach((p, i) => { const d = haversine(pts[0], p); if (d > farD) { farD = d; far = i; } });
    const ida = pts.slice(0, far + 1);
    const path = [ida[0]];
    for (const p of ida) if (haversine(path[path.length - 1], p) >= 30) path.push(p);
    if (path[path.length - 1] !== ida[ida.length - 1]) path.push(ida[ida.length - 1]);
    if (path.length < 2 || farD < 500) return res.status(400).json({ error: 'El recorrido es muy corto para usarlo como ruta.' });
    db.prepare('UPDATE routes SET path = ? WHERE id = ?').run(JSON.stringify(path), route.id);
    live.loadRoutes();
    res.json({ route: live.publicRoute(live.route(route.id)) });
  });

  admin.put('/routes/:id/stops', (req, res) => {
    const route = live.route(Number(req.params.id));
    if (!route) return res.status(404).json({ error: 'Ruta no encontrada.' });
    const stops = Array.isArray(req.body.stops) ? req.body.stops : [];
    if (stops.length < 2) return res.status(400).json({ error: 'La ruta necesita al menos 2 paradas.' });
    for (const s of stops) {
      if (!str(s.name) || num(s.lat) === null || num(s.lng) === null) return res.status(400).json({ error: 'Cada parada necesita nombre, latitud y longitud.' });
    }
    try { makeRoute(route.path, stops); } catch (e) { return res.status(400).json({ error: e.message }); }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM stops WHERE route_id = ?').run(route.id);
      const ins = db.prepare('INSERT INTO stops (route_id, seq, name, km, lat, lng) VALUES (?, ?, ?, ?, ?, ?)');
      stops.forEach((s, i) => ins.run(route.id, i, str(s.name, 80), str(s.km, 20) || null, s.lat, s.lng));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    live.loadRoutes();
    res.json({ route: live.publicRoute(live.route(route.id)) });
  });

  admin.post('/simulator', (req, res) => {
    if (!simulator) return res.status(400).json({ error: 'El simulador no está disponible.' });
    if (req.body.on) simulator.start(); else simulator.stop();
    res.json({ simulator: simulator.running });
  });

  app.use('/api/admin', admin);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado.' }));

  // ---------- Archivos de la app ----------
  app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal formados.' });
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
  });

  return app;
}
