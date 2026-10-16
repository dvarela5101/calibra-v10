import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { describirReglaDeComision, textoDeLaReglaDeComision } from "./regla-general";

// HU-096: el texto del registro con las cifras de la base. Intl separa el signo de pesos con un espacio duro.
const normal = (texto: string) => texto.replace(/\xa0/g, " ");

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

describe("textoDeLaReglaDeComision", () => {
  it("con el 10 % y 15.000 de RN-81 dice el texto de la HU, palabra por palabra", () => {
    expect(normal(textoDeLaReglaDeComision({ comisionPorcentaje: 10, comisionTope: 15_000 }))).toBe(
      "Por cada monitoría, Calibra descuenta una comisión del 10 % del total pagado, con un máximo de $ 15.000. Se descuenta de lo que te transferimos.",
    );
  });

  it("con otros valores cambia la cifra sin tocar la app (12 % y 20.000)", () => {
    const texto = normal(textoDeLaReglaDeComision({ comisionPorcentaje: 12, comisionTope: 20_000 }));
    expect(texto).toContain("del 12 % del total pagado");
    expect(texto).toContain("un máximo de $ 20.000.");
    expect(texto).not.toContain("10 %");
    expect(texto).not.toContain("15.000");
  });

  it("el tope sale con formatearPesos (puntos de miles, sin decimales)", () => {
    expect(normal(textoDeLaReglaDeComision({ comisionPorcentaje: 10, comisionTope: 1_234_567 }))).toContain("$ 1.234.567.");
  });

  it("no promete, no da ejemplos y no usa «bruto» ni «neto»", () => {
    const texto = textoDeLaReglaDeComision({ comisionPorcentaje: 10, comisionTope: 15_000 });
    expect(texto).not.toMatch(/bruto|neto|ejemplo|si la monitor|ganar|ganancia|plazo/i);
    // Las únicas cifras son el porcentaje y el tope.
    expect(normal(texto).match(/\d+(\.\d{3})*/g)).toEqual(["10", "15.000"]);
  });
});

describe("describirReglaDeComision", () => {
  it("lee parametros_comision y arma la línea con lo que devuelve", async () => {
    const { cliente, llamadas } = clienteFalso({ data: { comision_porcentaje: 12, comision_tope: 20000 }, error: null });
    const texto = normal(await describirReglaDeComision(cliente));
    expect(llamadas).toEqual(["parametros_comision"]);
    expect(texto).toContain("12 %");
    expect(texto).toContain("$ 20.000");
  });

  it("si la lectura falla, lanza con el mensaje de la base", async () => {
    const { cliente } = clienteFalso({ data: null, error: { message: "permission denied for function parametros_comision" } });
    await expect(describirReglaDeComision(cliente)).rejects.toThrow(/permission denied/);
  });

  it("si los parámetros llegan mal, lanza y dice cuál", async () => {
    const { cliente } = clienteFalso({ data: { comision_porcentaje: 10, comision_tope: -1 }, error: null });
    await expect(describirReglaDeComision(cliente)).rejects.toThrow(/comision_tope/);
  });
});
