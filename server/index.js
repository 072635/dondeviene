import { openDb, seed } from './db.js';
import { Live, Simulator } from './live.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const DEMO = process.env.DEMO !== '0';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dondeviene.mx';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (DEMO ? 'admin1234' : '');

if (!process.env.ADMIN_PASSWORD && !DEMO) {
  console.error('Falta ADMIN_PASSWORD. Define la contraseña de la cuenta de administración.');
  process.exit(1);
}

const db = openDb();
const created = seed(db, { adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, demo: DEMO });
const live = new Live(db);

// Recupera los turnos que seguían abiertos si el servidor se reinició.
for (const shift of db.prepare('SELECT * FROM shifts WHERE ended_at IS NULL').all()) {
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(shift.unit_id);
  if (unit) live.restore(unit, shift);
}

const simulator = new Simulator(live, { speed: Number(process.env.SIM_SPEED) || 1 });
// Unidades simuladas: activas en demo, o en producción con SIM=1 (para presentaciones; se apagan desde el Tablero).
if (process.env.SIM === '1' || (DEMO && process.env.SIM !== '0')) simulator.start();

const app = createApp({ db, live, simulator, demo: DEMO, secureCookies: process.env.NODE_ENV === 'production' });
const server = app.listen(PORT, () => {
  console.log(`¿Dónde Viene? escuchando en http://localhost:${PORT}`);
  if (created.length) console.log('Cuentas creadas:', created.map((c) => `${c.email} (${c.role})`).join(', '));
  if (DEMO) console.log('Modo demo activo: hay cuentas de prueba y unidades simuladas. Usa DEMO=0 en producción.');
});

const shutdown = () => { live.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
