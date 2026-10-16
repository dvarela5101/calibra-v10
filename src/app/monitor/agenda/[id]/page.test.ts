import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerHtml, porEtiqueta, textoDe } from "../../../../../pruebas/arbol-html";
import { filaDeEjemplo, filaSinDiagnostico, filaSinRespuestasAutorizadas } from "../../../../../pruebas/vista-del-monitor-ejemplo";
import { ErrorDeVistaDelMonitor, leerVistaDelMonitor, TEXTOS, type VistaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";

// HU-022: la página del diagnóstico de una cita, sin navegador ni base: el rol, el cliente y la lectura son inventados y `notFound()`
// lanza, como en Next. Se fija el orden (primero el rol, después el UUID, después la lectura), que un error de lectura no se esconda
// como 404 y que lo que no se ve sea el mismo 404. Qué citas se ven y de quién son lo decide la base (pgTAP e integración); el 404 real
// y su cabecera `Cache-Control` los ve la e2e.

const falsos = vi.hoisted(() => ({
  exigirRol: vi.fn(),
  cliente: {} as object | null,
  cargar: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: (...args: unknown[]) => falsos.exigirRol(...args) }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => falsos.cliente }));
vi.mock("@/lib/agenda/servidor", () => ({ cargarDiagnosticoDeLaCita: (...args: unknown[]) => falsos.cargar(...args) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    falsos.notFound();
    throw new Error("notFound");
  },
}));

import DiagnosticoDeLaCita, { metadata } from "./page";

const ID = "5a5a5a5a-0000-4000-8000-000000000022";
const MENSAJE_DE_ERROR = "No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, avisa al equipo.";

const vistaDe = (fila: Record<string, unknown>): VistaDelMonitor => leerVistaDelMonitor([fila])!;

async function abrir(id: string): Promise<string> {
  return renderToStaticMarkup(await DiagnosticoDeLaCita({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  falsos.exigirRol.mockReset().mockResolvedValue({ idUsuario: "d0d0d0d0-0000-4000-8000-000000000022", rol: "monitor" });
  falsos.cliente = {};
  falsos.cargar.mockReset().mockResolvedValue(vistaDe(filaDeEjemplo()));
  falsos.notFound.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("/monitor/agenda/[id]: la página", () => {
  it("no se indexa y el título de la pestaña es «Diagnóstico de la cita · Calibra»", () => {
    expect(metadata.title).toBe("Diagnóstico de la cita · Calibra");
    expect(metadata.robots).toEqual({ index: false });
  });

  it("pide el rol de monitor con su propia dirección y lee con el cliente de la sesión y solo con el id", async () => {
    await abrir(ID);
    expect(falsos.exigirRol).toHaveBeenCalledExactlyOnceWith("monitor", `/monitor/agenda/${ID}`);
    expect(falsos.cargar).toHaveBeenCalledExactlyOnceWith(falsos.cliente, ID);
  });

  it("pinta el título con el nombre de quien agendó, la materia, el día y la hora, y el diagnóstico", async () => {
    const arbol = leerHtml(await abrir(ID));
    expect(textoDe(porEtiqueta(arbol, "h1")[0])).toBe("Diagnóstico de Camila Rojas");
    const texto = textoDe(arbol);
    expect(texto).toContain("Mi agenda");
    // 12 de octubre de 2026 es lunes; la sesión es de 10:00 a 11:00.
    expect(texto).toContain("Física II · Lunes, 12 de octubre, 10:00 a 11:00");
    expect(texto).toContain("5 de 8 correctas");
    expect(texto).toContain("Pregunta 8");
  });

  it("lleva un enlace «Volver a mi agenda» a la agenda", async () => {
    const enlaces = porEtiqueta(leerHtml(await abrir(ID)), "a").filter((a) => textoDe(a) === TEXTOS.volver);
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].atributos.href).toBe("/monitor/agenda");
  });

  it("sin diagnóstico dice el mensaje de la HU y no es un error ni un 404", async () => {
    falsos.cargar.mockResolvedValue(vistaDe(filaSinDiagnostico()));
    const html = await abrir(ID);
    expect(textoDe(leerHtml(html))).toContain("No hay diagnóstico de esta materia ligado a esta monitoría.");
    expect(html).not.toContain('role="alert"');
    expect(falsos.notFound).not.toHaveBeenCalled();
    // La cabecera de la cita sí está.
    expect(textoDe(porEtiqueta(leerHtml(html), "h1")[0])).toBe("Diagnóstico de Camila Rojas");
  });

  it("con la autorización vieja ve el resto y el mensaje de «no autorizó», sin ningún enunciado (criterio 14)", async () => {
    falsos.cargar.mockResolvedValue(vistaDe(filaSinRespuestasAutorizadas()));
    const html = await abrir(ID);
    const texto = textoDe(leerHtml(html));
    expect(texto).toContain("El estudiante no autorizó compartir sus respuestas.");
    expect(texto).toContain("5 de 8 correctas");
    expect(html).not.toContain("Enunciado de la pregunta");
    expect(html).not.toContain("Opción A");
  });

  it("el diagnóstico repetido lleva la nota; el que no lo es, no", async () => {
    falsos.cargar.mockResolvedValue(vistaDe(filaDeEjemplo({ repetido: true })));
    expect(textoDe(leerHtml(await abrir(ID)))).toContain("Lo tomó otra vez; puede incluir preguntas que ya había visto");
    falsos.cargar.mockResolvedValue(vistaDe(filaDeEjemplo({ repetido: false })));
    expect(textoDe(leerHtml(await abrir(ID)))).not.toContain("otra vez");
  });
});

describe("/monitor/agenda/[id]: lo que no es un UUID", () => {
  it.each([["no-es-un-uuid"], [""], ["123"], [`${ID}x`], [`${ID} `], ["../../admin"], ["5a5a5a5a-0000-4000-8000-00000000002%"]])("el id %j: 404 sin llamar a la lectura (M50)", async (id) => {
    await expect(abrir(id)).rejects.toThrow("notFound");
    expect(falsos.cargar).not.toHaveBeenCalled();
    expect(falsos.notFound).toHaveBeenCalledOnce();
  });

  it("pide el rol con la agenda y no con el id basura, para que no viaje en `?siguiente=`; y lo pide antes del 404 (M50)", async () => {
    await expect(abrir("no-es-un-uuid")).rejects.toThrow("notFound");
    expect(falsos.exigirRol).toHaveBeenCalledExactlyOnceWith("monitor", "/monitor/agenda");
    expect(falsos.exigirRol.mock.invocationCallOrder[0]).toBeLessThan(falsos.notFound.mock.invocationCallOrder[0]);
  });

  it("quien no es monitor no llega a la lectura ni al 404: `exigirRol` lo redirige", async () => {
    falsos.exigirRol.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(abrir(ID)).rejects.toThrow("NEXT_REDIRECT");
    await expect(abrir("no-es-un-uuid")).rejects.toThrow("NEXT_REDIRECT");
    expect(falsos.cargar).not.toHaveBeenCalled();
    expect(falsos.notFound).not.toHaveBeenCalled();
  });
});

describe("/monitor/agenda/[id]: no existe, no es suya, es grupal o su estado no se ve", () => {
  it("sin fila es notFound(), el mismo 404 que un UUID inexistente, y no pinta nada (M52)", async () => {
    falsos.cargar.mockResolvedValue(null);
    await expect(abrir(ID)).rejects.toThrow("notFound");
    expect(falsos.cargar).toHaveBeenCalledOnce();
    expect(falsos.notFound).toHaveBeenCalledOnce();
  });
});

describe("/monitor/agenda/[id]: un error no se esconde como «no existe» (M51)", () => {
  it("si la lectura falla, avisa con `role=\"alert\"` y un enlace para volver; no es notFound()", async () => {
    falsos.cargar.mockRejectedValue(new Error("No se pudo leer el diagnóstico de la cita (código 57014): canceling statement"));
    const html = await abrir(ID);
    const arbol = leerHtml(html);
    const alerta = porEtiqueta(arbol, "p").filter((p) => p.atributos.role === "alert");
    expect(alerta).toHaveLength(1);
    expect(textoDe(alerta[0])).toBe(MENSAJE_DE_ERROR);
    expect(porEtiqueta(arbol, "a").some((a) => textoDe(a) === TEXTOS.volver && a.atributos.href === "/monitor/agenda")).toBe(true);
    expect(falsos.notFound).not.toHaveBeenCalled();
    expect(html).not.toContain("5 de 8 correctas");
  });

  it("lo que lo registra es solo el mensaje: el de la vista trae la ruta del dato y no su contenido", async () => {
    falsos.cargar.mockRejectedValue(new ErrorDeVistaDelMonitor("habilidades[2].nivel"));
    await abrir(ID);
    expect(console.error).toHaveBeenCalledOnce();
    const [prefijo, mensaje] = vi.mocked(console.error).mock.calls[0];
    expect(prefijo).toBe("[diagnostico del monitor]");
    expect(mensaje).toBe("La vista del diagnóstico no tiene la forma esperada (habilidades[2].nivel).");
  });

  it("una respuesta que no cuadra también es el aviso de error, no un 404", async () => {
    falsos.cargar.mockRejectedValue(new ErrorDeVistaDelMonitor("filas"));
    expect(textoDe(leerHtml(await abrir(ID)))).toContain(MENSAJE_DE_ERROR);
    expect(falsos.notFound).not.toHaveBeenCalled();
  });

  it("sin las variables de Supabase tampoco es un 404", async () => {
    falsos.cliente = null;
    expect(textoDe(leerHtml(await abrir(ID)))).toContain(MENSAJE_DE_ERROR);
    expect(falsos.cargar).not.toHaveBeenCalled();
    expect(falsos.notFound).not.toHaveBeenCalled();
  });

  it("el mensaje de error se registra sin el objeto entero: lo que no es un Error no se vuelca", async () => {
    falsos.cargar.mockRejectedValue({ details: "detalle-secreto-del-servidor" });
    await abrir(ID);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("detalle-secreto-del-servidor");
  });
});
