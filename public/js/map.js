// Mapa con Leaflet + OpenStreetMap: trazo de la ruta, paradas y unidades en vivo.
import { esc, API_BASE, getToken } from './ui.js';
import { makeRoute } from './geo.js';

const L = window.L;

// Mapa base vectorial de OpenFreeMap (gratuito, sin clave, datos de OpenStreetMap). En teléfonos sin
// WebGL se usa el mapa de mosaicos de OpenStreetMap como respaldo.
function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

function addBaseMap(map) {
  const osm = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  if (window.maplibregl && L.maplibreGL && webglOk()) {
    L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: `<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ${osm}`,
    }).addTo(map);
    return;
  }
  L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    maxZoom: 19, subdomains: 'abc', attribution: `${osm} · OSM France`,
  }).addTo(map);
}

export function createMap(el, route, { onStopClick } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  addBaseMap(map);

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#9D2449';
  let line = null, stopLayer = L.layerGroup().addTo(map);
  const waitLayer = L.layerGroup().addTo(map);
  const buses = new Map();
  let selected = null, geo = null, meMarker = null, meRing = null;

  function setRoute(r) {
    geo = makeRoute(r.path, r.stops);
    // El mapa necesita una vista antes de dibujar capas.
    map.fitBounds(L.latLngBounds(r.path), { padding: [24, 24] });
    line?.remove();
    // La línea no captura toques: así tocar sobre la ruta llega al mapa (p. ej. para agregar una parada).
    line = L.polyline(r.path, { color: accent, weight: 5, opacity: 0.85, interactive: false }).addTo(map);
    stopLayer.clearLayers();
    r.stops.forEach((s, k) => {
      const m = L.circleMarker([s.lat, s.lng], { radius: 6, color: accent, weight: 2, fillColor: '#FFFFFF', fillOpacity: 1 })
        .bindTooltip(esc(`${s.km ? s.km + ' · ' : ''}${s.name}`), { direction: 'top' });
      if (onStopClick) m.on('click', () => onStopClick(k));
      m.addTo(stopLayer);
      s._marker = m;
    });
  }

  function selectStop(k, r) {
    if (selected) selected.setStyle({ fillColor: '#FFFFFF', radius: 6 });
    selected = r.stops[k]?._marker || null;
    selected?.setStyle({ fillColor: '#E3BC7A', radius: 9 });
  }

  function setBuses(units, { mine } = {}) {
    const seen = new Set();
    for (const u of units) {
      seen.add(u.id);
      const cls = `bus-marker ${u.stale ? 'stale' : u.occ}${u.id === mine ? ' mine' : ''}`;
      const icon = L.divIcon({ className: '', html: `<div class="${cls}">${esc(u.number)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      let m = buses.get(u.id);
      if (!m) {
        // bubblingMouseEvents: un toque sobre un camión también llega al mapa.
        m = L.marker([u.lat, u.lng], { icon, keyboard: false, bubblingMouseEvents: true }).addTo(map);
        buses.set(u.id, m);
      } else {
        m.setLatLng([u.lat, u.lng]);
        m.setIcon(icon);
      }
      m.bindTooltip(esc(`Unidad ${u.number}${u.sim ? ' (demo)' : ''}`));
    }
    for (const [id, m] of buses) if (!seen.has(id)) { m.remove(); buses.delete(id); }
  }

  // Puntos donde alguien espera (anónimos, sobre la ruta).
  function setWaiting(list = []) {
    waitLayer.clearLayers();
    for (const w of list) {
      L.circleMarker(geo.pointAt(w.d), { radius: 7, color: '#6F1A33', weight: 2, fillColor: '#E3BC7A', fillOpacity: 1 })
        .bindTooltip('Alguien espera aquí').addTo(waitLayer);
    }
  }

  // Ubicación del propio pasajero.
  function setMe(lat, lng, accuracy, { center = false } = {}) {
    if (lat == null) { meMarker?.remove(); meRing?.remove(); meMarker = meRing = null; return; }
    if (!meMarker) {
      meRing = L.circle([lat, lng], { radius: accuracy || 30, color: '#1E6FD9', weight: 1, fillOpacity: 0.12 }).addTo(map);
      meMarker = L.circleMarker([lat, lng], { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1E6FD9', fillOpacity: 1 })
        .bindTooltip('Tú').addTo(map);
    } else {
      meMarker.setLatLng([lat, lng]); meRing.setLatLng([lat, lng]); meRing.setRadius(accuracy || 30);
    }
    if (center) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }

  setRoute(route);
  setTimeout(() => map.invalidateSize(), 50);
  return { map, setRoute, setBuses, setWaiting, setMe, selectStop, destroy: () => map.remove() };
}

// Conexión en vivo a una ruta (Server-Sent Events) con reconexión automática del navegador.
export function subscribe(routeId, handlers) {
  const tok = getToken();
  const es = new EventSource(`${API_BASE}/api/stream?route=${routeId}${tok ? `&token=${encodeURIComponent(tok)}` : ''}`);
  es.addEventListener('snapshot', (e) => handlers.snapshot?.(JSON.parse(e.data)));
  es.addEventListener('event', (e) => handlers.event?.(JSON.parse(e.data)));
  es.addEventListener('report', (e) => handlers.report?.(JSON.parse(e.data)));
  es.onopen = () => handlers.status?.(true);
  es.onerror = () => handlers.status?.(false);
  return () => es.close();
}
