import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlaveDeReembolso } from "@/lib/reembolsos/reglas";
import PaginaDeReembolso, { metadata } from "./page";

// Sin navegador ni base: la página del enlace con el reembolso inventado. Aquí se fija qué muestra cada estado y que un
// enlace que no sirve no consulta nada. El estado lo decide la base con su hora; el recorrido completo, con el
// navegador, lo cubre la e2e.

const datos = vi.hoisted(() => ({ llave: null as LlaveDeReembolso | null, leer: vi.fn() }));

vi.mock("@/lib/reembolsos/servidor", () => ({ leerLlavePorToken: (token: string) => datos.leer(token) }));
// La acción vive en el servidor y el formulario es del navegador: aquí solo se pintan.
vi.mock("./acciones", () => ({ entregarLlave: async () => ({ error: null, valor: "" }) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

const TOKEN = "d".repeat(64);
const VENCE = new Date("2026-10-10T20:00:00.000Z");
const LLAVE: LlaveDeReembolso = { estado: "esperando_llave", monto: 32_000, motivo: "Cancelaste la monitoría dentro del plazo.", venceEn: VENCE };

async function pintar(llave: LlaveDeReembolso | null, consulta: Record<string, string | string[] | undefined> = { token: TOKEN }): Promise<string> {
  datos.llave = llave;
  return renderToStaticMarkup(await PaginaDeReembolso({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  datos.leer.mockReset();
  datos.leer.mockImplementation(async () => datos.llave);
  vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("la página de la llave: lo que no se filtra", () => {
  it("no queda en buscadores ni pasa el enlace por el Referer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("la página de la llave: un enlace que no sirve", () => {
  it("un token que no es de ningún reembolso dice que el enlace no sirve, sin datos ni formulario", async () => {
    const html = await pintar(null);
    expect(texto(html)).toContain("Este enlace no sirve");
    expect(texto(html)).toContain("Abre de nuevo el enlace del correo que te mandamos.");
    expect(html).not.toContain("<form");
    expect(datos.leer).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it("sin token, o repetido, es la misma pantalla y no consulta nada", async () => {
    for (const consulta of [{}, { token: [TOKEN, TOKEN] }]) {
      const html = await pintar(LLAVE, consulta);
      expect(texto(html), JSON.stringify(consulta)).toContain("Este enlace no sirve");
      expect(html).not.toContain("<form");
    }
    expect(datos.leer).not.toHaveBeenCalled();
  });

  it("si la base falla lo dice sin detalles y no deja el token en el registro", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    datos.leer.mockRejectedValue(new Error("No se pudo leer el reembolso: caída"));
    const html = await pintar(LLAVE);
    expect(texto(html)).toContain("No pudimos cargar tu reembolso");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<form");
    expect(JSON.stringify(registro.mock.calls)).not.toContain(TOKEN);
  });
});

describe("la página de la llave: esperando la llave (criterio 2)", () => {
  it("muestra el monto, el motivo y hasta cuándo enviarla, en Bogotá", async () => {
    const t = texto(await pintar(LLAVE));
    expect(t).toContain("Envíanos tu llave");
    expect(t).toContain("Para devolverte $ 32.000 necesitamos tu llave: tu celular, tu correo o el alias que tengas registrado en tu banco.");
    expect(t).toContain("Monto $ 32.000");
    expect(t).toContain("Motivo Cancelaste la monitoría dentro del plazo.");
    // 20:00 UTC son las 3:00 p. m. en Bogotá.
    expect(t).toContain("Envíala hasta el sábado, 10 de octubre de 2026, 3:00 p. m.");
  });

  it("el formulario lleva el token en un campo oculto y un campo de texto con su etiqueta y su ayuda", async () => {
    const html = await pintar(LLAVE);
    expect(html).toMatch(new RegExp(`<input type="hidden" name="token" value="${TOKEN}"/>`));
    expect(html).toMatch(/<label for="llave"[^>]*>Tu llave<\/label>/);
    const campo = html.match(/<input id="llave"[^>]*>/)?.[0] ?? "";
    expect(campo).toContain('name="llave"');
    expect(campo).toContain('type="text"');
    expect(campo).toContain('autoComplete="off"');
    expect(campo).toContain('aria-describedby="llave-ayuda"');
    // Empieza vacío: la página no tiene ninguna llave que mostrar.
    expect(campo).toContain('value=""');
    expect(texto(html)).toContain(
      "Revísala antes de enviarla: desde este enlace no se puede cambiar después. Si te equivocas, escríbenos a soporte@calibra.example.",
    );
    expect(html).toMatch(/<button type="submit"[^>]*>Enviar mi llave<\/button>/);
    expect(texto(html)).toContain("Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.");
  });

  it("sin correo de soporte, la ayuda no promete un canal", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    const t = texto(await pintar(LLAVE));
    expect(t).toContain("Revísala antes de enviarla: desde este enlace no se puede cambiar después.");
    expect(t).not.toContain("escríbenos");
  });
});

describe("la página de la llave: los demás estados no tienen formulario", () => {
  it("con la llave recibida lo dice, sin mostrarla, y ofrece escribir si se equivocó (criterio 3)", async () => {
    const html = await pintar({ ...LLAVE, estado: "pendiente" });
    const t = texto(html);
    expect(t).toContain("Recibimos tu llave");
    expect(t).toContain("Te vamos a transferir $ 32.000. No tienes que hacer nada más.");
    expect(t).toContain("Si te equivocaste al escribirla, escríbenos a soporte@calibra.example.");
    expect(t).not.toContain("Envíala hasta");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("reembolsado dice que ya se devolvió el dinero", async () => {
    const html = await pintar({ ...LLAVE, estado: "reembolsado" });
    expect(texto(html)).toContain("Ya te devolvimos el dinero");
    expect(texto(html)).toContain("Transferimos $ 32.000 a la llave que nos diste.");
    expect(html).not.toContain("<form");
  });

  it("cerrado dice cuándo terminó el plazo y a quién escribir para reabrirlo (P-10, supuesto 4)", async () => {
    const html = await pintar({ ...LLAVE, estado: "cerrado" });
    const t = texto(html);
    expect(t).toContain("Este caso se cerró");
    expect(t).toContain("El plazo para enviarnos tu llave terminó el sábado, 10 de octubre de 2026, 3:00 p. m., así que cerramos el caso.");
    expect(t).toContain("Si todavía necesitas el reembolso, escríbenos a soporte@calibra.example: un admin puede reabrirlo.");
    expect(html).not.toContain("<form");
  });

  it("ningún estado habla de comisión", async () => {
    for (const estado of ["esperando_llave", "pendiente", "reembolsado", "cerrado"] as const) {
      expect((await pintar({ ...LLAVE, estado })).toLowerCase(), estado).not.toContain("comisi");
    }
  });
});
