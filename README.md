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
| `SIM` | `0` arranca sin unidades simuladas | `1` |
| `SIM_SPEED` | Acelera el simulador (por ejemplo `10`) | `1` |
| `NODE_ENV` | `production` marca la cookie de sesión como segura (HTTPS) | — |

**Para operar de verdad:** usa `DEMO=0`, una `ADMIN_PASSWORD` fuerte y HTTPS. Los celulares solo comparten la ubicación GPS con páginas que usan HTTPS.

## Publicarla en internet

La forma más simple es **Render** (render.com):

1. Sube este proyecto a un repositorio de GitHub.
2. En Render elige **New → Blueprint** y selecciona el repositorio. El archivo `render.yaml` ya trae todo configurado, incluido un disco para que la base de datos no se borre.
3. Escribe la `ADMIN_PASSWORD` cuando Render te la pida.
4. Render te da una dirección con HTTPS, por ejemplo `https://dondeviene.onrender.com`.

También funciona con Docker en cualquier servidor:

```bash
docker build -t dondeviene .
docker run -p 3000:3000 -v dondeviene-datos:/app/data -e ADMIN_PASSWORD=... -e DEMO=0 dondeviene
```

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

## Limitación importante del GPS

Una app web solo puede enviar la ubicación **mientras está abierta en pantalla**. La app pide al celular que no apague la pantalla durante el turno, pero si el conductor cambia de app o bloquea el teléfono, la ubicación deja de enviarse hasta que vuelva.

Para el piloto basta con un soporte y un cargador en cada unidad. Para operar a escala conviene empaquetarla como app nativa (por ejemplo con Capacitor), que sí puede enviar la ubicación en segundo plano. Esa versión nativa es también la que se sube a App Store y Google Play.

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
