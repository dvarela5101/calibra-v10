import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cancelarCita } from "./acciones";
import { CancelarCita, cancelarSinCaerse, PasoDeConfirmacion, SIN_RESPUESTA } from "./CancelarCita";

// Sin navegador ni servidor: se pinta el botón y el paso de confirmación y se lee el HTML. El paso se abre con un clic
// (estado del navegador), así que aquí se pinta por separado; el recorrido completo (botón, confirmación, redirección a la
// cita ya cancelada) lo cubre e2e/cancelar.spec.ts con la base real.

// La acción vive en el servidor: aquí no se llama.
vi.mock("./acciones", () => ({ cancelarCita: vi.fn(async () => ({ error: null })) }));

const TOKEN = "a".repeat(64);
const ID = "5a5a5a5a-0000-4000-8000-000000000024";

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));

describe("CancelarCita (HU-024): el botón", () => {
  const html = renderToStaticMarkup(createElement(CancelarCita, { origen: { token: TOKEN }, estadoPago: "aprobado" }));

  it("es un único botón «Cancelar mi monitoría» que no envía nada: solo abre la confirmación", () => {
    const todos = botones(html);
    expect(todos).toHaveLength(1);
    expect(todos[0].nombre).toBe("Cancelar mi monitoría");
    expect(todos[0].atributos).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
  });

  it("todavía no pregunta ni habla del dinero", () => {
    const t = texto(html);
    expect(t).not.toContain("¿Cancelar tu monitoría?");
    expect(t).not.toContain("devolvemos");
    expect(html).not.toContain('role="alert"');
  });

  it("con el enlace del correo lleva el token en un campo oculto, y solo ese", () => {
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="token"[^>]*value="a{64}"/);
    expect(html).not.toContain('name="id"');
  });

  it("con la sesión lleva el id de la monitoría en un campo oculto, y solo ese", () => {
    const conSesion = renderToStaticMarkup(createElement(CancelarCita, { origen: { id: ID }, estadoPago: "en_revision" }));
    expect(conSesion).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(conSesion).not.toContain('name="token"');
  });
});

describe("PasoDeConfirmacion (HU-024): la confirmación", () => {
  const pintar = (estadoPago: "aprobado" | "en_revision" | "rechazado" | "sin_pagar", enviando = false) =>
    renderToStaticMarkup(createElement(PasoDeConfirmacion, { estadoPago, enviando, alMantener: () => {} }));

  it("pregunta, avisa que la fecha queda libre y ofrece «Sí, cancelar» y «No, mantenerla»", () => {
    const html = pintar("aprobado");
    expect(texto(html)).toContain("¿Cancelar tu monitoría? La fecha queda libre para otra persona.");
    const [si, no] = botones(html);
    expect(si.nombre).toBe("Sí, cancelar");
    expect(si.atributos).toContain('type="submit"');
    expect(no.nombre).toBe("No, mantenerla");
    expect(no.atributos).toContain('type="button"');
    expect(botones(html)).toHaveLength(2);
  });

  it("es un grupo con la pregunta como nombre, para que un lector de pantalla la diga al entrar", () => {
    const html = pintar("aprobado");
    const idPregunta = /<p id="([^"]+)"/.exec(html)?.[1];
    expect(idPregunta).toBeTruthy();
    expect(html).toMatch(new RegExp(`role="group"[^>]*aria-labelledby="${idPregunta}"|aria-labelledby="${idPregunta}"[^>]*role="group"`));
  });

  it("con el pago aprobado dice que se devuelve el valor completo y que se pide la llave por correo", () => {
    expect(texto(pintar("aprobado"))).toContain("Te devolvemos el valor completo: te pedimos la llave por correo.");
  });

  it("con el pago en revisión dice que si se aprueba se pide la llave y si se rechaza no hay reembolso (D-27)", () => {
    const t = texto(pintar("en_revision"));
    expect(t).toContain("Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.");
    expect(t).not.toContain("valor completo");
  });

  it("sin pago aprobado ni en revisión no promete ninguna devolución", () => {
    for (const estadoPago of ["rechazado", "sin_pagar"] as const) {
      const t = texto(pintar(estadoPago));
      expect(t, estadoPago).not.toMatch(/devol|llave|reembolso/);
      expect(t, estadoPago).toContain("La fecha queda libre para otra persona.");
    }
  });

  it("mientras se cancela, avisa y no deja enviar ni desistir otra vez", () => {
    const [si, no] = botones(pintar("aprobado", true));
    expect(si.nombre).toBe("Cancelando…");
    expect(si.atributos).toContain("disabled");
    expect(no.atributos).toContain("disabled");
    expect(botones(pintar("aprobado", false))[0].atributos).not.toContain("disabled");
  });

  it("no habla de comisión", () => {
    for (const estadoPago of ["aprobado", "en_revision", "rechazado", "sin_pagar"] as const) {
      expect(texto(pintar(estadoPago))).not.toMatch(/comisi|neto/i);
    }
  });
});

describe("cancelarSinCaerse (HU-024): la acción sin que un fallo tumbe la página", () => {
  const datos = new FormData();

  it("con el resultado de la acción, lo devuelve tal cual", async () => {
    vi.mocked(cancelarCita).mockResolvedValueOnce({ error: "Pasó el plazo." });
    expect(await cancelarSinCaerse({ error: null }, datos)).toEqual({ error: "Pasó el plazo." });
  });

  it("con un error cualquiera (red caída, despliegue nuevo) devuelve el estado de error SIN_RESPUESTA", async () => {
    vi.mocked(cancelarCita).mockRejectedValueOnce(new Error("Failed to fetch"));
    expect(await cancelarSinCaerse({ error: null }, datos)).toEqual({ error: SIN_RESPUESTA });
  });

  it("con el redirect de Next lo relanza, para que haga la navegación", async () => {
    // Lo que lanza `redirect()`: un error con digest `NEXT_REDIRECT;<tipo>;<destino>;<estado>;`.
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/cita?t=abc;303;" });
    vi.mocked(cancelarCita).mockRejectedValueOnce(redireccion);
    await expect(cancelarSinCaerse({ error: null }, datos)).rejects.toBe(redireccion);
  });
});
