import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MENSAJE_DE_FALLO, MENSAJES_DE_REVISION } from "@/lib/admin/pagos-reglas";
import { revisar, type EstadoRevision } from "./acciones";

// HU-020 sin navegador ni base: la acción con la sesión, la asignación y la revisión inventadas. Aquí se
// fija a dónde vuelve con cada resultado, que la acción ya no manda ningún correo (HU-076: los anota la base y
// salen por los procesos programados), que un error no vacía las observaciones y (HU-077) quién puede revisar antes de mirar el texto. La
// base de verdad la cubre integracion/revisar-pagos.test.ts.

const ID = "6a6a6a6a-0000-4000-8000-000000000020";
const RUTA = `/admin/pagos/${ID}`;
const YO = "a0a0a0a0-0000-4000-8000-000000000020";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002001";

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
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000020",
      rol: "admin",
    })),
    asignacion: vi.fn<(cliente: unknown, idPago: string) => Promise<{ idAdmin: string; revisionHasta: Date } | null>>(),
    revisarPago: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/pagos", () => ({ cargarAsignacion: h.asignacion, revisarPago: h.revisarPago }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoRevision = { error: null, valores: { observaciones: "" } };

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo la acción: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoRevision }> {
  try {
    return { estado: await revisar(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

const APROBAR = { id_pago: ID, decision: "aprobar" };
const RECHAZAR = { id_pago: ID, decision: "rechazar", observaciones: " Se cobra por fuera. " };

/** El instante en que vence la hora del asignado en las pruebas con reloj fijo. */
const LIMITE = new Date("2030-01-07T14:30:00.000Z");

beforeEach(() => {
  h.exigirRol.mockClear();
  // Salvo que la prueba diga otra cosa, la sesión es el admin asignado y su hora no ha pasado.
  h.asignacion.mockReset();
  h.asignacion.mockResolvedValue({ idAdmin: YO, revisionHasta: new Date(Date.now() + 30 * 60_000) });
  h.revisarPago.mockReset();
  h.revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("revisar (HU-020): lo que se guardó", () => {
  it("criterio 2: aprobar vuelve al pago con el éxito, refresca la bandeja y no le escribe a nadie", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "aprobado", canceloMonitoria: false });
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?revisado=aprobado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    // Con la sesión del admin, la misma que revisa.
    expect(h.asignacion).toHaveBeenCalledWith(h.cliente, ID);
    expect(h.revisarPago).toHaveBeenCalledWith(h.cliente, { idPago: ID, decision: "aprobar", observaciones: null });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it("HU-076: el rechazo que canceló la cita vuelve a `?revisado=rechazado` a secas; el correo ya no sale de la acción", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: true });
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado` });
    expect(h.revisarPago).toHaveBeenCalledWith(h.cliente, { idPago: ID, decision: "rechazar", observaciones: "Se cobra por fuera." });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it("P-24 o la cita ya cancelada: el rechazo vuelve igual, sin parámetros de correo", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: false });
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado` });
  });
});

describe("revisar: lo que no se guardó", () => {
  it.each(["ya_revisado", "no_asignado", "no_individual"] as const)(
    "%s cambió mientras el admin miraba: vuelve al pago, que se pinta como está ahora",
    async (resultado) => {
      h.revisarPago.mockResolvedValue({ resultado, canceloMonitoria: false });
      expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
      expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
      },
  );

  it("P-24 sin observaciones: dice qué falta, conserva lo escrito y vuelve a pintar la página", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "observaciones_requeridas", canceloMonitoria: false });
    expect(await enviar({ ...RECHAZAR, observaciones: "  " })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.observaciones_requeridas, valores: { observaciones: "  " } },
    });
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it.each(["observaciones_invalidas", "decision_invalida", "no_encontrado", "sin_permiso", "sin_sesion"] as const)(
    "%s se dice en el formulario",
    async (resultado) => {
      h.revisarPago.mockResolvedValue({ resultado, canceloMonitoria: false });
      expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJES_DE_REVISION[resultado], valores: { observaciones: RECHAZAR.observaciones } } });
    },
  );

  it("si la base falla, pide intentar de nuevo sin perder las observaciones", async () => {
    h.revisarPago.mockRejectedValue(new Error("se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { observaciones: RECHAZAR.observaciones } } });
    espia.mockRestore();
  });

  it("un formulario inválido no llega a la base", async () => {
    expect(await enviar({ id_pago: "otro", decision: "aprobar" })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.no_encontrado, valores: { observaciones: "" } },
    });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(await enviar({ id_pago: ID, decision: "deshacer" })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.decision_invalida, valores: { observaciones: "" } },
    });
    // Sin un pago y una decisión válidos ni siquiera se lee la asignación.
    expect(h.asignacion).not.toHaveBeenCalled();
    expect(await enviar({ ...RECHAZAR, observaciones: "a".repeat(501) })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.observaciones_invalidas, valores: { observaciones: "a".repeat(501) } },
    });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });

  it("se protege sola: sin admin, exigirRol redirige antes de revisar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(APROBAR)).toEqual({ destino: "/ingresar" });
    expect(h.asignacion).not.toHaveBeenCalled();
    expect(h.revisarPago).not.toHaveBeenCalled();
  });
});

describe("revisar (HU-077): quién revisa, antes que el texto (nota de D-39)", () => {
  const LARGAS = { ...RECHAZAR, observaciones: "a".repeat(501) };

  it("criterio 2: otro admin dentro de la hora del asignado vuelve con no_asignado, sin que importe el texto", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, revisionHasta: new Date(Date.now() + 30 * 60_000) });
    expect(await enviar(LARGAS)).toEqual({ destino: `${RUTA}?error=no_asignado` });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revisarPago).not.toHaveBeenCalled();
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?error=no_asignado` });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });

  it("criterio 1: con la hora del asignado vencida, otro admin llega a la base y vuelve con lo que guardó", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, revisionHasta: new Date(Date.now() - 60_000) });
    h.revisarPago.mockResolvedValue({ resultado: "aprobado", canceloMonitoria: false });
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?revisado=aprobado` });
    expect(h.revisarPago).toHaveBeenCalledWith(h.cliente, { idPago: ID, decision: "aprobar", observaciones: null });
  });

  it("con la hora vencida, el texto se mira después: unas observaciones demasiado largas no llegan a la base", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, revisionHasta: new Date(Date.now() - 60_000) });
    expect(await enviar(LARGAS)).toEqual({
      estado: { error: MENSAJES_DE_REVISION.observaciones_invalidas, valores: { observaciones: LARGAS.observaciones } },
    });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });

  it("supuesto 1 (P-40): justo en el límite todavía es solo del asignado; un milisegundo después, de cualquier admin", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: OTRO, revisionHasta: LIMITE });
    h.revisarPago.mockResolvedValue({ resultado: "aprobado", canceloMonitoria: false });
    vi.useFakeTimers({ now: LIMITE, toFake: ["Date"] });
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?error=no_asignado` });
    expect(h.revisarPago).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(LIMITE.getTime() + 1));
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?revisado=aprobado` });
    expect(h.revisarPago).toHaveBeenCalledTimes(1);
  });

  it("supuesto 5: el asignado sigue revisando después de su hora", async () => {
    h.asignacion.mockResolvedValue({ idAdmin: YO, revisionHasta: new Date(Date.now() - 60 * 60_000) });
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: false });
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado` });
  });

  it("un pago que no existe (o que la sesión no lee) lo dice en el formulario, sin revisar nada", async () => {
    h.asignacion.mockResolvedValue(null);
    expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJES_DE_REVISION.no_encontrado, valores: { observaciones: RECHAZAR.observaciones } } });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });

  it("si la asignación no se puede leer, pide intentar de nuevo sin perder las observaciones", async () => {
    h.asignacion.mockRejectedValue(new Error("se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(RECHAZAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { observaciones: RECHAZAR.observaciones } } });
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
    expect(h.revisarPago).not.toHaveBeenCalled();
  });
});
