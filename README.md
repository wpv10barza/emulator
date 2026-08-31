# Emulador Ubuntu del panel ESP32-S3-4848S040

Repositorio independiente dedicado exclusivamente a pruebas reproducibles del
panel cuadrado **ESP32-S3-4848S040** y su pantalla táctil virtual de **480 ×
480 px**. Replica la interfaz descrita por el firmware de `esp32-3C`, ejecuta el
contrato HTTP de `asistente-3c` y genera registros de terminal para las figuras
del Capítulo III de la tesis.

> **Clasificación de la evidencia:** emulación funcional y compilación. Las
> capturas no constituyen validación física del LCD ST7701, táctil GT911,
> PSRAM, retroiluminación, audio ni GPIO.

## Qué incluye

- pantalla virtual 480 × 480 con botones `PROBAR WSL` y `ENVIAR 3C`;
- estados `INICIANDO`, `SIN CONEXION`, `WSL DISPONIBLE`, `PROCESANDO`,
  `ESPERA CONFIRMACION`, `CAMBIO APLICADO`, `ORDEN CANCELADA` y `ERROR`;
- proxy local que conserva el contrato del dispositivo y evita exponer el
  token en el navegador;
- backend simulado determinista para pruebas sin Gemini ni Google Sheets;
- pruebas unitarias y E2E en Ubuntu;
- generación de `evidence.json`, registro del terminal, manifiesto SHA-256,
  cuatro figuras SVG editables y exportaciones PNG a 300 ppp en CI;
- GitHub Actions que vuelve a probar `asistente-3c@4d32308` y compila
  `esp32-3C@2ebac82` para `panel_4848s040`;
- artefactos descargables con registros, figuras y binarios del firmware.

## Ejecución rápida en Ubuntu o WSL

```bash
git clone https://github.com/wpv10barza/emulator.git
cd emulator
npm ci
npm test
npm run evidence
```

Los resultados se guardan en `artifacts/`. Para abrir la interfaz:

```bash
ESP32_API_TOKEN='token-local' npm run mock
```

En otra terminal:

```bash
ESP32_API_TOKEN='token-local' \
ASSISTANT_BASE_URL='http://127.0.0.1:3000' \
npm start
```

El servidor escucha en `0.0.0.0`, entrega cada recurso con `Content-Length` y
corta las consultas al backend después de cinco segundos. Primero compruebe el
servicio dentro de Ubuntu/WSL:

```bash
curl --max-time 3 http://127.0.0.1:8080/healthz
npm run doctor
```

`npm run doctor` distingue entre tres situaciones: servicio no iniciado,
servicio disponible solo dentro de WSL y reenvío Windows→WSL operativo. También
muestra las direcciones IPv4 directas que puede abrir desde Windows.

### Acceso desde Windows, WSL o Dev Containers

Si Chrome queda esperando y la terminal del servidor **no muestra `GET /`**, la
solicitud no llegó al proceso Node.js. No es una lentitud de la página: falta el
túnel entre Windows y WSL/Dev Container. En VS Code:

1. Abra la carpeta desde WSL con `code ~/projects/emulator`.
2. Seleccione la pestaña **Ports** junto a **Terminal**.
3. Pulse **Forward a Port**, escriba `8080` y elija **Open in Browser**.
4. Use la dirección local que muestre VS Code; normalmente será
   `http://127.0.0.1:8080`.

El repositorio incluye `.vscode/settings.json` para reenviar automáticamente
los puertos 8080 y 3000 al abrir la carpeta en una ventana remota. Si el reenvío
automático no está disponible, abra desde Windows una de las URL directas que
imprime `npm start` o `npm run doctor`, por ejemplo
`http://172.x.x.x:8080`.

Una respuesta válida de la página debe incluir `HTTP/1.1 200 OK` y
`content-length`:

```bash
curl --max-time 3 -I http://127.0.0.1:8080/
```

## Conexión con Asistente 3C real

Inicie `asistente-3c` en el puerto 3000 y configure el mismo
`ESP32_API_TOKEN` en ambos procesos. El emulador utiliza:

- `GET /api/device/v1/health`;
- `POST /api/device/v1/commands`;
- `GET /api/device/v1/commands/{command_id}`.

La respuesta `202` queda en `pending_confirmation`. La escritura externa solo
puede producirse después de una confirmación humana en Asistente 3C; las
pruebas automáticas de este repositorio utilizan únicamente el backend
simulado y no acceden a Google Sheets.

## Evidencias para la lista maestra de figuras

| Archivo o captura | Uso | Clasificación |
|---|---|---|
| `screens/01_ready.svg` | Conexión del panel con WSL | Emulación funcional |
| `screens/02_pending.svg` | Solicitud pendiente | Emulación funcional |
| `screens/03_applied.svg` | Resultado aplicado | Emulación funcional |
| `screens/04_rejected.svg` | Resultado rechazado | Escenario emulado |
| `ubuntu-terminal.log` | Secuencia HTTP completa | Evidencia de software |
| `panel-4848s040-build.log` | Compilación PlatformIO | Evidencia de compilación |
| binarios `.bin` | Artefacto reproducible | Compilado, no flasheado |

Rótulo recomendado para las figuras:

> Captura obtenida mediante emulación funcional del panel
> ESP32-S3-4848S040 en Ubuntu. No constituye validación física del ST7701 o
> GT911.

## Fuentes fijadas

- `wpv10barza/esp32-3C@2ebac82166ab8044e0ea8ab1ef0e3bdfe60ad943`
- `wpv10barza/asistente-3c@4d323083de83c0618d848ff514607d50bacd8012`

No se incluyen credenciales, archivos `.env`, datos de Google Sheets ni
resultados experimentales del Capítulo IV.
