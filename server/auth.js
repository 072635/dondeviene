import crypto from 'node:crypto';

const SESSION_DAYS = 30;
export const COOKIE = 'dv_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400e3;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, expires, secure) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
}

export const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, unitId: u.unit_id });

// Middleware: carga el usuario de la sesión (si hay) en req.user.
export function loadUser(db) {
  const q = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    // Web: cookie HttpOnly. App nativa: encabezado Authorization. Transmisión en vivo: ?token= (EventSource no envía encabezados).
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
    const queryToken = req.path === '/api/stream' && typeof req.query.token === 'string' ? req.query.token : null;
    const token = bearer || queryToken || parseCookies(req.headers.cookie)[COOKIE];
    req.sessionToken = token;
    req.user = token ? q.get(token, Date.now()) || null : null;
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Tu cuenta no tiene permiso para esto.' });
    next();
  };
}

// Límite simple de intentos de inicio de sesión por IP + correo.
export function makeLoginLimiter({ max = 10, windowMs = 15 * 60e3 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now - h.start > windowMs) return true;
      return h.count < max;
    },
    fail(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now - h.start > windowMs) hits.set(key, { start: now, count: 1 });
      else h.count++;
    },
    reset(key) { hits.delete(key); },
  };
}
