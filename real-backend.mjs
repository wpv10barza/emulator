import { createRealBackendServer } from "./lib/real-backend-server.mjs";
import { GoogleStrategyStore } from "./lib/google-strategy-store.mjs";

const port = Number(process.env.REAL_BACKEND_PORT || 3000);
const host = process.env.REAL_BACKEND_HOST || "127.0.0.1";
const token = String(process.env.ESP32_API_TOKEN || "");

if (!token) {
  console.error("Falta ESP32_API_TOKEN. El backend real no se iniciará sin autenticación.");
  process.exit(2);
}

const store = new GoogleStrategyStore({
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  spreadsheetId: process.env.SPREADSHEET_ID,
  sheetName: process.env.SHEET_NAME || "Data",
  headerRow: Number(process.env.HEADER_ROW || 4)
});

const server = createRealBackendServer({ store, token });
server.listen(port, host, async () => {
  console.log(`Backend real Google Sheets: http://${host}:${port}`);
  console.log("Modo seguro: vista previa obligatoria antes de escribir L/M.");
  try {
    const target = await store.health();
    console.log(`Hoja verificada: ${target.sheet}, encabezados en fila ${target.header_row}`);
  } catch (error) {
    console.error(`Preflight de Google Sheets falló: ${error.message}`);
    server.close(() => process.exit(2));
  }
});
