import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AGENDA_DE_MUESTRA } from "@/lib/portada/agenda-de-muestra";
import type { Database } from "@/lib/supabase/tipos";
import { calcularEjemploDeGanancia, cargarEjemploDeGanancia } from "./ejemplo-de-ganancia";

const RN_81 = { comisionPorcentaje: 10, comisionTope: 15_000 };

function clienteFalso(respuesta: { data: unknown; error: { message: string } | null }) {
  const llamadas: string[] = [];
  const cliente = {
    rpc: (nombre: string) => {
      llamadas.push(nombre);
      return { single: async () => respuesta };
    },
  } as unknown as SupabaseClient<Database>;
  return { cliente, llamadas };
}

describe("calcularEjemploDeGanancia (HU-121)", () => {
  it("con los precios de muestra y RN-81 da los valores de la tabla de la HU", () => {
    expect(calcularEjemploDeGanancia(AGENDA_DE_MUESTRA, RN_81)).toEqual({
      porMonitoria: { laura: 22_500, santiago: 31_500, camila: 27_000 },
      porSemana: 81_000,
      porCuatroSemanas: 324_000,
    });
  });

  it("los precios de muestra son los de «Tus horarios»: 25.000, 35.000 y 30.000", () => {
    expect(AGENDA_DE_MUESTRA.map((m) => m.precio)).toEqual([25_000, 35_000, 30_000]);
  });

  it("respeta el tope: con un precio de 200.000 recibe 185.000 y no 180.000", () => {
    expect(calcularEjemploDeGanancia([{ clave: "a", precio: 200_000 }], RN_81).porMonitoria.a).toBe(185_000);
  });

  it("al cambiar un parámetro cambian los montos (12 % y 20.000)", () => {
    expect(calcularEjemploDeGanancia(AGENDA_DE_MUESTRA, { comisionPorcentaje: 12, comisionTope: 20_000 })).toEqual({
      porMonitoria: { laura: 22_000, santiago: 30_800, camila: 26_400 },
      porSemana: 79_200,
      porCuatroSemanas: 316_800,
    });
  });

  it("solo entrega netos: nada del resultado lleva el precio, el porcentaje ni el tope", () => {
    const resultado = calcularEjemploDeGanancia(AGENDA_DE_MUESTRA, RN_81);
    expect(Object.keys(resultado).sort()).toEqual(["porCuatroSemanas", "porMonitoria", "porSemana"]);
    const valores = [...Object.values(resultado.porMonitoria), resultado.porSemana, resultado.porCuatroSemanas];
    for (const prohibido of [25_000, 35_000, 30_000, 10, 15_000]) expect(valores).not.toContain(prohibido);
  });
});

describe("cargarEjemploDeGanancia (HU-121)", () => {
  it("lee los parámetros de parametros_comision() y calcula con ellos", async () => {
    const { cliente, llamadas } = clienteFalso({ data: { comision_porcentaje: 10, comision_tope: 15_000 }, error: null });
    expect((await cargarEjemploDeGanancia(cliente, AGENDA_DE_MUESTRA)).porSemana).toBe(81_000);
    expect(llamadas).toEqual(["parametros_comision"]);
  });

  it("si la base no los entrega, lanza: no hay valores viejos de respaldo", async () => {
    const { cliente } = clienteFalso({ data: null, error: { message: "permiso denegado" } });
    await expect(cargarEjemploDeGanancia(cliente, AGENDA_DE_MUESTRA)).rejects.toThrow("parámetros de comisión");
  });
});
