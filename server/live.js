import { makeRoute, haversine, gapsFor, headway, loopPos, nearestStop, mod } from '../public/js/geo.js';

const STALE_MS = 2 * 60e3;   // sin señal
const DROP_MS = 10 * 60e3;   // se oculta del mapa
const TERMINAL_M = 120;

// Estado en vivo de las unidades, transmisión por SSE y simulador de demostración.
export class Live {
  constructor(db) {
    this.db = db;
    this.routes = new Map();
    this.units = new Map(); // unitId -> estado
    this.clients = new Set();
    this.pending = new Map();
    this.sim = null;
    this.loadRoutes();
    this.timer = setInterval(() => this.housekeeping(), 5000);
    this.timer.unref?.();
  }

  loadRoutes() {
    const rows = this.db.prepare('SELECT * FROM routes ORDER BY id').all();
    for (const r of rows) {
      const stops = this.db.prepare('SELECT id, seq, name, km, lat, lng FROM stops WHERE route_id = ? ORDER BY seq').all(r.id);
      const path = JSON.parse(r.path);
      this.routes.set(r.id, { id: r.id, code: r.code, name: r.name, path, stops, geo: makeRoute(path, stops) });
    }
  }

  route(id) { return this.routes.get(Number(id)); }

  publicRoute(r) {
    return { id: r.id, code: r.code, name: r.name, path: r.path, stops: r.stops, length: Math.round(r.geo.L) };
  }

  // ---- Turnos reales ----
  startShift(unit, shiftId, driverId) {
    this.units.set(unit.id, {
      unitId: unit.id, number: unit.number, routeId: unit.route_id, accessible: !!unit.accessible,
      shiftId, driverId, sim: false, lat: null, lng: null, d: 0, dir: 0, s: 0, occ: 'vacia',
      ts: Date.now(), speed: 0, km: 0, trips: 0, terminals: 0, lastTerminal: null, offRoute: false, hasFix: false,
    });
    this.sim?.release(unit.id);
    this.broadcast(unit.route_id);
  }

  endShift(unitId) {
    const st = this.units.get(unitId);
    if (!st) return;
    this.units.delete(unitId);
    this.broadcast(st.routeId);
  }

  restore(unit, shift) {
    this.startShift(unit, shift.id, shift.driver_id);
    const st = this.units.get(unit.id);
    st.km = shift.km; st.trips = shift.trips; st.terminals = shift.trips * 2;
    const last = this.db.prepare('SELECT lat, lng, ts FROM positions WHERE shift_id = ? ORDER BY ts DESC LIMIT 1').get(shift.id);
    if (last) this.applyFix(st, last.lat, last.lng, last.ts, null, false);
  }

  applyFix(st, lat, lng, ts, accuracy, countKm = true) {
    const r = this.route(st.routeId).geo;
    const { d, off } = r.project(lat, lng);
    if (st.hasFix) {
      const dist = haversine([st.lat, st.lng], [lat, lng]);
      const dt = Math.max(1, (ts - st.ts) / 1000);
      if (countKm && dist > 3 && dist < Math.max(250, 45 * dt)) {
        st.km += dist;
        st.speed = st.speed ? st.speed * 0.7 + 0.3 * (dist / dt) : dist / dt;
      }
      const delta = d - st.d;
      if (delta > 8) st.dir = 0; else if (delta < -8) st.dir = 1;
    }
    if (d < TERMINAL_M) { st.dir = 0; this.terminal(st, 'A'); }
    else if (d > r.L - TERMINAL_M) { st.dir = 1; this.terminal(st, 'B'); }
    Object.assign(st, { lat, lng, d, off, offRoute: off > 300, s: loopPos(r, d, st.dir), ts, accuracy, hasFix: true });
  }

  terminal(st, which) {
    if (st.lastTerminal && st.lastTerminal !== which) {
      st.terminals++;
      st.trips = Math.floor(st.terminals / 2);
    }
    st.lastTerminal = which;
  }

  updatePosition(unitId, { lat, lng, accuracy, ts }) {
    const st = this.units.get(unitId);
    if (!st) return null;
    ts = Math.min(Date.now(), ts || Date.now());
    this.applyFix(st, lat, lng, ts, accuracy);
    this.db.prepare('INSERT INTO positions (shift_id, lat, lng, accuracy, ts) VALUES (?, ?, ?, ?, ?)').run(st.shiftId, lat, lng, accuracy ?? null, ts);
    this.db.prepare('UPDATE shifts SET km = ?, trips = ? WHERE id = ?').run(st.km / 1000, st.trips, st.shiftId);
    this.broadcast(st.routeId);
    return st;
  }

  setOccupancy(unitId, level) {
    const st = this.units.get(unitId);
    if (!st) return;
    st.occ = level;
    this.broadcast(st.routeId);
  }

  // ---- Lecturas ----
  unitsOf(routeId, { includeStale = true } = {}) {
    const now = Date.now();
    return [...this.units.values()].filter((u) =>
      u.routeId === Number(routeId) && u.hasFix && now - u.ts < DROP_MS && (includeStale || now - u.ts < STALE_MS));
  }

  publicUnit(u) {
    return {
      id: u.unitId, number: u.number, accessible: u.accessible, lat: u.lat, lng: u.lng,
      d: Math.round(u.d), dir: u.dir, s: Math.round(u.s), occ: u.occ, sim: u.sim,
      stale: Date.now() - u.ts > STALE_MS, offRoute: u.offRoute, ts: u.ts,
    };
  }

  snapshot(routeId) {
    return { routeId: Number(routeId), t: Date.now(), units: this.unitsOf(routeId).map((u) => this.publicUnit(u)) };
  }

  driverStatus(unitId) {
    const st = this.units.get(unitId);
    if (!st) return null;
    const r = this.route(st.routeId);
    const all = this.unitsOf(st.routeId, { includeStale: false });
    const g = st.hasFix ? gapsFor(r.geo, { id: st.unitId, s: st.s }, all.map((u) => ({ id: u.unitId, number: u.number, s: u.s }))) : { ahead: null, behind: null };
    const H = headway(r.geo, Math.max(1, all.length));
    const fmt = (x) => x && { number: x.unit.number, minutes: Math.round(x.t / 60), km: +(x.dist / 1000).toFixed(1) };
    return {
      hasFix: st.hasFix, dir: st.dir, nearStop: st.hasFix ? r.stops[nearestStop(r.geo, st.d)]?.name : null,
      offRoute: st.offRoute, occ: st.occ, km: +(st.km / 1000).toFixed(1), trips: st.trips,
      ahead: fmt(g.ahead), behind: fmt(g.behind), headwayMin: Math.round(H / 60), lastFix: st.ts, accuracy: st.accuracy,
    };
  }

  overview(routeId) {
    const r = this.route(routeId);
    const units = this.unitsOf(routeId);
    const fresh = units.filter((u) => Date.now() - u.ts < STALE_MS);
    const H = headway(r.geo, Math.max(1, fresh.length));
    const pairs = fresh.map((u) => {
      const g = gapsFor(r.geo, { id: u.unitId, s: u.s }, fresh.map((o) => ({ id: o.unitId, number: o.number, s: o.s })));
      return { from: u.number, to: g.ahead?.unit.number ?? null, minutes: g.ahead ? +(g.ahead.t / 60).toFixed(1) : null };
    }).filter((p) => p.to);
    const ok = pairs.filter((p) => p.minutes * 60 >= H * 0.5 && p.minutes * 60 <= H * 1.5).length;
    return {
      headwayMin: Math.round(H / 60),
      compliance: pairs.length ? Math.round((ok / pairs.length) * 100) : null,
      pairs,
      units: units.map((u) => ({
        ...this.publicUnit(u), km: +(u.km / 1000).toFixed(1), trips: u.trips,
        nearStop: r.stops[nearestStop(r.geo, u.d)]?.name, shiftId: u.shiftId,
      })),
    };
  }

  // ---- Transmisión (Server-Sent Events) ----
  addClient(res, routeId, isAdmin) {
    const c = { res, routeId: Number(routeId), isAdmin };
    this.clients.add(c);
    this.send(c, 'snapshot', this.snapshot(routeId));
    return () => this.clients.delete(c);
  }

  send(c, type, data) {
    c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  broadcast(routeId) {
    routeId = Number(routeId);
    if (this.pending.has(routeId)) return;
    const t = setTimeout(() => {
      this.pending.delete(routeId);
      const snap = this.snapshot(routeId);
      for (const c of this.clients) if (c.routeId === routeId) this.send(c, 'snapshot', snap);
    }, 800);
    t.unref?.();
    this.pending.set(routeId, t);
  }

  notifyAdmins(routeId, type, data) {
    for (const c of this.clients) if (c.isAdmin && c.routeId === Number(routeId)) this.send(c, type, data);
  }

  housekeeping() {
    for (const [id] of this.routes) this.broadcast(id);
    for (const c of this.clients) c.res.write(': ping\n\n');
  }

  close() {
    clearInterval(this.timer);
    this.sim?.stop();
    for (const c of this.clients) c.res.end();
  }
}

// Simulador: mueve unidades sin turno real por la ruta, para demostraciones.
export class Simulator {
  constructor(live, { speed = 1 } = {}) {
    this.live = live;
    this.speed = speed;
    this.ids = new Set();
    this.timer = null;
  }

  get running() { return !!this.timer; }

  start() {
    if (this.timer) return;
    this.live.sim = this;
    const db = this.live.db;
    for (const [routeId, r] of this.live.routes) {
      const units = db.prepare('SELECT * FROM units WHERE route_id = ? AND active = 1 ORDER BY number').all(routeId)
        .filter((u) => !this.live.units.has(u.id));
      const starts = [0.05, 0.09, 0.30, 0.52, 0.56, 0.80];
      units.forEach((u, i) => {
        const s = (starts[i % starts.length] + Math.floor(i / starts.length) * 0.03) * r.geo.LOOP;
        const st = {
          unitId: u.id, number: u.number, routeId, accessible: !!u.accessible, shiftId: null, driverId: null, sim: true,
          s, v: 7.2 * (0.92 + Math.random() * 0.16), dwell: 0, occN: 8 + Math.floor(Math.random() * 20),
          km: 0, trips: 0, terminals: 0, ts: Date.now(), hasFix: true, offRoute: false, dir: 0, d: 0,
        };
        this.place(st, r);
        this.live.units.set(u.id, st);
        this.ids.add(u.id);
      });
    }
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now(), dt = ((now - last) / 1000) * this.speed;
      last = now;
      this.tick(dt);
    }, 1000);
    this.timer.unref?.();
  }

  place(st, r) {
    const s = mod(st.s, r.geo.LOOP);
    st.s = s;
    st.dir = s <= r.geo.L ? 0 : 1;
    st.d = st.dir === 0 ? s : r.geo.LOOP - s;
    [st.lat, st.lng] = r.geo.pointAt(st.d);
    const ratio = st.occN / 40;
    st.occ = ratio < 0.45 ? 'vacia' : ratio < 0.85 ? 'media' : 'llena';
    st.ts = Date.now();
  }

  tick(dt) {
    const touched = new Set();
    for (const id of this.ids) {
      const st = this.live.units.get(id);
      if (!st || !st.sim) continue;
      const r = this.live.route(st.routeId);
      if (st.dwell > 0) { st.dwell -= dt; st.ts = Date.now(); continue; }
      const ds = st.v * dt;
      const stopsPos = r.stops.map((_, k) => [k === 0 ? 0 : k === r.stops.length - 1 ? r.geo.L : r.geo.stopD[k], k === 0 || k === r.stops.length - 1 ? null : r.geo.LOOP - r.geo.stopD[k]]).flat().filter((p) => p !== null);
      const hit = stopsPos.map((p) => mod(p - st.s, r.geo.LOOP)).filter((x) => x > 0 && x <= ds).sort((a, b) => a - b)[0];
      if (hit !== undefined) {
        st.s += hit; st.km += hit;
        const terminal = Math.abs(mod(st.s, r.geo.LOOP)) < 1 || Math.abs(mod(st.s, r.geo.LOOP) - r.geo.L) < 1;
        const down = terminal ? st.occN : Math.round(st.occN * (0.1 + Math.random() * 0.3));
        const up = Math.min(40 - (st.occN - down), Math.floor(Math.random() * 9));
        st.occN = st.occN - down + up;
        st.dwell = 10 + 2.2 * up + 0.8 * down + (terminal ? 90 : 0);
        if (terminal) { st.terminals++; st.trips = Math.floor(st.terminals / 2); }
      } else { st.s += ds; st.km += ds; }
      this.place(st, r);
      touched.add(st.routeId);
    }
    for (const id of touched) this.live.broadcast(id);
  }

  release(unitId) {
    if (this.ids.delete(unitId)) {
      const st = this.live.units.get(unitId);
      if (st?.sim) this.live.units.delete(unitId);
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const id of this.ids) {
      const st = this.live.units.get(id);
      if (st?.sim) { this.live.units.delete(id); this.live.broadcast(st.routeId); }
    }
    this.ids.clear();
  }
}
