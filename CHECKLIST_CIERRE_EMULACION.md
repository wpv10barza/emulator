# Checklist de cierre — prueba en emulación ESP32 / backend

## Objetivo

Cerrar la integración reproducible del emulador ESP32-S3-4848S040 con el backend simulado, incluyendo autenticación por `x-3c-device-token`, ruta de métricas y evidencia JSON.

## Estado

- [x] Emulador HTTP operativo.
- [x] Puente `/bridge/health` hacia `/api/device/v1/health`.
- [x] Puente `/bridge/commands` hacia el contrato de comandos.
- [x] Autenticación del backend mediante `x-3c-device-token`.
- [x] Nueva ruta `/api/device/v1/metrics` en el backend simulado.
- [x] Nueva ruta `/bridge/metrics` en el emulador.
- [x] Métricas de solicitudes, rechazos de autenticación y ciclo de comandos.
- [x] Evidencia reproducible en `/evidence.json`.
- [x] Prueba automatizada del ciclo `health -> metrics -> pending_confirmation -> applied`.
- [ ] Validación física del ESP32-S3-4848S040.
- [ ] Flasheo y monitor serial del equipo real.
- [ ] Integración E2E física con ESP-Hi C3 y Waveshare AMOLED 2.16.

## Comandos de verificación

```bash
npm test
npm run mock
npm start
```

Con el mock y el emulador levantados, consultar:

```text
GET /bridge/metrics
GET /evidence.json
```

La autenticación usada entre emulador y backend es el encabezado `x-3c-device-token`. El token debe proporcionarse mediante `ESP32_API_TOKEN`; no debe almacenarse en el repositorio.

## Alcance de la evidencia

Esta tarea acredita **emulación funcional e integración HTTP reproducible**. No acredita funcionamiento físico del display, táctil, memoria, audio, GPIO, alimentación ni escritura externa en Google Sheets. La matriz de evidencia del proyecto mantiene separadas estas categorías.
