import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAMBIOS_DEL_REPORTE, MENSAJE_DE_FALLO, MENSAJES_DE_RESOLUCION, RESULTADOS_DE_RESOLUCION } from "@/lib/admin/reportes-reglas";
import { resolver, type EstadoResolucion } from "./acciones";

// HU-030 sin navegador ni base: la acción con la sesión, la asignación y la resolución inventadas. Aquí se fija a dónde
// vuelve con cada resultado, que la acción no manda ningún correo (los anota la base y salen por los procesos
// programados), que un error no vacía las observaciones, que quien puede resolver se mira antes que el texto (nota de
// D-39) y que las observaciones no llegan al log. La base de verdad la cubre integracion/resolver-reportes.test.ts.

const ID = "30303030-0000-4000-8000-000000000030";
const RUTA = `/admin/reportes/${ID}`;
const YO = "a0a0a0a0-0000-4000-8000-000000000030";
const OTRO = "a0a0a0a0-0000-4000-8000-000000003001";

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" },
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000030",
      rol: "admin",
    })),
    asignacion: vi.fn<(cliente: unknown, idReporte: string) => Promise<{ idAdmin: string; estado: string } | null>>(),
    resolverReporte: vi.fn(),
    revalidatePath: vi.fn(),
    enviarCorreo: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/reportes", () => ({ cargarAsignacionDeReporte: h.asignacion, resolverReporte: h.resolverReporte }));
vi.mock("@/lib/correo/servidor", () => ({ enviarCorreoDesdeServidor: h.enviarCorreo, urlDelSitio: (ruta: string) => ruta }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoResolucion = { error: null, valores: { observaciones: "" } };

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo la acción: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoResolucion }> {
  try {
    return { estado: await resolver(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

const ACEPTAR = { id_reporte: ID, decision: "aceptar" };
const RECHAZAR = { id_reporte: ID, decision: "rechazar", observaciones: " No hay cómo comprobarlo. " };

beforeEach(() => {
  h.exigirRol.mockClear();
  // Salvo que la prueba diga otra cosa, la sesión es el admin asignado y el reporte sigue en revisión.
  h.asignacion.mockReset();
  h.asignacion.mockResolvedValue({ idAdmin: YO, estado: "en_revision" });
  h.resolverReporte.mockReset();
  h.revalidatePath.mockClear();
  h.enviarCorreo.mockClear();
});

describe("resolver (HU-030): lo que se guardó", () => {
  it("aceptar vuelve al reporte con el éxito, refresca la bandeja y la página, y no manda correos", async () => {
    h.resolverReporte.mockResolvedValue("aceptado");
    expect(await enviar(ACEPTAR)).toEqual({ destino: `${RUTA}?resuelto=aceptado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    // Con la sesión del admin, la misma que resuelve.
    expect(h.asignacion).toHaveBeenCalledWith(h.cliente, ID);
    expect(h.resolverReporte).toHaveBeenCalledWith(h.cliente, { idReporte: ID, decision: "aceptar", observaciones: null });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
    expect(h.enviarCorreo).not.toHaveBeenCalled();
  });

  it("rechazar vuelve al reporte con el éxito y manda las observaciones recortadas", async () => {
    h.resolverReporte.mockResolvedValue("rechazado");
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?resuelto=rechazado` });
    expect(h.resolverReporte).toHaveBeenCalledWith(h.cliente, { idReporte: ID, decision: "rechazar", observaciones: "No hay cómo comprobarlo." });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
    expect(h.enviarCorreo).not.toHaveBeenCalled();
  });

  it("las observaciones de solo espacios o saltos de línea van como ninguna", async () => {
    h.resolverReporte.mockResolvedValue("aceptado");
    await enviar({ ...ACEPTAR, observaciones: " \n\t " });
    expect(h.resolverReporte).toHaveBeenCalledWith(h.cliente, { idReporte: ID, decision: "aceptar", observaciones: null });
  });

  it("acepta el id en mayúsculas y con espacios: lo normaliza antes de usarlo", async () => {
    h.resolverReporte.mockResolvedValue("aceptado");
    expect(await enviar({ ...ACEPTAR, id_reporte: ` ${ID.toUpperCase()} ` })).toEqual({ destino: `${RUTA}?resuelto=aceptado` });
    expect(h.asignacion).toHaveBeenCalledWith(h.cliente, ID);
  });
});

describe("resolver: lo que no se guardó", () => {
  it.each(CAMBIOS_DEL_REPORTE)("%s cambió mientras el admin miraba: vuelve al reporte, que se pinta como está ahora", async (resultado) => {
    h.resolverReporte.mockResolvedValue(resultado);
    expect(await enviar(ACEPTAR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it.each(["observaciones_invalidas", "decision_invalida", "no_encontrado", "sin_permiso", "sin_sesion"] as const)(
    "%s se dice en el formulario, con lo escrito",
    async (resultado) => {
      h.resolverReporte.mockResolvedValue(resultado);
      expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJES_DE_RESOLUCION[resultado], valores: { observaciones: RECHAZAR.observaciones } } });
    },
  );

  it("cada resultado de la base termina en una redirección o en un mensaje: ninguno queda sin destino", async () => {
    for (const resultado of RESULTADOS_DE_RESOLUCION) {
      h.resolverReporte.mockResolvedValue(resultado);
      const hecho = await enviar(RECHAZAR);
      if ("destino" in hecho) expect(hecho.destino.startsWith(`${RUTA}?`), resultado).toBe(true);
      else expect(hecho.estado.error, resultado).toBe(MENSAJES_DE_RESOLUCION[resultado as keyof typeof MENSAJES_DE_RESOLUCION]);
    }
  });

  it("si la base falla, pide intentar de nuevo sin perder las observaciones y sin ponerlas en el log", async () => {
    h.resolverReporte.mockRejectedValue(new Error("No se pudo resolver el reporte: 08006 se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar({ ...RECHAZAR, observaciones: "Dato sensible de quien reportó" })).toEqual({
      estado: { error: MENSAJE_DE_FALLO, valores: { observaciones: "Dato sensible de quien reportó" } },
    });
    expect(espia).toHaveBeenCalled();
    expect(JSON.stringify(espia.mock.calls)).not.toContain("Dato sensible");
    espia.mockRestore();
  });

  it("un formulario inválido no llega a la base", async () => {
    expect(await enviar({ id_reporte: "otro", decision: "aceptar" })).toEqual({
      estado: { error: MENSAJES_DE_RESOLUCION.no_encontrado, valores: { observaciones: "" } },
    });
    // Sin un id válido, la ruta de ingreso no lleva a un reporte que no existe.
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(await enviar({ id_reporte: ID, decision: "deshacer" })).toEqual({
      estado: { error: MENSAJES_DE_RESOLUCION.decision_invalida, valores: { observaciones: "" } },
    });
    // Sin un reporte y una decisión válidos ni siquiera se lee la asignación.
    expect(h.asignacion).not.toHaveBeenCalled();
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });

  it("unas observaciones demasiado largas no llegan a la base, y se cuentan por caracteres", async () => {
    const largas = "a".repeat(501);
    expect(await enviar({ ...RECHAZAR, observaciones: largas })).toEqual({
      estado: { error: MENSAJES_DE_RESOLUCION.observaciones_invalidas, valores: { observaciones: largas } },
    });
    expect(h.resolverReporte).not.toHaveBeenCalled();
    // 500 caracteres de cuatro bytes caben: el límite es de la base, en caracteres.
    h.resolverReporte.mockResolvedValue("rechazado");
    expect(await enviar({ ...RECHAZAR, observaciones: "\u{1D11E}".repeat(500) })).toEqual({ destino: `${RUTA}?resuelto=rechazado` });
  });

  it("los saltos de línea que manda el navegador (CRLF) cuentan uno: 500 caracteres en el campo llegan completos a la base, con LF", async () => {
    // 489 letras y 11 saltos: el campo las acepta (maxlength cuenta cada salto como uno) y el formulario envía 511 caracteres.
    const lineas = Array.from({ length: 12 }, (_, i) => "a".repeat(i < 9 ? 41 : 40));
    h.resolverReporte.mockResolvedValue("rechazado");
    expect(await enviar({ ...RECHAZAR, observaciones: lineas.join("\r\n") })).toEqual({ destino: `${RUTA}?resuelto=rechazado` });
    expect(h.resolverReporte).toHaveBeenCalledWith(h.cliente, { idReporte: ID, decision: "rechazar", observaciones: lineas.join("\n") });

    // Con un carácter más (501 ya normalizados) no llega a la base y devuelve lo escrito.
    h.resolverReporte.mockClear();
    const demasiado = `${lineas.join("\r\n")}a`;
    expect(await enviar({ ...RECHAZAR, observaciones: demasiado })).toEqual({
      estado: { error: MENSAJES_DE_RESOLUCION.observaciones_invalidas, valores: { observaciones: demasiado } },
    });
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });

  it("se protege sola: sin admin, exigirRol redirige antes de leer o resolver nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(ACEPTAR)).toEqual({ destino: "/ingresar" });
    expect(h.asignacion).not.toHaveBeenCalled();
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });
});

describe("resolver (RN-63): quién resuelve, antes que el texto (nota de D-39)", () => {
  const LARGAS = { ...RECHAZAR, observaciones: "a".repeat(501) };

  it("otro admin vuelve con no_asignado sin que importe el texto, y la base ni se llama", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, estado: "en_revision" });
    expect(await enviar(LARGAS)).toEqual({ destino: `${RUTA}?error=no_asignado` });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(await enviar(ACEPTAR)).toEqual({ destino: `${RUTA}?error=no_asignado` });
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });

  it("un reporte que ya no está en revisión vuelve con ya_decidido, sin mirar el texto ni llamar a la base", async () => {
    for (const estado of ["aceptado", "rechazado"]) {
      h.asignacion.mockResolvedValue({ idAdmin: YO, estado });
      expect(await enviar(LARGAS), estado).toEqual({ destino: `${RUTA}?error=ya_decidido` });
    }
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });

  it("el no asignado se dice antes que el ya decidido: quien no puede resolver no se entera de más", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, estado: "aceptado" });
    expect(await enviar(ACEPTAR)).toEqual({ destino: `${RUTA}?error=no_asignado` });
  });

  it("un reporte que no existe (o que la sesión no lee) lo dice en el formulario, sin resolver nada", async () => {
    h.asignacion.mockResolvedValue(null);
    expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJES_DE_RESOLUCION.no_encontrado, valores: { observaciones: RECHAZAR.observaciones } } });
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });

  it("si la asignación no se puede leer, pide intentar de nuevo sin perder las observaciones ni ponerlas en el log", async () => {
    h.asignacion.mockRejectedValue(new Error("No se pudo leer el reporte: se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { observaciones: RECHAZAR.observaciones } } });
    expect(espia).toHaveBeenCalled();
    expect(JSON.stringify(espia.mock.calls)).not.toContain("No hay cómo comprobarlo");
    espia.mockRestore();
    expect(h.resolverReporte).not.toHaveBeenCalled();
  });
});
