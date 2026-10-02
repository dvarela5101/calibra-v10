import { beforeEach, describe, expect, it, vi } from "vitest";
import { desactivarCuenta } from "./cuentas";

// desactivarCuenta con el cliente de service_role simulado: el orden de las llamadas y qué pasa cuando una falla.
// Que la base de verdad mueva los casos lo prueban integracion/equipo.test.ts e integracion/reasignar-pagos.test.ts.

type Respuesta = { error: { message: string } | null };

const simulado = vi.hoisted(() => ({
  llamadas: [] as string[],
  reasignaciones: [] as Respuesta[],
  baneo: { error: null } as Respuesta,
}));

vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => ({
    rpc: async (funcion: string) => {
      simulado.llamadas.push(funcion);
      return simulado.reasignaciones.shift() ?? { data: 0, error: null };
    },
    auth: {
      admin: {
        updateUserById: async () => {
          simulado.llamadas.push("banear");
          return simulado.baneo;
        },
      },
    },
  }),
}));

beforeEach(() => {
  simulado.llamadas = [];
  simulado.reasignaciones = [];
  simulado.baneo = { error: null };
});

describe("desactivarCuenta (P-44, HU-074)", () => {
  it("reasigna, banea y vuelve a reasignar los casos que llegaron mientras tanto", async () => {
    await desactivarCuenta("a0000000-0000-4000-8000-000000000074");
    expect(simulado.llamadas).toEqual(["reasignar_casos_de_admin", "banear", "reasignar_casos_de_admin"]);
  });

  it("si la primera reasignación falla, no banea", async () => {
    simulado.reasignaciones = [{ error: { message: "sin_otro_admin" } }];
    await expect(desactivarCuenta("a0000000-0000-4000-8000-000000000074")).rejects.toThrow(
      "No se pudieron reasignar sus casos: sin_otro_admin",
    );
    expect(simulado.llamadas).toEqual(["reasignar_casos_de_admin"]);
  });

  it("si Auth responde con error, igual vuelve a reasignar (el baneo pudo quedar aplicado) y después lanza ese error", async () => {
    simulado.baneo = { error: { message: "Gateway Timeout" } };
    await expect(desactivarCuenta("a0000000-0000-4000-8000-000000000074")).rejects.toMatchObject({ message: "Gateway Timeout" });
    expect(simulado.llamadas).toEqual(["reasignar_casos_de_admin", "banear", "reasignar_casos_de_admin"]);
  });

  it("si la segunda reasignación falla, dice que la cuenta ya quedó desactivada", async () => {
    simulado.reasignaciones = [{ error: null }, { error: { message: "sin_otro_admin" } }];
    await expect(desactivarCuenta("a0000000-0000-4000-8000-000000000074")).rejects.toThrow(
      "La cuenta ya quedó desactivada, pero no se pudieron pasar los casos que le llegaron mientras tanto: sin_otro_admin",
    );
  });
});
