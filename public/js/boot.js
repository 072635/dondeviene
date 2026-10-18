// Arranque: carga el mapa vectorial (MapLibre, módulo) y su puente con Leaflet, y luego la app.
// Si algo falla, la app sigue funcionando con el mapa de mosaicos de respaldo.
try {
  window.maplibregl = await import('/vendor/maplibre/maplibre-gl.mjs');
  await new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/vendor/maplibre-leaflet/leaflet-maplibre-gl.js';
    s.onload = ok; s.onerror = fail;
    document.head.append(s);
  });
} catch { /* sin mapa vectorial */ }
await import('./app.js');
