import { describe, expect, it } from "vitest";
import { configuracionDeLlave, identidadDelProveedor } from "./configuracion";

const QR = "https://calibra.example/qr-llave.png";
const LLAVE = { LLAVE_PLATAFORMA: " 3001234567 ", LLAVE_PLATAFORMA_TITULAR: " Calibra SAS ", LLAVE_PLATAFORMA_QR_URL: ` ${QR} ` };

describe("configuracionDeLlave (HU-018, RN-40)", () => {
  it("lee la llave, el titular y el QR recortados", () => {
    expect(configuracionDeLlave(LLAVE)).toEqual({ llave: "3001234567", titular: "Calibra SAS", qrUrl: QR });
  });

  it("acepta el QR de prueba como URL data:", () => {
    const qrUrl = "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E";
    expect(configuracionDeLlave({ ...LLAVE, LLAVE_PLATAFORMA_QR_URL: qrUrl })).toMatchObject({ qrUrl });
  });

  it.each(["LLAVE_PLATAFORMA", "LLAVE_PLATAFORMA_TITULAR", "LLAVE_PLATAFORMA_QR_URL"] as const)(
    "sin %s no hay pago por Llave (nunca una llave a medias)",
    (variable) => {
      expect(configuracionDeLlave({ ...LLAVE, [variable]: undefined })).toBeNull();
      expect(configuracionDeLlave({ ...LLAVE, [variable]: "   " })).toBeNull();
    },
  );

  it.each(["qr-llave.png", "/qr-llave.png", "http://calibra.example/qr.png", "javascript:alert(1)"])(
    "un QR que no es una imagen usable (%s) cuenta como si faltara",
    (qrUrl) => {
      expect(configuracionDeLlave({ ...LLAVE, LLAVE_PLATAFORMA_QR_URL: qrUrl })).toBeNull();
    },
  );

  it("sin ninguna variable, null", () => {
    expect(configuracionDeLlave({})).toBeNull();
  });
});

describe("identidadDelProveedor (Ley 1480, art. 50)", () => {
  it("sin datos legales muestra solo Calibra, sin documento", () => {
    expect(identidadDelProveedor({})).toEqual({ nombre: "Calibra", documento: null, correo: null });
    expect(identidadDelProveedor({ PROVEEDOR_NOMBRE: "  ", PROVEEDOR_DOCUMENTO: " " })).toEqual({
      nombre: "Calibra",
      documento: null,
      correo: null,
    });
  });

  it("lee nombre, documento y el correo de Calibra (CORREO_DATOS_PERSONALES), recortados", () => {
    expect(
      identidadDelProveedor({
        PROVEEDOR_NOMBRE: " Calibra SAS ",
        PROVEEDOR_DOCUMENTO: " NIT 900.000.000-0 ",
        CORREO_DATOS_PERSONALES: " datos@calibra.example ",
      }),
    ).toEqual({ nombre: "Calibra SAS", documento: "NIT 900.000.000-0", correo: "datos@calibra.example" });
  });

  it("un correo que no es correo no se muestra", () => {
    expect(identidadDelProveedor({ CORREO_DATOS_PERSONALES: "no-es-correo" }).correo).toBeNull();
  });
});
