import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { limpiarComprobantesHuerfanos } from "./limpieza";

// Sin red ni base: `tomar_comprobantes_huerfanos` entrega lotes de una lista y el Storage borra lo que se le diga.

function doble(opciones: { huerfanos: string[]; noBorra?: Set<string>; falla?: boolean; errorAlTomar?: string }) {
  const pendientes = [...opciones.huerfanos];
  const tomas: { p_limite: number }[] = [];
  const borrados: string[][] = [];
  const cliente = {
    rpc: async (nombre: string, argumentos: { p_limite: number }) => {
      expect(nombre).toBe("tomar_comprobantes_huerfanos");
      tomas.push(argumentos);
      if (opciones.errorAlTomar) return { data: null, error: { message: opciones.errorAlTomar } };
      // Como la base: devuelve hasta p_limite de los que siguen en el bucket.
      return { data: pendientes.slice(0, argumentos.p_limite).map((ruta) => ({ ruta })), error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (rutas: string[]) => {
          expect(bucket).toBe("comprobantes");
          borrados.push(rutas);
          if (opciones.falla) return { data: null, error: { message: "boom" } };
          const hechos = rutas.filter((r) => !opciones.noBorra?.has(r));
          for (const r of hechos) pendientes.splice(pendientes.indexOf(r), 1);
          return { data: hechos.map((name) => ({ name })), error: null };
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { cliente, tomas, borrados };
}

const rutas = (n: number) => Array.from({ length: n }, (_, i) => `carpeta/${i}.png`);

describe("limpiarComprobantesHuerfanos", () => {
  it("sin huérfanos no borra nada", async () => {
    const { cliente, tomas, borrados } = doble({ huerfanos: [] });
    expect(await limpiarComprobantesHuerfanos({ cliente })).toEqual({ tomados: 0, borrados: 0, fallidos: 0 });
    // Solo el tamaño del lote: la edad la decide la base con su propio reloj.
    expect(tomas).toEqual([{ p_limite: 100 }]);
    expect(borrados).toEqual([]);
  });

  it("borra con la API de Storage lo que la base entrega", async () => {
    const { cliente, borrados } = doble({ huerfanos: rutas(3) });
    expect(await limpiarComprobantesHuerfanos({ cliente })).toEqual({ tomados: 3, borrados: 3, fallidos: 0 });
    expect(borrados).toEqual([rutas(3)]);
  });

  it("da varias vueltas por lotes hasta vaciar", async () => {
    const { cliente, tomas } = doble({ huerfanos: rutas(7) });
    expect(await limpiarComprobantesHuerfanos({ cliente, lote: 3 })).toEqual({ tomados: 7, borrados: 7, fallidos: 0 });
    expect(tomas.map((t) => t.p_limite)).toEqual([3, 3, 3]);
  });

  it("no da más vueltas que maxLotes en una corrida", async () => {
    const { cliente, tomas } = doble({ huerfanos: rutas(10) });
    expect(await limpiarComprobantesHuerfanos({ cliente, lote: 2, maxLotes: 2 })).toEqual({ tomados: 4, borrados: 4, fallidos: 0 });
    expect(tomas).toHaveLength(2);
  });

  it("si el Storage falla, lo cuenta como fallido y no insiste en la misma corrida", async () => {
    const { cliente, tomas } = doble({ huerfanos: rutas(3), falla: true });
    expect(await limpiarComprobantesHuerfanos({ cliente, lote: 3 })).toEqual({ tomados: 3, borrados: 0, fallidos: 3 });
    expect(tomas).toHaveLength(1);
  });

  it("si el Storage borra solo algunos, cuenta los que quedaron", async () => {
    const { cliente } = doble({ huerfanos: rutas(2), noBorra: new Set(["carpeta/1.png"]) });
    expect(await limpiarComprobantesHuerfanos({ cliente })).toEqual({ tomados: 2, borrados: 1, fallidos: 1 });
  });

  it("si la base no entrega los huérfanos, lanza para que el proceso responda 500", async () => {
    const { cliente } = doble({ huerfanos: [], errorAlTomar: "permission denied" });
    await expect(limpiarComprobantesHuerfanos({ cliente })).rejects.toThrow(/huérfanos: permission denied/);
  });
});
