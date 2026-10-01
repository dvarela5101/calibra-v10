import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mensajeDeSubida, subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { limpiarComprobantesHuerfanos } from "@/lib/comprobantes/limpieza";
import { BUCKET_COMPROBANTES, mensajeDeCuota, rutaDeComprobante } from "@/lib/comprobantes/reglas";
import { revisarComprobante } from "@/lib/comprobantes/revision";
import { exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-067 contra el Supabase LOCAL con Storage real: un comprobante subido no se reemplaza, ni siquiera por
// su dueño con una URL de subida firmada creada con upsert, ni por el servidor con la llave secreta.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let fx: Fixtures;
let bd: pg.Client;

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  await bd.end();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 8, 7, 6, 5, 4]);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const blob = (bytes: Uint8Array, tipo: string) => new Blob([bytes as BlobPart], { type: tipo });

/** Lo que hay en el bucket en esa ruta, visto con la llave secreta. */
async function contenido(ruta: string): Promise<Uint8Array | null> {
  const { data, error } = await fx.admin.storage.from(BUCKET_COMPROBANTES).download(ruta);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

describe("criterios 1 y 2: el dueño no pisa su comprobante con una URL firmada creada con upsert", () => {
  it("el flujo de tres pasos: la segunda subida con el mismo token se rechaza y el contenido sigue siendo el primero", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const bucket = cliente.storage.from(BUCKET_COMPROBANTES);
    const ruta = rutaDeComprobante(id, "png");
    fx.registrarComprobante(ruta);

    // 1. Pide la URL con upsert para una ruta suya que todavía no existe.
    const firmada = await bucket.createSignedUploadUrl(ruta, { upsert: true });
    expect(firmada.error).toBeNull();
    // 2. Sube un archivo con ese token.
    const primera = await bucket.uploadToSignedUrl(ruta, firmada.data!.token, blob(PNG, "image/png"), { contentType: "image/png" });
    expect(primera.error).toBeNull();
    // 3. Con el mismo token intenta subir otro distinto a la misma ruta.
    const segunda = await bucket.uploadToSignedUrl(ruta, firmada.data!.token, blob(JPG, "image/jpeg"), { contentType: "image/jpeg" });

    expect(segunda.error, "la segunda subida debía rechazarse").not.toBeNull();
    expect(await contenido(ruta)).toEqual(PNG);
    // El Storage traduce el 42501 del trigger a 403, y la persona ve el mensaje de permiso, no el de la cuota.
    const error = segunda.error as { message: string; statusCode?: string };
    expect(String(error.statusCode)).toBe("403");
    const mensaje = mensajeDeSubida(error);
    expect(mensaje).toBe("No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo.");
    expect(mensaje).not.toBe(mensajeDeCuota());
  });

  it("tampoco con varias URL firmadas con upsert pedidas antes de que exista el archivo", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const bucket = cliente.storage.from(BUCKET_COMPROBANTES);
    const ruta = rutaDeComprobante(id, "png");
    fx.registrarComprobante(ruta);
    const una = await bucket.createSignedUploadUrl(ruta, { upsert: true });
    const otra = await bucket.createSignedUploadUrl(ruta, { upsert: true });
    expect(una.error ?? otra.error).toBeNull();

    expect((await bucket.uploadToSignedUrl(ruta, una.data!.token, blob(PNG, "image/png"), { contentType: "image/png" })).error).toBeNull();
    expect((await bucket.uploadToSignedUrl(ruta, otra.data!.token, blob(JPG, "image/jpeg"), { contentType: "image/jpeg" })).error).not.toBeNull();
    expect(await contenido(ruta)).toEqual(PNG);
  });

  it("ni el servidor con la llave secreta reemplaza un comprobante", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const subida = await subirComprobante(cliente, id, new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    if (!subida.ok) throw new Error(subida.mensaje);
    fx.registrarComprobante(subida.ruta);

    const pisada = await fx.admin.storage.from(BUCKET_COMPROBANTES).upload(subida.ruta, blob(JPG, "image/jpeg"), { contentType: "image/jpeg", upsert: true });
    expect(pisada.error).not.toBeNull();
    expect(await contenido(subida.ruta)).toEqual(PNG);

    const movida = await fx.admin.storage.from(BUCKET_COMPROBANTES).move(subida.ruta, rutaDeComprobante(id, "png"));
    expect(movida.error).not.toBeNull();
    expect(await contenido(subida.ruta)).toEqual(PNG);
  });

  it("leer, firmar un enlace y listar siguen funcionando", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const subida = await subirComprobante(cliente, id, new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    if (!subida.ok) throw new Error(subida.mensaje);
    fx.registrarComprobante(subida.ruta);
    const bucket = cliente.storage.from(BUCKET_COMPROBANTES);
    expect((await bucket.download(subida.ruta)).error).toBeNull();
    expect((await bucket.createSignedUrl(subida.ruta, 60)).error).toBeNull();
    expect((await bucket.list(id)).data?.map((o) => `${id}/${o.name}`)).toContain(subida.ruta);
  });
});

describe("criterio 3: el servidor sigue borrando comprobantes", () => {
  it("la limpieza de huérfanos (HU-059) borra un comprobante viejo sin pago", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const subida = await subirComprobante(cliente, id, new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    if (!subida.ok) throw new Error(subida.mensaje);
    fx.registrarComprobante(subida.ruta);
    await bd.query(
      "update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'comprobantes' and name = $1",
      [subida.ruta],
    );

    const resumen = await limpiarComprobantesHuerfanos({ cliente: fx.admin });

    expect(resumen.fallidos).toBe(0);
    expect(await contenido(subida.ruta)).toBeNull();
  });

  it("la revisión (HU-059) sigue descartando un comprobante con contenido falso", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, "png");
    fx.registrarComprobante(ruta);
    expect((await cliente.storage.from(BUCKET_COMPROBANTES).upload(ruta, blob(HTML, "image/png"), { contentType: "image/png" })).error).toBeNull();

    expect(await revisarComprobante(fx.admin, ruta)).toMatchObject({ ok: false, motivo: "contenido_no_coincide" });
    expect(await contenido(ruta)).toBeNull();
  });
});
