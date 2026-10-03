import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reportarInasistencia } from "./acciones-de-reporte";
import { SIN_RESPUESTA } from "./CancelarCita";
import { PasoDeReporte, ReportarInasistencia, reportarSinCaerse } from "./ReportarInasistencia";

// Sin navegador ni servidor: se pinta el botón y el paso de confirmación y se lee el HTML. El paso se abre con un clic
// (estado del navegador), así que aquí se pinta por separado; el recorrido completo (botón, confirmación, redirección a la
// cita con el reporte) lo cubre e2e/reportar.spec.ts con la base real.

// La acción vive en el servidor: aquí no se llama.
vi.mock("./acciones-de-reporte", () => ({ reportarInasistencia: vi.fn(async () => ({ error: null })) }));
vi.mock("./acciones", () => ({ cancelarCita: vi.fn(async () => ({ error: null })) }));

const TOKEN = "a".repeat(64);
const ID = "5a5a5a5a-0000-4000-8000-000000000029";

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));

describe("ReportarInasistencia (HU-029): el botón", () => {
  const html = renderToStaticMarkup(createElement(ReportarInasistencia, { origen: { token: TOKEN } }));

  it("es un único botón «El monitor no llegó» que no envía nada: solo abre la confirmación", () => {
    const todos = botones(html);
    expect(todos).toHaveLength(1);
    expect(todos[0].nombre).toBe("El monitor no llegó");
    expect(todos[0].atributos).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
  });

  it("todavía no pregunta ni muestra el paso ni errores", () => {
    const t = texto(html);
    expect(t).not.toContain("¿Reportar que el monitor no llegó?");
    expect(t).not.toContain("Sí, reportar");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="group"');
  });

  it("con el enlace del correo lleva el token en un campo oculto, y solo ese", () => {
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="token"[^>]*value="a{64}"/);
    expect(html).not.toContain('name="id"');
  });

  it("con la sesión lleva el id de la monitoría en un campo oculto, y solo ese", () => {
    const conSesion = renderToStaticMarkup(createElement(ReportarInasistencia, { origen: { id: ID } }));
    expect(conSesion).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(conSesion).not.toContain('name="token"');
  });
});

describe("PasoDeReporte (HU-029): la confirmación", () => {
  const pintar = (enviando = false) => renderToStaticMarkup(createElement(PasoDeReporte, { enviando, alVolver: () => {} }));

  it("pregunta, avisa que se reporta una sola vez y ofrece «Sí, reportar» y «No, volver»", () => {
    const html = pintar();
    expect(texto(html)).toContain("¿Reportar que el monitor no llegó?");
    expect(texto(html)).toContain("Un admin revisará tu reporte. Solo puedes reportar una vez esta monitoría.");
    const [si, no] = botones(html);
    expect(si.nombre).toBe("Sí, reportar");
    expect(si.atributos).toContain('type="submit"');
    expect(no.nombre).toBe("No, volver");
    expect(no.atributos).toContain('type="button"');
    expect(no.atributos).toContain("autoFocus");
    expect(botones(html)).toHaveLength(2);
  });

  it("es un grupo con la pregunta como nombre, para que un lector de pantalla la diga al entrar", () => {
    const html = pintar();
    const idPregunta = /<p id="([^"]+)"/.exec(html)?.[1];
    expect(idPregunta).toBeTruthy();
    expect(html).toMatch(new RegExp(`role="group"[^>]*aria-labelledby="${idPregunta}"|aria-labelledby="${idPregunta}"[^>]*role="group"`));
  });

  it("mientras se envía, avisa y no deja enviar ni desistir otra vez", () => {
    const [si, no] = botones(pintar(true));
    expect(si.nombre).toBe("Enviando…");
    expect(si.atributos).toContain("disabled");
    expect(no.atributos).toContain("disabled");
    expect(botones(pintar(false))[0].atributos).not.toContain("disabled");
  });

  it("no habla de comisión, del desembolso ni del monitor más allá de que no llegó", () => {
    expect(texto(pintar())).not.toMatch(/comisi|neto|desembolso|tel[eé]fono/i);
  });
});

describe("reportarSinCaerse (HU-029): la acción sin que un fallo tumbe la página", () => {
  const datos = new FormData();

  it("con el resultado de la acción, lo devuelve tal cual", async () => {
    vi.mocked(reportarInasistencia).mockResolvedValueOnce({ error: "Ya pasó el plazo." });
    expect(await reportarSinCaerse({ error: null }, datos)).toEqual({ error: "Ya pasó el plazo." });
  });

  it("con un error cualquiera (red caída, despliegue nuevo) devuelve el estado de error SIN_RESPUESTA", async () => {
    vi.mocked(reportarInasistencia).mockRejectedValueOnce(new Error("Failed to fetch"));
    expect(await reportarSinCaerse({ error: null }, datos)).toEqual({ error: SIN_RESPUESTA });
  });

  it("con el redirect de Next lo relanza, para que haga la navegación", async () => {
    // Lo que lanza `redirect()`: un error con digest `NEXT_REDIRECT;<tipo>;<destino>;<estado>;`.
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/cita?token=abc;303;" });
    vi.mocked(reportarInasistencia).mockRejectedValueOnce(redireccion);
    await expect(reportarSinCaerse({ error: null }, datos)).rejects.toBe(redireccion);
  });
});
