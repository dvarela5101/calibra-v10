import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagoPorLlave } from "./PagoPorLlave";

// Sin navegador ni base: se pinta el pago con la configuración del entorno que pone cada prueba y se lee el HTML.
// El caso sin configuración solo se puede probar aquí (la e2e corre con los valores de prueba de .env.local); el
// recorrido completo, con la subida y la base, lo cubre e2e/pagar.spec.ts.

// El contador vuelve a pedir la página al vencer; fuera de Next no hay enrutador.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const QR = "https://calibra.example/qr-llave.png";
const AHORA = new Date("2026-10-05T15:00:00.000Z");
const MIN_MS = 60_000;

function configurar(entorno: Record<string, string>) {
  const todas = {
    LLAVE_PLATAFORMA: "3001234567",
    LLAVE_PLATAFORMA_TITULAR: "Calibra SAS",
    LLAVE_PLATAFORMA_QR_URL: QR,
    PROVEEDOR_NOMBRE: "Calibra SAS",
    PROVEEDOR_DOCUMENTO: "900123456",
    CORREO_DATOS_PERSONALES: "calibra.monitorias@gmail.com",
    ...entorno,
  };
  for (const [nombre, valor] of Object.entries(todas)) vi.stubEnv(nombre, valor);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const pintar = (reservaHasta: Date) =>
  renderToStaticMarkup(
    createElement(PagoPorLlave, {
      idMonitoria: "5a5a5a5a-0000-4000-8000-000000000018",
      valorTotal: 32_000,
      reservaHasta,
      ahora: AHORA,
      idUsuario: "c0c0c0c0-0000-4000-8000-000000000018",
      pagador: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co" },
    }),
  );

/** El texto visible: sin etiquetas, con los espacios duros y los repetidos normalizados (y sin el que deja una etiqueta antes de un punto). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\xa0 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1");

const vigente = new Date(AHORA.getTime() + 7 * MIN_MS + 30_000);

describe("PagoPorLlave (HU-018): con la llave configurada y la reserva vigente", () => {
  it("muestra el valor, a quién se le paga, el tiempo, el QR, la llave con su botón de copiar y el titular", () => {
    configurar({});
    const html = pintar(vigente);
    const t = texto(html);
    expect(t).toContain("Paga $ 32.000 por Llave");
    expect(t).toContain("Le pagas a Calibra SAS, documento 900123456. Correo: calibra.monitorias@gmail.com.");
    expect(t).toContain("Quedan 7 min para enviar el comprobante.");
    expect(html).toMatch(new RegExp(`<img[^>]*src="${QR}"[^>]*alt="Código QR para transferir a la llave 3001234567, de Calibra SAS"`));
    expect(html).toMatch(/<input[^>]*id="pago-llave"[^>]*readOnly=""[^>]*value="3001234567"/);
    expect(t).toContain("Copiar llave");
    expect(t).toContain("Titular de la llave: Calibra SAS");
  });

  it("el formulario trae prellenados al Lead y el archivo no viaja a la acción (sin name)", () => {
    configurar({});
    const html = pintar(vigente);
    expect(html).toMatch(/<input[^>]*name="nombre"[^>]*value="Camila Rojas"/);
    expect(html).toMatch(/<input[^>]*name="correo"[^>]*value="camila@uniandes.edu.co"/);
    const archivo = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    expect(archivo).toContain('accept="image/jpeg,image/png,application/pdf"');
    expect(archivo).not.toMatch(/\sname=/);
    // Ningún campo de monto: lo pone la base (P-36).
    expect(html).not.toMatch(/name="monto"/);
    expect(texto(html)).toContain("Enviar comprobante");
  });

  it("sin datos del proveedor dice solo Calibra, y sin correo no lo menciona", () => {
    configurar({ PROVEEDOR_NOMBRE: "", PROVEEDOR_DOCUMENTO: "", CORREO_DATOS_PERSONALES: "" });
    const t = texto(pintar(vigente));
    expect(t).toContain("Le pagas a Calibra.");
    expect(t).not.toContain("Correo:");
  });
});

describe("PagoPorLlave (HU-018, supuesto 1): sin la llave configurada", () => {
  it.each(["LLAVE_PLATAFORMA", "LLAVE_PLATAFORMA_TITULAR", "LLAVE_PLATAFORMA_QR_URL"])(
    "sin %s dice que el pago no está disponible y da el correo; ni llave, ni QR, ni formulario",
    (variable) => {
      configurar({ [variable]: "" });
      const html = pintar(vigente);
      const t = texto(html);
      expect(t).toContain("El pago por Llave no está disponible en este momento. Escríbenos a calibra.monitorias@gmail.com");
      expect(html).toContain('href="mailto:calibra.monitorias@gmail.com"');
      for (const ausente of ["<img", "<form", 'type="file"', "Copiar llave", "pago-llave", "Enviar comprobante"]) {
        expect(html, ausente).not.toContain(ausente);
      }
      if (variable !== "LLAVE_PLATAFORMA") expect(html).not.toContain("3001234567");
    },
  );

  it("sin el correo de Calibra pide intentarlo más tarde", () => {
    configurar({ LLAVE_PLATAFORMA: "", CORREO_DATOS_PERSONALES: "" });
    expect(texto(pintar(vigente))).toContain("El pago por Llave no está disponible en este momento. Inténtalo más tarde.");
  });
});

describe("PagoPorLlave (HU-018, criterio 4): la reserva vencida", () => {
  it("un instante después del límite solo dice que expiró; con el límite exacto todavía se paga (P-40)", () => {
    configurar({});
    const vencida = pintar(new Date(AHORA.getTime() - 1));
    expect(texto(vencida).trim()).toBe("La reserva expiró: ya no puedes adjuntar el comprobante.");
    for (const ausente of ["<form", "3001234567", "<img"]) expect(vencida, ausente).not.toContain(ausente);

    expect(texto(pintar(AHORA))).toContain("Queda menos de 1 min para enviar el comprobante.");
  });
});
