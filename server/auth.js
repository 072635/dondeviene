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

// Límite general de peticiones por IP (ventana fija). Frena abusos y bots que saturen la API.
export function makeRateLimit({ max, windowMs = 60e3 }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, h] of hits) if (now - h.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now(), key = req.ip;
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) { h = { start: now, count: 0 }; hits.set(key, h); }
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.' });
    }
    next();
  };
}

// Contraseñas que aparecen primero en las listas filtradas: se rechazan aunque tengan 8 caracteres.
const COMMON = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'password123', 'contraseña', 'contrasena', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'iloveyou',
  'teamo123', 'abc12345', 'abcd1234', '1q2w3e4r', 'aaaaaaaa', 'mexico123', 'cancun123', 'dondeviene', 'demo1234',
  'admin123', 'administrador', 'welcome1', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'pokemon1']);

export function passwordProblem(pw) {
  if (pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return 'Esa contraseña es muy común y fácil de adivinar. Elige otra.';
  return null;
}
