// Arma la carpeta www/ que se empaqueta dentro de la app nativa: la app web + Leaflet.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'leaflet', 'dist'), path.join(out, 'vendor', 'leaflet'), { recursive: true });
// El service worker es solo para la versión web.
fs.rmSync(path.join(out, 'sw.js'), { force: true });
// La app no se incluye a sí misma.
fs.rmSync(path.join(out, 'descargas'), { recursive: true, force: true });

const apiBase = process.env.API_BASE;
if (apiBase) {
  fs.writeFileSync(path.join(out, 'config.js'), `window.DV_CONFIG = { apiBase: ${JSON.stringify(apiBase)} };\n`);
}
const cfg = fs.readFileSync(path.join(out, 'config.js'), 'utf8');
console.log(`www/ listo. Servidor de la app: ${/apiBase:\s*['"]([^'"]+)/.exec(cfg)?.[1]}`);
