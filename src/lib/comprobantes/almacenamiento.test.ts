import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { consultarCuota, crearEnlaceDeComprobante, enlaceDeComprobanteDePago, mensajeDeSubida, subirComprobante } from "./almacenamiento";
import { BUCKET_COMPROBANTES, MENSAJE_TIPO, VIGENCIA_ENLACE_COMPROBANTE_SEG, mensajeDeCuota } from "./reglas";

// Sin red ni base: el cliente es un doble que registra lo que se le pide y devuelve lo que se le diga.

const ID = "0f9d5e1c-3b7a-4c52-9d11-6a1f2b3c4d5e";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type ErrorDeStorage = { message: string; statusCode?: string };

type RespuestaDeCuota = { data: { usados: number; maximo: number; libre_desde: string | null } | null; error: { message: string } | null };
const CUOTA_LIBRE: RespuestaDeCuota = { data: { usados: 0, maximo: 5, libre_desde: null }, error: null };

function clienteConSubida(respuesta: { error: ErrorDeStorage | null }, cuota: RespuestaDeCuota = CUOTA_LIBRE) {
  const subidas: { bucket: string; ruta: string; opciones: unknown }[] = [];
  const consultas: string[] = [];
  const cliente = {
    rpc: (nombre: string) => {
      consultas.push(nombre);
      return { maybeSingle: async () => cuota };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (ruta: string, _archivo: unknown, opciones: unknown) => {
          subidas.push({ bucket, ruta, opciones });
          return respuesta;
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { cliente, subidas, consultas };
}

const png = () => new File([PNG], "captura.png", { type: "image/png" });

describe("mensajeDeSubida: el error del Storage se vuelve un mensaje claro", () => {
  it.each([
    ["413 por código", { statusCode: "413", message: "x" }, "El comprobante es demasiado pesado. Comprime la imagen o toma otra captura."],
    ["413 por texto", { message: "The object exceeded the maximum allowed size" }, "El comprobante es demasiado pesado. Comprime la imagen o toma otra captura."],
    ["415 por código", { statusCode: "415", message: "x" }, MENSAJE_TIPO],
    ["415 por texto", { message: "mime type text/plain is not supported" }, MENSAJE_TIPO],
    ["403", { statusCode: "403", message: "x" }, "No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo."],
    ["401", { statusCode: "401", message: "x" }, "No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo."],
    ["política de filas", { message: "new row violates row-level security policy" }, "No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo."],
    ["cuota llena (el trigger de la base, 23514)", { statusCode: "500", message: "database error, code: 23514" }, mensajeDeCuota()],
    ["500", { statusCode: "500", message: "boom" }, "No se pudo subir el comprobante. Inténtalo de nuevo."],
    ["sin código ni pista", { message: "algo raro" }, "No se pudo subir el comprobante. Inténtalo de nuevo."],
  ])("%s", (_nombre, error, esperado) => {
    expect(mensajeDeSubida(error)).toBe(esperado);
  });

  it("no filtra el texto del servidor", () => {
    expect(mensajeDeSubida({ statusCode: "500", message: "duplicate key value violates unique constraint objects_pkey" })).not.toContain(
      "objects_pkey",
    );
  });
});

describe("subirComprobante", () => {
  it("sube al bucket privado, en la carpeta del usuario, sin pisar y con el tipo validado", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null });
    const resultado = await subirComprobante(cliente, ID, png());

    expect(resultado.ok).toBe(true);
    expect(subidas).toHaveLength(1);
    expect(subidas[0].bucket).toBe(BUCKET_COMPROBANTES);
    expect(subidas[0].ruta.startsWith(`${ID}/`)).toBe(true);
    expect(subidas[0].ruta.endsWith(".png")).toBe(true);
    expect(subidas[0].opciones).toEqual({ contentType: "image/png", upsert: false });
    expect(resultado.ok && resultado.ruta).toBe(subidas[0].ruta);
  });

  it("no toca el Storage si la validación falla", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null });
    const texto = new File(["hola"], "notas.txt", { type: "text/plain" });
    expect(await subirComprobante(cliente, ID, texto)).toEqual({ ok: false, mensaje: MENSAJE_TIPO });
    expect(subidas).toEqual([]);
  });

  it("devuelve el mensaje del Storage traducido cuando la subida falla", async () => {
    const { cliente } = clienteConSubida({ error: { statusCode: "413", message: "The object exceeded the maximum allowed size" } });
    expect(await subirComprobante(cliente, ID, png())).toEqual({
      ok: false,
      mensaje: "El comprobante es demasiado pesado. Comprime la imagen o toma otra captura.",
    });
  });

  it("si no puede leer el archivo, lo dice y no sube nada", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null });
    const ilegible = {
      name: "a.png",
      type: "image/png",
      size: 100,
      slice: () => ({
        arrayBuffer: async () => {
          throw new Error("permiso denegado");
        },
      }),
    } as unknown as File;
    expect(await subirComprobante(cliente, ID, ilegible)).toEqual({
      ok: false,
      mensaje: "No se pudo leer el archivo. Vuelve a elegirlo.",
    });
    expect(subidas).toEqual([]);
  });

  it("un id de usuario que no es uuid es un error de programación, no un mensaje para la persona", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null });
    await expect(subirComprobante(cliente, "no-es-uuid", png())).rejects.toThrow(RangeError);
    expect(subidas).toEqual([]);
  });
});

describe("subirComprobante y la cuota por sesión (HU-059)", () => {
  it("pregunta la cuota antes de subir", async () => {
    const { cliente, consultas, subidas } = clienteConSubida({ error: null });
    expect((await subirComprobante(cliente, ID, png())).ok).toBe(true);
    expect(consultas).toEqual(["mi_cuota_de_comprobantes"]);
    expect(subidas).toHaveLength(1);
  });

  it("con la cuota llena no sube y dice desde cuándo puede subir otro", async () => {
    const libre = "2026-10-01T21:09:26.419Z";
    const { cliente, subidas } = clienteConSubida({ error: null }, { data: { usados: 5, maximo: 5, libre_desde: libre }, error: null });
    expect(await subirComprobante(cliente, ID, png())).toEqual({ ok: false, mensaje: mensajeDeCuota(5, new Date(libre)) });
    expect(subidas).toEqual([]);
  });

  it("con 4 de 5 todavía sube", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null }, { data: { usados: 4, maximo: 5, libre_desde: null }, error: null });
    expect((await subirComprobante(cliente, ID, png())).ok).toBe(true);
    expect(subidas).toHaveLength(1);
  });

  it("si no puede saber la cuota, intenta la subida: la base la hace cumplir igual", async () => {
    const { cliente, subidas } = clienteConSubida({ error: null }, { data: null, error: { message: "sin red" } });
    expect((await subirComprobante(cliente, ID, png())).ok).toBe(true);
    expect(subidas).toHaveLength(1);
  });

  it("no pregunta la cuota si el archivo ya no sirve", async () => {
    const { cliente, consultas } = clienteConSubida({ error: null });
    await subirComprobante(cliente, ID, new File(["hola"], "notas.txt", { type: "text/plain" }));
    expect(consultas).toEqual([]);
  });

  it("consultarCuota convierte la respuesta de la base", async () => {
    const { cliente } = clienteConSubida({ error: null }, { data: { usados: 2, maximo: 5, libre_desde: "2026-10-01T00:00:00Z" }, error: null });
    expect(await consultarCuota(cliente)).toEqual({ usados: 2, maximo: 5, libreDesde: new Date("2026-10-01T00:00:00Z") });
    const sinDatos = clienteConSubida({ error: null }, { data: null, error: null });
    expect(await consultarCuota(sinDatos.cliente)).toBeNull();
  });
});

describe("enlaces firmados", () => {
  function clienteConFirma(respuesta: { data: { signedUrl: string } | null; error: unknown }) {
    const peticiones: { bucket: string; ruta: string; segundos: number }[] = [];
    const cliente = {
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (ruta: string, segundos: number) => {
            peticiones.push({ bucket, ruta, segundos });
            return respuesta;
          },
        }),
      },
    } as unknown as SupabaseClient<Database>;
    return { cliente, peticiones };
  }

  it("pide la firma al bucket privado con la vigencia por defecto (60 s)", async () => {
    const { cliente, peticiones } = clienteConFirma({ data: { signedUrl: "http://x/firmado" }, error: null });
    expect(await crearEnlaceDeComprobante(cliente, `${ID}/a.png`)).toEqual({ ok: true, url: "http://x/firmado" });
    expect(peticiones).toEqual([{ bucket: BUCKET_COMPROBANTES, ruta: `${ID}/a.png`, segundos: 60 }]);
    expect(VIGENCIA_ENLACE_COMPROBANTE_SEG).toBe(60);
  });

  it("acepta otra vigencia si quien llama la pide", async () => {
    const { cliente, peticiones } = clienteConFirma({ data: { signedUrl: "http://x/firmado" }, error: null });
    await crearEnlaceDeComprobante(cliente, `${ID}/a.png`, 2);
    expect(peticiones[0].segundos).toBe(2);
  });

  it.each([
    ["con error", { data: null, error: { message: "not found" } }],
    ["sin URL", { data: null, error: null }],
  ])("si el Storage no firma (%s), no da enlace y no filtra detalles", async (_nombre, respuesta) => {
    const { cliente } = clienteConFirma(respuesta);
    expect(await crearEnlaceDeComprobante(cliente, `${ID}/a.png`)).toEqual({ ok: false, mensaje: "No se pudo abrir el comprobante." });
  });

  it("enlaceDeComprobanteDePago lee pago.comprobante por id y firma esa ruta", async () => {
    const consultas: { tabla: string; columnas: string; columna: string; valor: unknown }[] = [];
    const firmas: string[] = [];
    const cliente = {
      from: (tabla: string) => ({
        select: (columnas: string) => ({
          eq: (columna: string, valor: unknown) => ({
            maybeSingle: async () => {
              consultas.push({ tabla, columnas, columna, valor });
              return { data: { comprobante: `${ID}/b.pdf` }, error: null };
            },
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async (ruta: string) => {
            firmas.push(ruta);
            return { data: { signedUrl: "http://x/pago" }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClient<Database>;

    const idPago = "1b9d5e1c-3b7a-4c52-9d11-6a1f2b3c4d5e";
    expect(await enlaceDeComprobanteDePago(cliente, idPago)).toEqual({ ok: true, url: "http://x/pago" });
    expect(consultas).toEqual([{ tabla: "pago", columnas: "comprobante", columna: "id", valor: idPago }]);
    expect(firmas).toEqual([`${ID}/b.pdf`]);
  });

  it("si el pago no existe o no se puede leer, no firma nada", async () => {
    let firmo = false;
    const cliente = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      storage: {
        from: () => ({
          createSignedUrl: async () => {
            firmo = true;
            return { data: { signedUrl: "http://x" }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClient<Database>;
    expect(await enlaceDeComprobanteDePago(cliente, "x")).toEqual({ ok: false, mensaje: "No se encontró el pago." });
    expect(firmo).toBe(false);
  });
});
