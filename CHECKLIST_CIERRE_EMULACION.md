# Checklist de cierre — simulación ESP32 / backend

## Objetivo

Cerrar la prueba reproducible del emulador de pantalla táctil de **480 × 480 píxeles** con el backend simulado, tomando como referencia la **solicitud de cambios N.º 6**. El escenario parte de un servidor central con una regla de **bloqueo temporal de celdas** activa y verifica el ciclo completo de envío antes de considerar válida la integración aislada.

## Secuencia de cierre

1. Levantar el backend simulado con `CELL_LOCK_ACTIVE=true` y un TTL controlado mediante `CELL_LOCK_TTL_S`.
2. Iniciar el emulador y comprobar `GET /healthz` y `GET /bridge/health`.
3. Confirmar desde la interfaz emulada que la pantalla de 480 × 480 responde y muestra el estado del bloqueo temporal.
4. Ejecutar la solicitud de prueba mediante `POST /bridge/commands` y verificar la transición `pending_confirmation -> applied`.
5. Consultar `GET /bridge/metrics` para consolidar peticiones, rechazos de autenticación y ciclo de comandos.
6. Consultar `GET /evidence.json` para conservar el registro de la sesión HTTP.

## Estado

- [x] Emulador HTTP operativo.
- [x] Interfaz visual declarada para pantalla de 480 × 480 píxeles.
- [x] Solicitud de cambios N.º 6 identificada y trabajada en la rama `feat/emulation-metrics-auth-checklist`.
- [x] Puente `/bridge/health` hacia `/api/device/v1/health`.
- [x] Puente `/bridge/commands` hacia el contrato de comandos.
- [x] Autenticación mediante `x-3c-device-token` con `ESP32_API_TOKEN` externo al repositorio.
- [x] Regla de bloqueo temporal de celdas modelada en la simulación con TTL configurable.
- [x] Estado de bloqueo incluido en `health`, creación/consulta de comandos y métricas.
- [x] Ruta `/api/device/v1/metrics` en el backend simulado.
- [x] Ruta `/bridge/metrics` en el emulador.
- [x] Métricas de solicitudes y rechazos de autenticación.
- [x] Evidencia reproducible en `/evidence.json`.
- [x] Prueba automatizada del ciclo `health -> lock -> pending_confirmation -> applied`.
- [x] Prueba de rechazo `401` con token inválido.
- [x] Comprobación automatizada de los elementos principales de la pantalla de 480 × 480.
- [ ] Validación física del ESP32-S3-4848S040.
- [ ] Flasheo y monitor serial del equipo real.
- [ ] Integración E2E física con ESP-Hi C3 y Waveshare AMOLED 2.16.

## Comandos de verificación

```bash
npm test
npm run mock
npm start
```

Con el mock y el emulador levantados:

```text
GET /bridge/metrics
GET /evidence.json
```

Para reproducir explícitamente el bloqueo temporal:

```bash
CELL_LOCK_ACTIVE=true CELL_LOCK_TTL_S=120 npm run mock
```

Para cerrar la rama mediante fast-forward desde el entorno local, una vez aprobada la PR:

```bash
git checkout main && git pull --ff-only && git merge --ff-only feat/emulation-metrics-auth-checklist && git push origin main
```

## Criterio de aceptación

La simulación se considera cerrada cuando el endpoint de salud confirma el bloqueo temporal activo, la interfaz de 480 × 480 carga, la solicitud N.º 6 completa `pending_confirmation -> applied`, el sistema registra al menos un rechazo `401` en la métrica de autenticación y el archivo `/evidence.json` conserva la secuencia HTTP.

## Alcance y límites de la evidencia

Esta tarea acredita **emulación funcional e integración HTTP reproducible en software aislado**. No acredita funcionamiento físico del display, táctil, memoria, audio, GPIO, alimentación, flasheo, monitor serial ni escritura externa en Google Sheets. La matriz de evidencia del proyecto debe mantener estas categorías separadas.

## Autenticación

La autenticación entre emulador y backend usa el encabezado `x-3c-device-token`. El valor se obtiene de `ESP32_API_TOKEN` y no debe almacenarse en archivos versionados.
