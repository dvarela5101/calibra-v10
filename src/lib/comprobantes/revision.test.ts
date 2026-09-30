import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { MENSAJE_CONTENIDO } from "./reglas";
import { revisarComprobante } from "./revision";

// Sin red ni base: el cliente es un doble que registra lo que se le pide y devuelve lo que se le diga.

const CARPETA = "0f9d5e1c-3b7a-4c52-9d11-6a1f2b3c4d5e";
const ARCHIVO = "6a1f2b3c-4d5e-4c52-9d11-0f9d5e1c3b7a";
const ruta = (extension: string) => `${CARPETA}/${ARCHIVO}.${extension}`;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const HTML = new TextEncoder().encode("<!doctype html>");

type ErrorDeDoble = { message: string; code?: string; statusCode?: string } | null;

function doble(opciones: {
  descarga?: { data: Blob | null; error: ErrorDeDoble };
  anotar?: { data: string | null; error: ErrorDeDoble };
  borrarRevisado?: ErrorDeDoble;
  quitar?: ErrorDeDoble;
}) {
  const llamadas: string[] = [];
  const guardados: unknown[] = [];
  const cliente = {
    storage: {
      from: (bucket: string) => ({
        download: async (r: string) => {
          llamadas.push(`download ${bucket} ${r}`);
          return opciones.descarga ?? { data: null, error: { message: "Object not found", statusCode: "404" } };
        },
        remove: async (rutas: string[]) => {
          llamadas.push(`remove ${bucket} ${rutas.join(",")}`);
          return { data: opciones.quitar ? null : rutas.map((name) => ({ name })), error: opciones.quitar ?? null };
        },
      }),
    },
    rpc: async (nombre: string, argumentos: unknown) => {
      llamadas.push(`rpc ${nombre}`);
      guardados.push({ nombre, argumentos });
      return opciones.anotar ?? { data: "anotado", error: null };
    },
    from: (tabla: string) => ({
      delete: () => ({
        eq: async (columna: string, valor: string) => {
          llamadas.push(`delete ${tabla} ${columna}=${valor}`);
          return { error: opciones.borrarRevisado ?? null };
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>;
  return { cliente, llamadas, guardados };
}

const archivoCon = (bytes: Uint8Array, tipo: string) => ({ data: new Blob([bytes as BlobPart], { type: tipo }), error: null });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("revisarComprobante: contenido que coincide", () => {
  it.each([
    ["PNG", PNG, "image/png", "png"],
    ["JPG", JPG, "image/jpeg", "jpg"],
    ["PDF", PDF, "application/pdf", "pdf"],
  ])("un %s de verdad queda anotado como revisado y no se borra", async (_nombre, bytes, tipo, extension) => {
    const { cliente, llamadas, guardados } = doble({ descarga: archivoCon(bytes, tipo) });
    expect(await revisarComprobante(cliente, ruta(extension))).toEqual({ ok: true, tipo });
    expect(guardados).toEqual([{ nombre: "anotar_comprobante_revisado", argumentos: { p_ruta: ruta(extension), p_tipo: tipo } }]);
    expect(llamadas.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("ignora los parámetros del tipo que devuelve el Storage", async () => {
    const { cliente } = doble({ descarga: archivoCon(PNG, "image/png; charset=binary") });
    expect(await revisarComprobante(cliente, ruta("png"))).toEqual({ ok: true, tipo: "image/png" });
  });

  it("si no puede anotarlo, no dice que está bien", async () => {
    const { cliente } = doble({ descarga: archivoCon(PNG, "image/png"), anotar: { data: null, error: { message: "permission denied" } } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "fallo" });
  });

  it("si la base dice que tiene más de 24 horas, no queda revisado y pide subirlo de nuevo", async () => {
    const { cliente, llamadas } = doble({ descarga: archivoCon(PNG, "image/png"), anotar: { data: "vencido", error: null } });
    expect(await revisarComprobante(cliente, ruta("png"))).toEqual({
      ok: false,
      motivo: "vencido",
      mensaje: "Este comprobante se subió hace más de 24 horas y ya no se puede usar. Vuelve a subirlo.",
    });
    expect(llamadas.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("si el archivo desapareció entre la descarga y la anotación, dice que no existe", async () => {
    const { cliente } = doble({ descarga: archivoCon(PNG, "image/png"), anotar: { data: "no_existe", error: null } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "no_existe" });
  });

  it("una respuesta desconocida de la base no se toma como anotado", async () => {
    const { cliente } = doble({ descarga: archivoCon(PNG, "image/png"), anotar: { data: "otra cosa", error: null } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "fallo" });
  });
});

describe("revisarComprobante: contenido que no coincide se descarta", () => {
  it.each([
    ["un HTML declarado PNG", HTML, "image/png", "png"],
    ["un PNG declarado PDF", PNG, "application/pdf", "pdf"],
    ["un JPG con ruta .png", JPG, "image/jpeg", "png"],
    ["un PNG declarado JPG con ruta .jpg", PNG, "image/jpeg", "jpg"],
    ["un PNG bien declarado pero con ruta .pdf", PNG, "image/png", "pdf"],
    // Contenido y extensión coinciden; lo único falso es el tipo declarado.
    ["un PNG con ruta .png declarado JPG", PNG, "image/jpeg", "png"],
    ["un PDF con ruta .pdf declarado PNG", PDF, "image/png", "pdf"],
  ])("%s: quita la fila de revisado, borra el archivo y no lo anota", async (_nombre, bytes, tipo, extension) => {
    const { cliente, llamadas, guardados } = doble({ descarga: archivoCon(bytes, tipo) });
    expect(await revisarComprobante(cliente, ruta(extension))).toEqual({ ok: false, motivo: "contenido_no_coincide", mensaje: MENSAJE_CONTENIDO });
    expect(guardados).toEqual([]);
    // Primero la fila de revisado y después el archivo.
    expect(llamadas.slice(1)).toEqual([`delete comprobante_revisado ruta=${ruta(extension)}`, `remove comprobantes ${ruta(extension)}`]);
  });

  it("si un pago ya usa el comprobante (23503), lo conserva: es la evidencia de ese pago", async () => {
    const { cliente, llamadas } = doble({ descarga: archivoCon(HTML, "image/png"), borrarRevisado: { message: "violates foreign key", code: "23503" } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "contenido_no_coincide" });
    expect(llamadas.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("si no puede quitar la fila de revisado por otra razón, no borra nada y lo dice", async () => {
    const { cliente, llamadas } = doble({ descarga: archivoCon(HTML, "image/png"), borrarRevisado: { message: "timeout" } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "fallo" });
    expect(llamadas.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("si el Storage no lo borra, igual queda descartado: sin revisar, ningún pago le apunta", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente } = doble({ descarga: archivoCon(HTML, "image/png"), quitar: { message: "boom" } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "contenido_no_coincide" });
    expect(aviso).toHaveBeenCalledOnce();
  });
});

describe("revisarComprobante: lo que no se puede revisar", () => {
  it.each(["", "comprobante.png", `${CARPETA}/../x.png`, `${CARPETA}/${ARCHIVO}.gif`, `${CARPETA}/${ARCHIVO}.png/otro`])(
    "rechaza la ruta %j sin tocar el Storage",
    async (r) => {
      const { cliente, llamadas } = doble({});
      expect(await revisarComprobante(cliente, r)).toMatchObject({ ok: false, motivo: "ruta_invalida" });
      expect(llamadas).toEqual([]);
    },
  );

  it("un comprobante que no existe", async () => {
    const { cliente } = doble({ descarga: { data: null, error: { message: "Object not found", statusCode: "404" } } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "no_existe" });
  });

  it("un error del Storage que no es 404 no se confunde con 'no existe' y no borra nada", async () => {
    const { cliente, llamadas } = doble({ descarga: { data: null, error: { message: "Service Unavailable", statusCode: "503" } } });
    expect(await revisarComprobante(cliente, ruta("png"))).toMatchObject({ ok: false, motivo: "fallo" });
    expect(llamadas).toEqual([`download comprobantes ${ruta("png")}`]);
  });
});
