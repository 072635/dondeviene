// Notificaciones push web: el servidor vigila el camión que el pasajero pidió y le avisa cuando está cerca,
// aunque tenga la app cerrada o el teléfono bloqueado.
import webpush from 'web-push';
import { etaToPoint } from '../public/js/geo.js';

const FRESH_MS = 2 * 60e3;     // una unidad sin señal en más de 2 min no cuenta
const TTL_MS = 90 * 60e3;      // un aviso pendiente caduca a la hora y media
const MAX_WATCHES = 5000;

// Solo se envían avisos a los servicios push de los navegadores (evita que el servidor haga peticiones a
// direcciones arbitrarias).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export function validSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const k = sub.keys || {};
  const b64 = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
  if (!b64.test(k.p256dh || '') || !b64.test(k.auth || '')) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

// Llaves VAPID: de las variables de entorno o, si no hay, se generan una vez y se guardan en la base de datos.
function vapidKeys(db) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get();
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

export class PushWatcher {
  constructor(db, live, { send, subject = 'mailto:admin@dondeviene.mx' } = {}) {
    this.live = live;
    this.keys = vapidKeys(db);
    this.watches = new Map(); // id del teléfono -> aviso pendiente
    this.send = send || ((sub, payload) => webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey }, TTL: 120, urgency: 'high',
    }));
    this.timer = setInterval(() => this.check(), 5000);
    this.timer.unref?.();
  }

  get publicKey() { return this.keys.publicKey; }

  watch(id, w) {
    if (!this.watches.has(id) && this.watches.size >= MAX_WATCHES) return false;
    this.watches.set(id, { ...w, created: Date.now() });
    return true;
  }

  cancel(id) { this.watches.delete(id); }

  // Revisa cada aviso pendiente y manda la notificación cuando la unidad está a los minutos pedidos o menos.
  check() {
    const now = Date.now();
    for (const [id, w] of this.watches) {
      if (now - w.created > TTL_MS) { this.watches.delete(id); continue; }
      const r = this.live.route(w.routeId);
      if (!r) { this.watches.delete(id); continue; }
      const fresh = [...this.live.units.values()].filter((u) => u.routeId === w.routeId && u.hasFix && !u.offRoute && now - u.ts < FRESH_MS);
      // La unidad elegida; si terminó su turno, la que llegue primero.
      const own = fresh.find((u) => u.unitId === w.unitId);
      const cands = (own ? [own] : fresh).map((u) => ({ u, eta: etaToPoint(r.geo, u, w.d, w.dir).eta }));
      if (!cands.length) continue;
      const best = cands.reduce((a, b) => (b.eta < a.eta ? b : a));
      if (best.eta > w.minutes * 60) continue;
      this.watches.delete(id);
      const min = Math.max(1, Math.round(best.eta / 60));
      const body = best.eta < 45 ? `La Unidad ${best.u.number} está llegando a ${w.label}.` : `La Unidad ${best.u.number} llega en ~${min} min a ${w.label}.`;
      Promise.resolve(this.send(w.sub, { title: '¡Ya viene tu camión!', body, tag: 'dv-llegada', url: '/' }))
        .catch(() => { /* suscripción vencida o servicio caído: el aviso ya se quitó */ });
    }
  }

  close() { clearInterval(this.timer); }
}
