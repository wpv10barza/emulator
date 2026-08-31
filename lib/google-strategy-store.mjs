import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import { assertPlanStillCurrent, buildStrategyPreview } from "./strategy-sheet.mjs";

function required(value, name) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${name} no está configurado.`);
  return result;
}

export class GoogleStrategyStore {
  constructor({ credentialsPath, spreadsheetId, sheetName = "Data", headerRow = 4 } = {}) {
    this.credentialsPath = required(credentialsPath, "GOOGLE_APPLICATION_CREDENTIALS");
    this.spreadsheetId = required(spreadsheetId, "SPREADSHEET_ID");
    this.sheetName = sheetName;
    this.headerRow = Number(headerRow);
    this.auth = null;
  }

  async client() {
    if (!this.auth) {
      const credentials = JSON.parse(await readFile(this.credentialsPath, "utf8"));
      if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
        throw new Error("La credencial debe ser una cuenta de servicio válida de Google.");
      }
      this.auth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
      });
    }
    return this.auth.getClient();
  }

  valuesUrl(range, query = "") {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}${query}`;
  }

  async request(options) {
    const client = await this.client();
    try {
      return await client.request(options);
    } catch (error) {
      const status = error?.response?.status;
      if (status === 403 || status === 404) {
        throw new Error("La cuenta de servicio no tiene acceso de edición a la hoja o el SPREADSHEET_ID es incorrecto.");
      }
      throw error;
    }
  }

  async health() {
    await this.request({
      url: this.valuesUrl(`${this.sheetName}!A${this.headerRow}:AF${this.headerRow}`),
      method: "GET"
    });
    return { spreadsheet_id: this.spreadsheetId, sheet: this.sheetName, header_row: this.headerRow };
  }

  async preview(command) {
    const response = await this.request({
      url: this.valuesUrl(`${this.sheetName}!A${this.headerRow}:AF`),
      method: "GET"
    });
    return buildStrategyPreview({
      command,
      values: response.data?.values || [],
      headerRow: this.headerRow,
      sheetName: this.sheetName
    });
  }

  async apply(plan, { acceptWarnings = false } = {}) {
    if (plan.warnings?.length && !acceptWarnings) {
      throw new Error("La vista previa contiene advertencias. Confirme aceptándolas explícitamente.");
    }
    const current = await this.request({
      url: this.valuesUrl(`${this.sheetName}!A${plan.row}:AF${plan.row}`),
      method: "GET"
    });
    const row = current.data?.values?.[0] || [];
    assertPlanStillCurrent(plan, row);

    await this.request({
      url: this.valuesUrl(plan.target_range, "?valueInputOption=USER_ENTERED"),
      method: "PUT",
      data: { values: [[plan.after.frequency, plan.after.unit]] }
    });

    const verification = await this.request({
      url: this.valuesUrl(plan.target_range),
      method: "GET"
    });
    const values = verification.data?.values?.[0] || [];
    if (String(values[0]) !== String(plan.after.frequency) || String(values[1]) !== String(plan.after.unit)) {
      throw new Error("Google Sheets respondió correctamente, pero la lectura posterior no coincide con el cambio solicitado.");
    }
    return {
      row: plan.row,
      range: plan.target_range,
      before: plan.before,
      after: plan.after,
      verified: true
    };
  }
}
