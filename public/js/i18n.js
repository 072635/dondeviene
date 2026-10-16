import { store } from './ui.js';

// Textos para pasajeros (ES / EN para turistas).
const T = {
  es: {
    tagline: 'Tu camión, en tiempo real.', login: 'Entrar', register: 'Crear cuenta', email: 'Correo', password: 'Contraseña',
    name: 'Nombre', phone: 'Teléfono (opcional)', guest: 'Solo quiero ver dónde viene', guestBtn: 'Continuar sin cuenta',
    logout: 'Salir', account: 'Mi cuenta',
    whereAt: '¿En qué parada estás?', whereTo: '¿Hacia dónde vas?', toB: '→ {b}', toA: '← {a}',
    nextBus: 'Próxima unidad', unit: 'Unidad', arriving: 'Llegando', atStop: 'Está en tu parada', kmAway: 'a {km} km sobre la ruta',
    acc: 'Rampa', noBuses: 'No hay unidades en servicio en este momento.', noSignal: 'Sin señal',
    vacia: 'Vacía', media: 'Media', llena: 'Llena',
    allFull: 'Las próximas vienen llenas', allFullB: ' Si tienes prisa, te conviene pedir un taxi o Uber.',
    nextFull: 'La próxima viene llena', nextFullFar: ' La siguiente con lugar (Unidad {u}) llega en {m} min. Si tienes prisa, considera un taxi o Uber.',
    nextFullNear: ' Espera la Unidad {u}: llega en {m} min y trae lugar.', wait: 'Falta un rato', waitB: ' La próxima llega en {m} min.',
    good: 'Te conviene esperar', goodB: ' La Unidad {u} trae lugar.',
    freq: '{n} unidades en servicio', freq1: '1 unidad en servicio', notify: 'Avísame cuando esté a 3 min', notifyOn: 'Te avisaremos cuando la Unidad {u} esté a 3 min · Cancelar',
    notifyMsg: 'La Unidad {u} llega en ~3 min a {s}', reportT: 'Reportar un problema', whichUnit: '¿Qué unidad?', send: 'Enviar reporte',
    comment: 'Comentario (opcional)', loginToReport: 'Inicia sesión para enviar reportes.',
    r_no_se_detuvo: 'No se detuvo', r_manejo_peligroso: 'Manejo peligroso', r_cobro_incorrecto: 'Cobro incorrecto',
    r_sin_aire_sucia: 'Sin aire / sucia', r_mal_trato: 'Mal trato', r_otro: 'Otro', pick: 'Elige un motivo.', sent: 'Reporte enviado. Gracias.',
    live: 'En vivo', reconnecting: 'Reconectando…',
    modeGps: 'Mi ubicación', modeStop: 'Elegir parada', locating: 'Buscando tu ubicación…',
    nearRoute: 'Estás cerca de {stop}, a {m} m de la ruta. Calculamos la llegada a tu punto.',
    farRoute: 'Estás a {km} km de la ruta. Calculamos la llegada al punto más cercano, cerca de {stop}.',
    gpsDenied: 'No tenemos permiso para ver tu ubicación. Actívalo en tu navegador o elige una parada.',
    gpsNone: 'No pudimos obtener tu ubicación. Revisa que el GPS esté encendido o elige una parada.',
    yourPoint: 'tu ubicación', atPoint: 'Está llegando a tu punto',
    waitBtn: 'Estoy esperando aquí', waitOn: 'Avisando a los conductores · Cancelar',
    waitHint: 'Los conductores verán que alguien espera en este punto. No ven tu nombre.',
    waitServed: 'La Unidad {u} ya pasó por tu punto.',
  },
  en: {
    tagline: 'Your bus, in real time.', login: 'Sign in', register: 'Create account', email: 'Email', password: 'Password',
    name: 'Name', phone: 'Phone (optional)', guest: 'Just want to see where the bus is?', guestBtn: 'Continue without an account',
    logout: 'Sign out', account: 'My account',
    whereAt: 'Which stop are you at?', whereTo: 'Where are you going?', toB: '→ {b}', toA: '← {a}',
    nextBus: 'Next bus', unit: 'Bus', arriving: 'Arriving', atStop: 'At your stop now', kmAway: '{km} km away along the route',
    acc: 'Ramp', noBuses: 'No buses are running right now.', noSignal: 'No signal',
    vacia: 'Empty', media: 'Half full', llena: 'Full',
    allFull: 'The next buses are full', allFullB: ' If you are in a hurry, a taxi or Uber is your best option.',
    nextFull: 'The next bus is full', nextFullFar: ' The next one with room (Bus {u}) arrives in {m} min. If you are in a hurry, consider a taxi or Uber.',
    nextFullNear: ' Wait for Bus {u}: it arrives in {m} min and has room.', wait: 'It will be a while', waitB: ' The next bus arrives in {m} min.',
    good: 'Worth the wait', goodB: ' Bus {u} has room.',
    freq: '{n} buses running', freq1: '1 bus running', notify: 'Alert me 3 min before it arrives', notifyOn: 'We will alert you when Bus {u} is 3 min away · Cancel',
    notifyMsg: 'Bus {u} arrives at {s} in ~3 min', reportT: 'Report a problem', whichUnit: 'Which bus?', send: 'Send report',
    comment: 'Comment (optional)', loginToReport: 'Sign in to send reports.',
    r_no_se_detuvo: "Didn't stop", r_manejo_peligroso: 'Unsafe driving', r_cobro_incorrecto: 'Wrong fare',
    r_sin_aire_sucia: 'No A/C / dirty', r_mal_trato: 'Rude treatment', r_otro: 'Other', pick: 'Choose a reason.', sent: 'Report sent. Thank you.',
    live: 'Live', reconnecting: 'Reconnecting…',
    modeGps: 'My location', modeStop: 'Pick a stop', locating: 'Finding your location…',
    nearRoute: 'You are near {stop}, {m} m from the route. Arrival times are for your spot.',
    farRoute: 'You are {km} km from the route. Arrival times are for the closest point, near {stop}.',
    gpsDenied: 'We are not allowed to see your location. Turn it on in your browser or pick a stop.',
    gpsNone: 'We could not get your location. Check that GPS is on or pick a stop.',
    yourPoint: 'your spot', atPoint: 'Arriving at your spot',
    waitBtn: "I'm waiting here", waitOn: 'Letting drivers know · Cancel',
    waitHint: 'Drivers will see that someone is waiting at this spot. They do not see your name.',
    waitServed: 'Bus {u} already passed your spot.',
  },
};

let lang = store('dv-lang') === 'en' ? 'en' : 'es';
export const getLang = () => lang;
export function setLang(l) { lang = l === 'en' ? 'en' : 'es'; store('dv-lang', lang); document.documentElement.lang = lang; }
export const t = (k, v = {}) => (T[lang][k] ?? T.es[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
document.documentElement.lang = lang;
