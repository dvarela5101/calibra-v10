import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";

// HU-029 sin base ni red: un cliente falso que solo sabe `rpc`. La prueba de integración comprueba el cableado con la base real.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { reportarInasistenciaDeMiCita, reportarInasistenciaPorToken } from "./reportar";
import { RESULTADOS_DE_REPORTAR } from "./reportar-reglas";

const TOKEN = "d".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Un cliente que responde a `rpc` con lo que se le diga. */
function clienteFalso(respuesta: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => respuesta);
  return { cliente: { rpc } as unknown as SupabaseClient<Database>, rpc };
}
const conResultado = (data: unknown) => clienteFalso({ data, error: null });
const conError = (message: string) => clienteFalso({ data: null, error: { message } });

afterEach(() => {
  admin.cliente = null;
});

describe("reportarInasistenciaPorToken (criterio 1 de HU-029, puerta del enlace del correo)", () => {
  it("un token sin forma de token es no_existe sin consultar la base ni tocar la llave secreta", async () => {
    // `admin.cliente` es null: si el código intentara usarlo, fallaría.
    for (const malo of ["", "abc", "A".repeat(64), "d".repeat(63), `${"d".repeat(64)}0`, `${"d".repeat(63)}\n`]) {
      expect(await reportarInasistenciaPorToken(malo), JSON.stringify(malo)).toBe("no_existe");
    }
  });

  it("llama a la base con la llave secreta y el token, y devuelve el resultado tal cual", async () => {
    for (const resultado of RESULTADOS_DE_REPORTAR) {
      const { cliente, rpc } = conResultado(resultado);
      admin.cliente = cliente;
      expect(await reportarInasistenciaPorToken(TOKEN), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledWith("reportar_inasistencia_por_token", { p_token: TOKEN });
    }
  });

  it("si la base responde algo que no conoce lanza, en vez de decirle a la persona que se reportó", async () => {
    for (const raro of ["cancelada", "", null, 1]) {
      admin.cliente = conResultado(raro).cliente;
      await expect(reportarInasistenciaPorToken(TOKEN), JSON.stringify(raro)).rejects.toThrow("Respuesta inesperada al reportar la inasistencia");
    }
  });

  it("si la base falla lanza, sin repetir el token en el mensaje", async () => {
    admin.cliente = conError("caída").cliente;
    const falla = await reportarInasistenciaPorToken(TOKEN).catch((error: Error) => error);
    expect(falla).toBeInstanceOf(Error);
    expect((falla as Error).message).toBe("No se pudo reportar la inasistencia: caída");
    expect((falla as Error).message).not.toContain(TOKEN);
  });
});

describe("reportarInasistenciaDeMiCita (criterio 1 de HU-029, puerta de la sesión del Lead)", () => {
  it("un id que no es un uuid es no_existe sin consultar", async () => {
    const { cliente, rpc } = conResultado("reportada");
    for (const malo of ["", "no-es-un-id", `${id(1)}0`, `${id(1)}\n`]) {
      expect(await reportarInasistenciaDeMiCita(cliente, malo), JSON.stringify(malo)).toBe("no_existe");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("llama a la base con la sesión de quien mira y devuelve el resultado tal cual", async () => {
    for (const resultado of RESULTADOS_DE_REPORTAR) {
      const { cliente, rpc } = conResultado(resultado);
      expect(await reportarInasistenciaDeMiCita(cliente, id(1)), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledWith("reportar_inasistencia_de_mi_cita", { p_id_monitoria: id(1) });
    }
  });

  it("no usa la llave secreta: trabaja con el cliente que recibe", async () => {
    admin.cliente = { rpc: () => Promise.reject(new Error("no debía usarse")) };
    await expect(reportarInasistenciaDeMiCita(conResultado("reportada").cliente, id(1))).resolves.toBe("reportada");
  });

  it("si la base falla o responde algo que no conoce lanza", async () => {
    await expect(reportarInasistenciaDeMiCita(conError("sin sesión").cliente, id(1))).rejects.toThrow("No se pudo reportar la inasistencia: sin sesión");
    await expect(reportarInasistenciaDeMiCita(conResultado("cancelada").cliente, id(1))).rejects.toThrow("Respuesta inesperada al reportar la inasistencia");
  });
});
