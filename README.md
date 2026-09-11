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
- backend real integrado para localizar una tarea por `Nombre`/`TareaId`,
  mostrar el cambio `Frecuencia`/`UnidadTiempo` y escribirlo en Google Sheets
  únicamente después de confirmar en el emulador;
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

La configuración de reenvío solo se aplica cuando VS Code está conectado
realmente a WSL o al contenedor. Elegir el perfil de terminal `wsl` dentro de
una ventana local de Windows **no** convierte esa ventana en remota.

Antes de diagnosticar, confirme que la copia local fue actualizada y reinicie
los procesos antiguos:

```bash
cd ~/projects/emulator
git pull --ff-only origin main
git rev-parse --short HEAD
npm test
```

La versión corregida ejecuta once pruebas. Si todavía aparecen cinco, se está
ejecutando una copia o un proceso anterior.

#### Ventana remota WSL

Abra el repositorio desde una terminal WSL con `code .` y compruebe que la
esquina inferior izquierda de VS Code muestre `WSL: <distribución>`. El archivo
`.vscode/settings.json` reenvía 8080 y 3000. Ya no exige que 8080 esté libre:
si hay un túnel obsoleto, VS Code puede asignar otro puerto local y mostrarlo en
la pestaña **Ports**. Use **Open in Browser** sobre la fila del emulador.

#### Dev Container

El repositorio incluye `.devcontainer/devcontainer.json` con
`forwardPorts: [8080, 3000]`. Ejecute **Dev Containers: Rebuild and Reopen in
Container** para aplicar la configuración; luego abra el puerto desde
**Ports**. No basta con abrir una terminal llamada `wsl` en una ventana local.

#### Puente de respaldo para una ventana local con terminal WSL

Si no desea reabrir VS Code en modo remoto, mantenga `npm start` ejecutándose
y, en otra terminal WSL del repositorio, ejecute:

```bash
npm run wsl:forward
```

Windows solicitará autorización de administrador y creará únicamente el puente
de *loopback* `127.0.0.1:18080 → WSL:8080`. Después abra:

```text
http://127.0.0.1:18080
```

El puerto 18080 evita competir con el túnel 8080 que quedó abierto y sin
respuesta en la captura. Para usar otro puerto local:

```bash
npm run wsl:forward -- --listen-port=18081
```

Compruebe en cualquier momento el servicio interno, el acceso desde Windows y
las direcciones directas con:

```bash
curl --max-time 3 http://127.0.0.1:8080/healthz
npm run doctor
```

El diagnóstico solo acepta como válida la respuesta JSON del emulador; un
`HTTP 200` perteneciente a otro proceso no se considera éxito.

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

## Backend real consolidado en este repositorio

`asistente-3c` confirmó el contrato y la lógica de búsqueda/escritura. Para
evitar depender de otra ventana y de Gemini en una orden de frecuencia, este
repositorio incorpora un backend determinista equivalente para Google Sheets.
El flujo es:

```text
emulador:8080 -> backend-real:3000 -> vista previa de Data -> confirmar -> escritura L:M -> lectura de verificación
```

La orden verificada es:

```text
Cambia la Inspección de los paneles de distribución LP & DP :) a bimestral
```

Se interpreta como `Frecuencia=2` y `UnidadTiempo=Mes`. El backend audita
primero que E/F/L/M/AF sean `TareaId`, `Nombre`, `Frecuencia`, `UnidadTiempo` y
`Eliminar`; localiza una sola fila; presenta los valores anterior/nuevo; y
vuelve a leer la fila antes y después de escribir. Si AF contiene `X`, muestra
una advertencia que debe aceptarse expresamente.

### Preparación local segura

La cuenta de servicio debe tener permiso de **Editor** sobre la hoja. Guarde su
JSON fuera del repositorio y no lo copie a GitHub:

```bash
cd ~/projects/emulator
git pull --ff-only origin main
npm ci
cp -n .env.example .env
nano .env
```

Configure en `.env` una ruta absoluta de WSL, el ID de la hoja y un token local:

```env
GOOGLE_APPLICATION_CREDENTIALS=/mnt/c/ruta/privada/service-account.json
SPREADSHEET_ID=reemplazar-por-id-de-la-hoja
SHEET_NAME=Data
HEADER_ROW=4
ESP32_API_TOKEN=un-token-local-largo
```

La forma recomendada inicia ambos servicios en una sola terminal y reemplaza
automáticamente cualquier `ASSISTANT_BASE_URL` antiguo de WSL:

```bash
set -a; source .env; set +a
npm run real:stack
```

El comando fija internamente `127.0.0.1:3000`, espera hasta 15 segundos las
operaciones de Google Sheets y detiene ambos procesos al pulsar `Ctrl+C`.
Si ya existe un backend compatible en el puerto 3000, lo detecta y lo reutiliza
en lugar de provocar `EADDRINUSE`. Si el puerto pertenece a otro programa,
muestra el proceso que debe revisarse antes de continuar.

Para un ESP32 físico, el backend debe escuchar también en la red privada:

```bash
set -a; source .env; set +a
npm run real:lan
```

El firmware debe apuntar a la IPv4 LAN de Windows, nunca a `127.0.0.1` ni a
la dirección interna cambiante de WSL. El token sigue siendo obligatorio.

Alternativamente, inicie dos terminales en el mismo repositorio:

```bash
# Terminal 1: backend real
set -a; source .env; set +a
npm run real
```

```bash
# Terminal 2: pantalla del emulador
set -a; source .env; set +a
npm start
```

Abra `http://127.0.0.1:18080` cuando use el puente WSL ya configurado. Pulse
`PROBAR WSL`, envíe la orden, revise la fila/valores y use `CONFIRMAR Y APLICAR`.
El estado `CAMBIO APLICADO` solo aparece después de que la lectura de
verificación devuelve `2 Mes`.

GitHub Actions no usa la cuenta de servicio ni la hoja real. Comprueba el mismo
ciclo mediante un adaptador simulado, para que ningún push pueda modificar
datos privados.

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
