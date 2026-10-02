import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENSAJE_DE_FALLO, MENSAJES_DE_REVISION } from "@/lib/admin/pagos-reglas";
import { revisar, type EstadoRevision } from "./acciones";

// HU-020 sin navegador ni base: la acción con la sesión, la revisión y el correo inventados. Aquí se fija a dónde
// vuelve con cada resultado, que el correo al pagador sale solo cuando el rechazo canceló la cita (supuesto 4) y que
// un error no vacía las observaciones. La base de verdad la cubre integracion/revisar-pagos.test.ts.

const ID = "6a6a6a6a-0000-4000-8000-000000000020";
const RUTA = `/admin/pagos/${ID}`;

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
    revisarPago: vi.fn(),
    avisar: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/pagos", () => ({ revisarPago: h.revisarPago, avisarRechazoAlPagador: h.avisar }));
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

beforeEach(() => {
  h.exigirRol.mockClear();
  h.revisarPago.mockReset();
  h.avisar.mockReset();
  h.revalidatePath.mockClear();
});

describe("revisar (HU-020): lo que se guardó", () => {
  it("criterio 2: aprobar vuelve al pago con el éxito, refresca la bandeja y no le escribe a nadie", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "aprobado", canceloMonitoria: false });
    expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?revisado=aprobado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.revisarPago).toHaveBeenCalledWith(h.cliente, { idPago: ID, decision: "aprobar", observaciones: null });
    expect(h.avisar).not.toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it("criterio 3: el rechazo que canceló la cita le avisa al pagador y dice cómo salió el correo", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: true });
    h.avisar.mockResolvedValue("enviado");
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado&correo=enviado` });
    expect(h.revisarPago).toHaveBeenCalledWith(h.cliente, { idPago: ID, decision: "rechazar", observaciones: "Se cobra por fuera." });
    expect(h.avisar).toHaveBeenCalledWith(ID);
  });

  it.each(["por_reintentar", "no_es_correo", "fallo"])("si el correo quedó %s, la página se lo dice al admin", async (aviso) => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: true });
    h.avisar.mockResolvedValue(aviso);
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado&correo=${aviso}` });
  });

  it("si el correo ya no aplica, vuelve sin aviso de correo", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: true });
    h.avisar.mockResolvedValue(null);
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado` });
  });

  it("P-24 o la cita ya cancelada: el rechazo no canceló nada y al pagador no se le escribe (supuesto 4)", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "rechazado", canceloMonitoria: false });
    expect(await enviar(RECHAZAR)).toEqual({ destino: `${RUTA}?revisado=rechazado` });
    expect(h.avisar).not.toHaveBeenCalled();
  });
});

describe("revisar: lo que no se guardó", () => {
  it.each(["ya_revisado", "no_asignado", "no_individual"] as const)(
    "%s cambió mientras el admin miraba: vuelve al pago, que se pinta como está ahora",
    async (resultado) => {
      h.revisarPago.mockResolvedValue({ resultado, canceloMonitoria: false });
      expect(await enviar(APROBAR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
      expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
      expect(h.avisar).not.toHaveBeenCalled();
    },
  );

  it("P-24 sin observaciones: dice qué falta, conserva lo escrito y vuelve a pintar la página", async () => {
    h.revisarPago.mockResolvedValue({ resultado: "observaciones_requeridas", canceloMonitoria: false });
    expect(await enviar({ ...RECHAZAR, observaciones: "  " })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.observaciones_requeridas, valores: { observaciones: "  " } },
    });
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
    expect(h.avisar).not.toHaveBeenCalled();
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
    expect(await enviar({ ...RECHAZAR, observaciones: "a".repeat(501) })).toEqual({
      estado: { error: MENSAJES_DE_REVISION.observaciones_invalidas, valores: { observaciones: "a".repeat(501) } },
    });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });

  it("se protege sola: sin admin, exigirRol redirige antes de revisar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(APROBAR)).toEqual({ destino: "/ingresar" });
    expect(h.revisarPago).not.toHaveBeenCalled();
  });
});
