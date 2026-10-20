import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { SEED_ROUTE, OLD_SEED_PATH } from './seed-data.js';

export function openDb(file = process.env.DB_FILE || path.join(process.cwd(), 'data', 'dondeviene.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stops (
      id INTEGER PRIMARY KEY,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      name TEXT NOT NULL,
      km TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      route_id INTEGER NOT NULL REFERENCES routes(id),
      plate TEXT,
      accessible INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT,
      pass TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('pasajero','conductor','admin')),
      unit_id INTEGER REFERENCES units(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY,
      unit_id INTEGER NOT NULL REFERENCES units(id),
      driver_id INTEGER NOT NULL REFERENCES users(id),
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      km REAL NOT NULL DEFAULT 0,
      trips INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS positions_shift ON positions(shift_id, ts);
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      route_id INTEGER REFERENCES routes(id),
      unit_id INTEGER REFERENCES units(id),
      stop_id INTEGER REFERENCES stops(id),
      reason TEXT NOT NULL,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','revisado','atendido')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      route_id INTEGER REFERENCES routes(id),
      unit_id INTEGER REFERENCES units(id),
      shift_id INTEGER REFERENCES shifts(id),
      kind TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info','warn','crit')),
      text TEXT NOT NULL,
      lat REAL,
      lng REAL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
  `);
  // Columnas agregadas después de la primera versión.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('requested_unit')) db.exec('ALTER TABLE users ADD COLUMN requested_unit TEXT');
  return db;
}

// Datos iniciales: la Ruta 2, sus unidades y la cuenta de administración.
export function seed(db, { adminEmail, adminPassword, demo }) {
  const now = Date.now();
  let route = db.prepare('SELECT id FROM routes WHERE code = ?').get(SEED_ROUTE.code);
  if (!route) {
    const r = db.prepare('INSERT INTO routes (code, name, path) VALUES (?, ?, ?)')
      .run(SEED_ROUTE.code, SEED_ROUTE.name, JSON.stringify(SEED_ROUTE.path));
    route = { id: Number(r.lastInsertRowid) };
    const ins = db.prepare('INSERT INTO stops (route_id, seq, name, km, lat, lng) VALUES (?, ?, ?, ?, ?, ?)');
    SEED_ROUTE.stops.forEach((s, i) => ins.run(route.id, i, s.name, s.km, s.lat, s.lng));
    const insU = db.prepare('INSERT INTO units (number, route_id, accessible) VALUES (?, ?, ?)');
    for (const u of SEED_ROUTE.units) insU.run(u.number, route.id, u.accessible ? 1 : 0);
  }

  // Actualiza el trazo aproximado de la primera versión al trazo real del boulevard (con sus paradas).
  const current = db.prepare('SELECT id, path FROM routes WHERE code = ?').get(SEED_ROUTE.code);
  if (current && current.path === JSON.stringify(OLD_SEED_PATH)) {
    db.prepare('UPDATE routes SET path = ? WHERE id = ?').run(JSON.stringify(SEED_ROUTE.path), current.id);
    const upd = db.prepare('UPDATE stops SET name = ?, km = ?, lat = ?, lng = ? WHERE route_id = ? AND seq = ?');
    SEED_ROUTE.stops.forEach((s, i) => upd.run(s.name, s.km, s.lat, s.lng, current.id, i));
  }

  const created = [];
  const addUser = (name, email, password, role, unitNumber) => {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return;
    const unit = unitNumber ? db.prepare('SELECT id FROM units WHERE number = ?').get(unitNumber) : null;
    db.prepare('INSERT INTO users (name, email, pass, role, unit_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email, hashPassword(password), role, unit ? unit.id : null, now);
    created.push({ email, role });
  };
  if (adminEmail && adminPassword) addUser('Administración', adminEmail, adminPassword, 'admin');
  if (demo) {
    addUser('Conductor Unidad 07', 'conductor07@demo.mx', 'demo1234', 'conductor', '07');
    addUser('Conductor Unidad 12', 'conductor12@demo.mx', 'demo1234', 'conductor', '12');
    addUser('Pasajero Demo', 'pasajero@demo.mx', 'demo1234', 'pasajero');
  }
  return created;
}
