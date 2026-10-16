# ¿Dónde Viene?

Transporte público en tiempo real para la Ruta 2 (Zona Hotelera, Cancún):

- **Pasajeros** ven dónde viene cada unidad, cuánto falta y qué tan llena viene, en español o inglés. Pueden pedir un aviso cuando falten 3 minutos y reportar problemas.
- **Conductores** inician su turno y la app usa el GPS del celular. Ven a cuántos minutos van de la unidad de adelante y de la de atrás, marcan la ocupación, avisan a la ruta y tienen un botón de emergencia.
- **Administración** ve un tablero con unidades en servicio, cumplimiento de frecuencia, km recorridos, avisos y reportes. Desde ahí da de alta unidades y conductores y edita la ruta.

## Requisitos

- Node.js 22.13 o más reciente. La base de datos es SQLite y ya viene en Node, así que no se instala nada más.

## Arrancar en tu computadora

```bash
npm install
npm start
```

Abre http://localhost:3000.

En **modo demo**, que es el modo por defecto, se crean estas cuentas de prueba y hay 6 unidades simuladas moviéndose por la ruta:

| Cuenta | Contraseña | Rol |
|---|---|---|
| admin@dondeviene.mx | admin1234 | Administración |
| conductor07@demo.mx | demo1234 | Conductor (Unidad 07) |
| conductor12@demo.mx | demo1234 | Conductor (Unidad 12) |
| pasajero@demo.mx | demo1234 | Pasajero |

Las unidades simuladas se apagan desde el Tablero, en la casilla "Unidades de demostración".

## Configuración

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `DB_FILE` | Archivo de la base de datos | `data/dondeviene.db` |
| `ADMIN_EMAIL` | Correo de la cuenta de administración | `admin@dondeviene.mx` |
| `ADMIN_PASSWORD` | Contraseña de esa cuenta. Es obligatoria con `DEMO=0` | `admin1234` solo en demo |
| `DEMO` | `0` desactiva las cuentas de prueba y el simulador | `1` |
| `SIM` | `1` muestra unidades simuladas aunque `DEMO=0`; `0` las desactiva | igual que `DEMO` |
| `SIM_SPEED` | Acelera el simulador (por ejemplo `10`) | `1` |
| `NODE_ENV` | `production` marca la cookie de sesión como segura (HTTPS) | — |

**Para operar de verdad:** usa `DEMO=0`, una `ADMIN_PASSWORD` fuerte y HTTPS. Los celulares solo comparten la ubicación GPS con páginas que usan HTTPS.

## Publicarla en internet

La forma más simple es **Render** (render.com):

1. Sube este proyecto a un repositorio de GitHub.
2. En Render elige **New → Blueprint** y selecciona el repositorio. El archivo `render.yaml` usa el **plan gratis**: sirve para probar, pero la app se duerme tras 15 minutos sin uso y los datos se borran al reiniciar. Para operar con conductores reales cambia a `plan: starter` y activa el disco que está comentado en ese archivo.
3. Escribe la `ADMIN_PASSWORD` cuando Render te la pida.
4. Render te da una dirección con HTTPS, por ejemplo `https://dondeviene.onrender.com`.

También funciona con Docker en cualquier servidor:

```bash
docker build -t dondeviene .
docker run -p 3000:3000 -v dondeviene-datos:/app/data -e ADMIN_PASSWORD=... -e DEMO=0 dondeviene
```

## Agregar más rutas

Desde **Administración → Ruta**:

1. Toca **Dibujar trazo nuevo** y marca en el mapa, en orden, el inicio, algunos puntos del camino (uno en cada vuelta importante) y el final.
2. Escribe la clave (por ejemplo `R-1`) y el nombre, y toca **Crear ruta**. La app traza el camino por las calles reales con OSRM (datos de OpenStreetMap) y avisa si el trazo da una vuelta en U, que suele ser un punto en el carril contrario.
3. Con **Agregar parada tocando el mapa**, toca dónde para la unidad. La parada se acomoda sobre la ruta con su kilómetro.
4. En **Unidades**, cambia cada camión a su ruta.

También se puede usar como trazo el recorrido GPS de un conductor que hizo una vuelta completa.

El trazado usa el servidor público y gratuito de OSRM. Para operar a escala conviene uno propio o de pago: se configura con la variable `OSRM_URL`.

## Instalarla en el celular

Es una app web instalable (PWA):

- **Android (Chrome):** abre la dirección y toca **Instalar app**.
- **iPhone (Safari):** Compartir → **Agregar a inicio**.

Queda con su ícono en la pantalla de inicio y se abre a pantalla completa.

## Puesta en marcha con conductores reales

1. Entra como administración, abre **Personal** y crea una cuenta para cada conductor con su unidad asignada.
2. **Grabar la ruta real:** un conductor hace una vuelta completa con la app. En **Ruta → Trazo desde un recorrido grabado**, elige su turno y toca **Usar como trazo**.
3. En **Ruta → Paradas**, corrige los nombres y las coordenadas con las paradas oficiales.
4. Apaga las unidades de demostración en el Tablero.

## App nativa (Android y iPhone)

La carpeta `android/` y la carpeta `ios/` tienen la app nativa hecha con Capacitor. Usa las mismas pantallas que la web y agrega el **GPS en segundo plano**: el conductor puede bloquear el teléfono y la ubicación se sigue enviando, con un aviso fijo de "Turno activo" en la barra de notificaciones. La ubicación se apaga sola al terminar el turno.

1. Publica el servidor y escribe su dirección en `public/config.js` (`apiBase`).
2. `npm run native:build` copia la app web a los proyectos nativos.
3. **Android:** `npm run android:apk` genera un APK de prueba en `android/app/build/outputs/apk/debug/`. Para Google Play, abre `android/` en Android Studio, crea tu firma (Build → Generate Signed Bundle) y sube el `.aab`.
4. **iPhone:** en una Mac con Xcode abre `ios/App/App.xcodeproj`, elige tu equipo de Apple Developer y usa Product → Archive.

Los permisos ya están configurados: ubicación, servicio en primer plano de tipo ubicación y notificaciones en Android; `UIBackgroundModes: location` y los textos de permiso en iPhone.

La app nativa inicia sesión con un token que se guarda en el teléfono; la web sigue usando una cookie que JavaScript no puede leer.

## Limitación del GPS en la versión web

Si se usa desde el navegador (no la app nativa), solo puede enviar la ubicación **mientras está abierta en pantalla**. La app pide al celular que no apague la pantalla durante el turno, pero si el conductor cambia de app o bloquea el teléfono, la ubicación deja de enviarse hasta que vuelva.

La app nativa no tiene esta limitación.

## Pruebas

```bash
npm test
```

## Estructura

```
server/        API (Express), sesiones, base de datos, seguimiento en vivo y simulador
public/        App web: pasajero, conductor y administración (JavaScript sin compilación)
public/js/geo.js  Cálculos de ruta compartidos entre servidor y navegador
test/          Pruebas de la API y de los cálculos
```
