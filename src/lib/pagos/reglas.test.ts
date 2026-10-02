import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_NOMBRE_PAGADOR,
  RESULTADOS_REGISTRO_PAGO,
  esResultadoRegistroPago,
  mensajeDeRegistroPago,
  validarPagador,
} from "./reglas";

describe("mensajeDeRegistroPago (HU-018)", () => {
  it.each(RESULTADOS_REGISTRO_PAGO)("%s tiene un mensaje para la persona", (resultado) => {
    const mensaje = mensajeDeRegistroPago(resultado);
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("criterio 4: la reserva vencida dice que expiró y que ya no se adjunta el comprobante", () => {
    expect(mensajeDeRegistroPago("vencida")).toBe(
      "Tu reserva expiró: ya no puedes adjuntar el comprobante. Puedes elegir otra fecha.",
    );
  });

  it.each(["comprobante_ajeno", "comprobante_sin_revisar", "comprobante_no_existe"] as const)(
    "%s pide volver a subir el comprobante",
    (resultado) => {
      expect(mensajeDeRegistroPago(resultado)).toMatch(/Vuelve a subirlo\.$/);
    },
  );

  it("sin admin activo pide reintentar y ofrece el correo de Calibra si se conoce", () => {
    expect(mensajeDeRegistroPago("sin_admin", "datos@calibra.example")).toBe(
      "No pudimos recibir tu comprobante en este momento. Intenta de nuevo en unos minutos o escríbenos a datos@calibra.example.",
    );
    expect(mensajeDeRegistroPago("sin_admin")).toBe(
      "No pudimos recibir tu comprobante en este momento. Intenta de nuevo en unos minutos.",
    );
  });
});

describe("esResultadoRegistroPago", () => {
  it("reconoce solo lo que responde la base", () => {
    for (const resultado of RESULTADOS_REGISTRO_PAGO) expect(esResultadoRegistroPago(resultado)).toBe(true);
    expect(esResultadoRegistroPago("pagada")).toBe(false);
    expect(esResultadoRegistroPago(null)).toBe(false);
    expect(esResultadoRegistroPago(1)).toBe(false);
  });
});

describe("validarPagador (RN-44, supuesto 3)", () => {
  it("deja el nombre en una línea y el correo normalizado, como el del Lead", () => {
    expect(validarPagador({ nombre: "  Ana \n  Pérez ", correo: " Ana.Perez@Uniandes.edu.co " })).toEqual({
      ok: true,
      nombre: "Ana Pérez",
      correo: "ana.perez@uniandes.edu.co",
    });
  });

  it("acepta un nombre del largo máximo", () => {
    expect(validarPagador({ nombre: "a".repeat(LARGO_MAXIMO_NOMBRE_PAGADOR), correo: "ana@uniandes.edu.co" }).ok).toBe(true);
  });

  const CORREO_INVALIDO = "Escribe un correo válido, por ejemplo ana@uniandes.edu.co.";

  it.each([
    ["sin nombre", { nombre: "   ", correo: "ana@uniandes.edu.co" }, "Escribe tu nombre."],
    ["sin campo de nombre", { nombre: null, correo: "ana@uniandes.edu.co" }, "Escribe tu nombre."],
    ["con un nombre demasiado largo", { nombre: "a".repeat(LARGO_MAXIMO_NOMBRE_PAGADOR + 1), correo: "ana@uniandes.edu.co" }, "Tu nombre es demasiado largo."],
    ["sin correo", { nombre: "Ana", correo: "" }, CORREO_INVALIDO],
    ["con un correo a medias", { nombre: "Ana", correo: "ana@" }, CORREO_INVALIDO],
    ["con dos correos", { nombre: "Ana", correo: "a@b.co,c@d.co" }, CORREO_INVALIDO],
    // esCorreo lo deja pasar, pero la base no (misma regla que solicitud_monitor_correo): se dice aquí.
    ["con caracteres que la base no acepta", { nombre: "Ana", correo: "ana?cc=x@b.co" }, CORREO_INVALIDO],
    ["con un archivo en vez de texto", { nombre: "Ana", correo: new Blob(["ana@b.co"]) }, CORREO_INVALIDO],
  ])("rechaza un pagador %s", (_caso, valores, mensaje) => {
    expect(validarPagador(valores)).toEqual({ ok: false, mensaje });
  });
});
