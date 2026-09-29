import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { PARAMETROS_DEL_DOCUMENTO } from "../../../pruebas/plazos-referencia";
import { cargarParametros, comoParametros } from "./parametros";

/** La fila tal como la devuelve `parametros_negocio()`. */
const FILA = {
  reserva_min: 10,
  revision_min: 60,
  antelacion_individual_min: 180,
  antelacion_grupal_min: 2160,
  cancelacion_individual_min: 720,
  cancelacion_grupal_min: 1440,
  pago_integrantes_min: 1440,
  diferencia_min: 300,
  reporte_inasistencia_min: 1440,
  resena_grupal_min: 60,
  desembolso_min: 1440,
  comision_porcentaje: 10,
  comision_tope: 15000,
};

describe("comoParametros", () => {
  it("convierte la fila de la base a los nombres de la app", () => {
    expect(comoParametros(FILA)).toEqual(PARAMETROS_DEL_DOCUMENTO);
  });

  it("ignora columnas que no conoce", () => {
    expect(comoParametros({ ...FILA, columna_nueva: 1 })).toEqual(PARAMETROS_DEL_DOCUMENTO);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["un texto", "10"],
    ["una lista (rpc sin .single())", [FILA]],
  ])("rechaza %s", (_nombre, valor) => {
    expect(() => comoParametros(valor)).toThrow();
  });

  it("rechaza una columna que falta y dice cuál", () => {
    const sinReserva: Partial<typeof FILA> = { ...FILA };
    delete sinReserva.reserva_min;
    expect(() => comoParametros(sinReserva)).toThrow(/reserva_min/);
  });

  it.each([
    ["negativo", -1],
    ["decimal", 1.5],
    ["texto", "10"],
    ["nulo", null],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
  ])("rechaza un valor %s", (_nombre, valor) => {
    expect(() => comoParametros({ ...FILA, comision_tope: valor })).toThrow(/comision_tope/);
  });

  it("acepta cero: un plazo o una comisión pueden ser 0", () => {
    expect(comoParametros({ ...FILA, comision_porcentaje: 0 }).comisionPorcentaje).toBe(0);
  });
});

describe("cargarParametros", () => {
  /** Cliente falso: `rpc(nombre).single()` devuelve lo que se le diga. */
  function clienteFalso(respuesta: { data: unknown; error: { message: string } | null }) {
    const llamadas: string[] = [];
    const cliente = {
      rpc(nombre: string) {
        llamadas.push(nombre);
        return { single: async () => respuesta };
      },
    } as unknown as SupabaseClient<Database>;
    return { cliente, llamadas };
  }

  it("llama a parametros_negocio y devuelve los parámetros", async () => {
    const { cliente, llamadas } = clienteFalso({ data: FILA, error: null });
    await expect(cargarParametros(cliente)).resolves.toEqual(PARAMETROS_DEL_DOCUMENTO);
    expect(llamadas).toEqual(["parametros_negocio"]);
  });

  it("si la base falla, lo dice con el mensaje de la base", async () => {
    const { cliente } = clienteFalso({ data: null, error: { message: "permission denied" } });
    await expect(cargarParametros(cliente)).rejects.toThrow(/permission denied/);
  });

  it("si la base devuelve algo raro, no lo deja pasar", async () => {
    const { cliente } = clienteFalso({ data: { ...FILA, revision_min: -5 }, error: null });
    await expect(cargarParametros(cliente)).rejects.toThrow(/revision_min/);
  });
});
