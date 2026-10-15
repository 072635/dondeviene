// Ruta 2 · Zona Hotelera (trazo aproximado del Blvd. Kukulcán, de Av. Cobá a Punta Nizuc).
// Se reemplaza desde el panel de administración con un recorrido grabado por un conductor.
export const SEED_ROUTE = {
  code: 'R-2',
  name: 'Zona Hotelera · Centro ⟷ Punta Nizuc',
  path: [[21.1437,-86.8253],[21.1452,-86.8195],[21.1462,-86.8120],[21.1462,-86.8040],[21.1452,-86.7975],[21.1438,-86.7915],[21.1420,-86.7845],[21.1405,-86.7760],[21.1393,-86.7660],[21.1385,-86.7570],[21.1376,-86.7495],[21.1360,-86.7452],[21.1335,-86.7442],[21.1300,-86.7458],[21.1250,-86.7488],[21.1190,-86.7525],[21.1130,-86.7565],[21.1060,-86.7602],[21.0970,-86.7648],[21.0880,-86.7690],[21.0790,-86.7722],[21.0700,-86.7752],[21.0620,-86.7785],[21.0560,-86.7805],[21.0490,-86.7812],[21.0420,-86.7800],[21.0365,-86.7780],[21.0320,-86.7760]],
  stops: [
    { name: 'Av. Cobá (Centro)', km: 'Km 0', lat: 21.1437, lng: -86.8253 },
    { name: 'Playa Las Perlas', km: 'Km 2.5', lat: 21.1462, lng: -86.8115 },
    { name: 'Playa Langosta', km: 'Km 5', lat: 21.1440, lng: -86.7920 },
    { name: 'Playa Tortugas', km: 'Km 6.5', lat: 21.1420, lng: -86.7845 },
    { name: 'Playa Caracol', km: 'Km 8.5', lat: 21.1378, lng: -86.7500 },
    { name: 'Punta Cancún (Coco Bongo)', km: 'Km 9', lat: 21.1338, lng: -86.7443 },
    { name: 'Playa Chac Mool', km: 'Km 10', lat: 21.1290, lng: -86.7464 },
    { name: 'Plaza La Isla', km: 'Km 12.5', lat: 21.1130, lng: -86.7565 },
    { name: 'Kukulcán Plaza / Playa Marlín', km: 'Km 13', lat: 21.1060, lng: -86.7602 },
    { name: 'Playa Ballenas', km: 'Km 14.5', lat: 21.0950, lng: -86.7657 },
    { name: 'Playa Delfines / El Rey', km: 'Km 18', lat: 21.0590, lng: -86.7796 },
    { name: 'Punta Nizuc', km: 'Km 21', lat: 21.0320, lng: -86.7760 },
  ],
  units: [
    { number: '03' }, { number: '07' }, { number: '12', accessible: true },
    { number: '15' }, { number: '21', accessible: true }, { number: '28' },
  ],
};
