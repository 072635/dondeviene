// Mapa con Leaflet + OpenStreetMap: trazo de la ruta, paradas y unidades en vivo.
import { esc } from './ui.js';

const L = window.L;

export function createMap(el, route, { onStopClick } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#9D2449';
  let line = null, stopLayer = L.layerGroup().addTo(map);
  const buses = new Map();
  let selected = null;

  function setRoute(r) {
    // El mapa necesita una vista antes de dibujar capas.
    map.fitBounds(L.latLngBounds(r.path), { padding: [24, 24] });
    line?.remove();
    line = L.polyline(r.path, { color: accent, weight: 5, opacity: 0.85 }).addTo(map);
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
        m = L.marker([u.lat, u.lng], { icon, keyboard: false }).addTo(map);
        buses.set(u.id, m);
      } else {
        m.setLatLng([u.lat, u.lng]);
        m.setIcon(icon);
      }
      m.bindTooltip(esc(`Unidad ${u.number}${u.sim ? ' (demo)' : ''}`));
    }
    for (const [id, m] of buses) if (!seen.has(id)) { m.remove(); buses.delete(id); }
  }

  setRoute(route);
  setTimeout(() => map.invalidateSize(), 50);
  return { map, setRoute, setBuses, selectStop, destroy: () => map.remove() };
}

// Conexión en vivo a una ruta (Server-Sent Events) con reconexión automática del navegador.
export function subscribe(routeId, handlers) {
  const es = new EventSource(`/api/stream?route=${routeId}`);
  es.addEventListener('snapshot', (e) => handlers.snapshot?.(JSON.parse(e.data)));
  es.addEventListener('event', (e) => handlers.event?.(JSON.parse(e.data)));
  es.addEventListener('report', (e) => handlers.report?.(JSON.parse(e.data)));
  es.onopen = () => handlers.status?.(true);
  es.onerror = () => handlers.status?.(false);
  return () => es.close();
}
