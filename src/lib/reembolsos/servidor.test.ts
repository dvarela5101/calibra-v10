import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";

// HU-025 sin base: las tres puertas con un cliente falso que solo sabe `rpc`, más la de reenviar el enlace que usa
// HU-026. Qué responde la base en cada caso lo fijan supabase/tests/llave_reembolso.test.sql y la integración.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { RESULTADOS_DE_ENTREGAR, RESULTADOS_DE_REABRIR, RESULTADOS_DE_REENVIAR } from "./reglas";
import { entregarLlavePorToken, leerLlavePorToken, reabrirReembolso, reenviarPedidoDeLlave } from "./servidor";

const TOKEN = "a".repeat(64);
const LLAVE = "300 123 4567";
const ID = "0000000a-0000-4000-8000-000000000025";

function clienteQueResponde(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { cliente: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

afterEach(() => {
  admin.cliente = null;
});

describe("leerLlavePorToken (la página de la llave)", () => {
  it("un valor sin forma de token es null sin consultar la base ni tocar la llave secreta", async () => {
    // `admin.cliente` es null: si el código intentara usarlo, fallaría.
    for (const malo of ["", "abc", "A".repeat(64), "a".repeat(63), `${"a".repeat(64)}0`, ` ${TOKEN}`]) {
      expect(await leerLlavePorToken(malo), JSON.stringify(malo)).toBeNull();
    }
  });

  it("con la llave secreta y el token, devuelve lo que la página muestra", async () => {
    const { cliente, rpc } = clienteQueResponde([{ estado: "esperando_llave", monto: 25_000, motivo: "Motivo", vence_en: "2026-10-10T20:00:00+00:00" }]);
    admin.cliente = cliente;
    expect(await leerLlavePorToken(TOKEN)).toEqual({ estado: "esperando_llave", monto: 25_000, motivo: "Motivo", venceEn: new Date("2026-10-10T20:00:00.000Z") });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("datos_de_llave", { p_token: TOKEN });
  });

  it("un token que no es de ningún reembolso es null", async () => {
    admin.cliente = clienteQueResponde([]).cliente;
    expect(await leerLlavePorToken(TOKEN)).toBeNull();
  });

  it("si la base falla lanza, sin el token en el mensaje", async () => {
    admin.cliente = clienteQueResponde(null, { message: "caída" }).cliente;
    const falla = await leerLlavePorToken(TOKEN).catch((error: Error) => error);
    expect((falla as Error).message).toBe("No se pudo leer el reembolso: caída");
    expect((falla as Error).message).not.toContain(TOKEN);
  });

  it("lanza si la base devuelve un estado que no conoce", async () => {
    admin.cliente = clienteQueResponde([{ estado: "perdido", monto: 1, motivo: "m", vence_en: "2026-10-10T20:00:00+00:00" }]).cliente;
    await expect(leerLlavePorToken(TOKEN)).rejects.toThrow("Estado de la llave desconocido");
  });
});

describe("entregarLlavePorToken (criterio 2)", () => {
  it("un valor sin forma de token es no_existe sin consultar la base", async () => {
    for (const malo of ["", "abc", "A".repeat(64)]) expect(await entregarLlavePorToken(malo, LLAVE), JSON.stringify(malo)).toBe("no_existe");
  });

  it("llama a la base con la llave secreta, el token y la llave, y devuelve el resultado tal cual", async () => {
    for (const resultado of RESULTADOS_DE_ENTREGAR) {
      const { cliente, rpc } = clienteQueResponde(resultado);
      admin.cliente = cliente;
      expect(await entregarLlavePorToken(TOKEN, LLAVE), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("entregar_llave", { p_token: TOKEN, p_llave: LLAVE });
    }
  });

  it("si la base responde algo que no conoce lanza, en vez de decir que se guardó", async () => {
    for (const raro of ["guardada", "", null, 1]) {
      admin.cliente = clienteQueResponde(raro).cliente;
      await expect(entregarLlavePorToken(TOKEN, LLAVE), JSON.stringify(raro)).rejects.toThrow("Respuesta inesperada al guardar la llave");
    }
  });

  it("si la base falla lanza, sin el token ni la llave en el mensaje", async () => {
    admin.cliente = clienteQueResponde(null, { message: "caída" }).cliente;
    const falla = (await entregarLlavePorToken(TOKEN, LLAVE).catch((error: Error) => error)) as Error;
    expect(falla.message).toBe("No se pudo guardar la llave: caída");
    expect(falla.message).not.toContain(TOKEN);
    expect(falla.message).not.toContain(LLAVE);
  });
});

describe("reabrirReembolso (criterio 5, supuesto 4)", () => {
  it("un id que no es un uuid es no_encontrado sin consultar", async () => {
    const { cliente, rpc } = clienteQueResponde("reabierto");
    for (const malo of ["", "no-es-un-id", `${ID}0`]) expect(await reabrirReembolso(cliente, malo), malo).toBe("no_encontrado");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("usa el cliente de la sesión, no la llave secreta, y devuelve el resultado tal cual", async () => {
    admin.cliente = { rpc: () => Promise.reject(new Error("no debía usarse")) };
    for (const resultado of RESULTADOS_DE_REABRIR) {
      const { cliente, rpc } = clienteQueResponde(resultado);
      expect(await reabrirReembolso(cliente, ID), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("reabrir_reembolso", { p_id_reembolso: ID });
    }
  });

  it("si la base falla o responde algo que no conoce lanza", async () => {
    await expect(reabrirReembolso(clienteQueResponde(null, { message: "sin sesión" }).cliente, ID)).rejects.toThrow("No se pudo reabrir el reembolso: sin sesión");
    await expect(reabrirReembolso(clienteQueResponde("reenviado").cliente, ID)).rejects.toThrow("Respuesta inesperada al reabrir el reembolso");
  });
});

describe("reenviarPedidoDeLlave (HU-026, criterio 3)", () => {
  it("un id que no es un uuid es no_encontrado sin consultar", async () => {
    const { cliente, rpc } = clienteQueResponde("reenviado");
    for (const malo of ["", "no-es-un-id", `${ID}0`, "1 or 1=1"]) expect(await reenviarPedidoDeLlave(cliente, malo), malo).toBe("no_encontrado");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("usa el cliente de la sesión, no la llave secreta, y devuelve el resultado tal cual", async () => {
    admin.cliente = { rpc: () => Promise.reject(new Error("no debía usarse")) };
    for (const resultado of RESULTADOS_DE_REENVIAR) {
      const { cliente, rpc } = clienteQueResponde(resultado);
      expect(await reenviarPedidoDeLlave(cliente, ID), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("reenviar_pedido_llave", { p_id_reembolso: ID });
    }
  });

  it("si la base falla lanza, en vez de decir que se reenvió", async () => {
    await expect(reenviarPedidoDeLlave(clienteQueResponde(null, { message: "sin sesión" }).cliente, ID)).rejects.toThrow(
      "No se pudo reenviar el enlace: sin sesión",
    );
  });

  it("si la base responde algo que no conoce lanza", async () => {
    for (const raro of ["reabierto", "", null, 1]) {
      await expect(reenviarPedidoDeLlave(clienteQueResponde(raro).cliente, ID), JSON.stringify(raro)).rejects.toThrow(
        "Respuesta inesperada al reenviar el enlace",
      );
    }
  });
});
