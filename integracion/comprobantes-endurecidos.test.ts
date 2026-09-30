import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/limpiar-comprobantes/route";
import { consultarCuota, mensajeDeSubida, subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { limpiarComprobantesHuerfanos } from "@/lib/comprobantes/limpieza";
import {
  BUCKET_COMPROBANTES,
  CUOTA_COMPROBANTES,
  HUERFANO_TRAS_HORAS,
  MENSAJE_CONTENIDO,
  VENTANA_CUOTA_HORAS,
  mensajeDeCuota,
  rutaDeComprobante,
} from "@/lib/comprobantes/reglas";
import { revisarComprobante } from "@/lib/comprobantes/revision";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-059 contra el Supabase LOCAL con Storage real: revisión del contenido en el servidor, limpieza de
// huérfanos y cuota por sesión. Cada prueba crea sus usuarios y archivos y los borra al final.

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
  vi.unstubAllEnvs();
  await fx.limpiar();
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 8, 7, 6, 5, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

const archivo = (bytes: Uint8Array, nombre: string, tipo: string) => new File([bytes as BlobPart], nombre, { type: tipo });
const blob = (bytes: Uint8Array, tipo: string) => new Blob([bytes as BlobPart], { type: tipo });

/** Sube por la API de Storage, saltándose la validación de la app (lo que haría alguien a mano). */
async function subirCrudo(cliente: Awaited<ReturnType<Fixtures["crearAnonimo"]>>["cliente"], ruta: string, bytes: Uint8Array, tipo: string) {
  const resultado = await cliente.storage.from(BUCKET_COMPROBANTES).upload(ruta, blob(bytes, tipo), { contentType: tipo, upsert: false });
  fx.registrarComprobante(ruta);
  return resultado;
}

async function existeEnElBucket(ruta: string): Promise<boolean> {
  const [carpeta, nombre] = ruta.split("/");
  const { data } = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(carpeta, { limit: 1000 });
  return (data ?? []).some((o) => o.name === nombre);
}

async function estaRevisado(ruta: string): Promise<boolean> {
  const { data, error } = await fx.admin.from("comprobante_revisado").select("ruta").eq("ruta", ruta);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

/** Corre la fecha de subida de unos archivos hacia atrás, como si se hubieran subido hace `horas`. */
async function envejecer(rutas: string[], horas: number): Promise<void> {
  const { rowCount } = await bd.query(
    "update storage.objects set created_at = now() - make_interval(hours => $2) where bucket_id = 'comprobantes' and name = any($1::text[])",
    [rutas, horas],
  );
  expect(rowCount).toBe(rutas.length);
}

/** Corre hacia atrás las subidas de una sesión en el registro de la cuota. */
async function envejecerSubidas(carpeta: string, horas: number): Promise<void> {
  const { rowCount } = await bd.query(
    "update privado.subida_comprobante set subido_en = now() - make_interval(hours => $2) where carpeta = $1",
    [carpeta, horas],
  );
  expect(rowCount).toBeGreaterThan(0);
}

describe("los números de la base son los de la app (N-4)", () => {
  it("cuota de 5 cada 24 horas y huérfanos después de 24 horas", async () => {
    const { rows } = await bd.query("select * from public.parametros_comprobantes()");
    expect(rows[0]).toEqual({
      cuota_subidas: CUOTA_COMPROBANTES,
      cuota_ventana_min: VENTANA_CUOTA_HORAS * 60,
      huerfano_tras_min: HUERFANO_TRAS_HORAS * 60,
    });
    // Y escritos a mano, para que un cambio sea a propósito en los dos lados.
    expect([CUOTA_COMPROBANTES, VENTANA_CUOTA_HORAS, HUERFANO_TRAS_HORAS]).toEqual([5, 24, 24]);
  });
});

describe("criterio 1: un archivo cuyo contenido no es el tipo declarado se descarta y ningún pago le apunta", () => {
  it.each([
    ["un HTML declarado como PNG", HTML, "image/png", "png"],
    ["un PNG declarado como PDF", PNG, "application/pdf", "pdf"],
    ["un JPG declarado como JPG pero con ruta .png", JPG, "image/jpeg", "png"],
    ["un PDF declarado como PNG", PDF, "image/png", "png"],
    // El contenido y la extensión coinciden; lo único falso es el tipo declarado.
    ["un PNG con ruta .png pero declarado como JPG", PNG, "image/jpeg", "png"],
  ])("%s subido directo a la API", async (_nombre, bytes, tipo, extension) => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, extension);
    expect((await subirCrudo(cliente, ruta, bytes, tipo)).error).toBeNull();
    expect(await existeEnElBucket(ruta)).toBe(true);

    const revision = await revisarComprobante(fx.admin, ruta);

    expect(revision).toEqual({ ok: false, motivo: "contenido_no_coincide", mensaje: MENSAJE_CONTENIDO });
    expect(await existeEnElBucket(ruta)).toBe(false);
    expect(await estaRevisado(ruta)).toBe(false);

    // Y ningún pago puede apuntarle: la llave foránea a comprobante_revisado lo impide.
    const admin = await fx.crearAdmin();
    const contexto = await fx.crearContextoDeMonitoria(admin.id);
    const monitoria = await fx.crearMonitoria(contexto, { fecha: "2030-01-07" });
    const { data, error } = await fx.admin
      .from("pago")
      .insert({
        id_monitoria: monitoria.id,
        monto: 25_000,
        nombre_pagador: "Pagador",
        contacto: "pagador@calibra.test",
        id_admin: admin.id,
        comprobante: ruta,
      })
      .select("id");
    // Si una regresión lo dejara pasar, el pago se borra aquí para no ensuciar la base local.
    if (data?.length) await fx.admin.from("pago").delete().in("id", data.map((p) => p.id));
    expect(error?.code).toBe("23503");
  });

  it.each([
    ["un PNG", PNG, "image/png", "png"],
    ["un JPG", JPG, "image/jpeg", "jpg"],
    ["un PDF", PDF, "application/pdf", "pdf"],
  ])("%s de verdad queda revisado, se conserva y un pago sí le puede apuntar", async (_nombre, bytes, tipo, extension) => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, extension);
    expect((await subirCrudo(cliente, ruta, bytes, tipo)).error).toBeNull();

    expect(await revisarComprobante(fx.admin, ruta)).toEqual({ ok: true, tipo });
    expect(await estaRevisado(ruta)).toBe(true);
    expect(await existeEnElBucket(ruta)).toBe(true);

    const admin = await fx.crearAdmin();
    const { pago } = await fx.crearPago({ idAdmin: admin.id, comprobante: ruta });
    expect(pago.comprobante).toBe(ruta);
  });

  it("revisar dos veces el mismo comprobante bueno no duplica nada", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const subida = await subirComprobante(cliente, id, archivo(PNG, "a.png", "image/png"));
    if (!subida.ok) throw new Error(subida.mensaje);
    fx.registrarComprobante(subida.ruta);
    expect((await revisarComprobante(fx.admin, subida.ruta)).ok).toBe(true);
    expect((await revisarComprobante(fx.admin, subida.ruta)).ok).toBe(true);
    const { count } = await fx.admin.from("comprobante_revisado").select("ruta", { count: "exact", head: true }).eq("ruta", subida.ruta);
    expect(count).toBe(1);
  });

  it("un comprobante de más de 24 horas ya no se anota: es de la limpieza de huérfanos", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, "png");
    expect((await subirCrudo(cliente, ruta, PNG, "image/png")).error).toBeNull();
    await envejecer([ruta], 25);
    expect(await revisarComprobante(fx.admin, ruta)).toMatchObject({ ok: false, motivo: "vencido" });
    expect(await estaRevisado(ruta)).toBe(false);
    expect(await existeEnElBucket(ruta)).toBe(true);
  });

  it("un comprobante que no existe o una ruta que no es de comprobante no se revisan", async () => {
    expect(await revisarComprobante(fx.admin, `${randomUUID()}/${randomUUID()}.png`)).toMatchObject({ ok: false, motivo: "no_existe" });
    expect(await revisarComprobante(fx.admin, "../otro/archivo.png")).toMatchObject({ ok: false, motivo: "ruta_invalida" });
  });

  it("con la sesión de una persona no se puede revisar: la tabla de revisados es solo del servidor", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, "png");
    expect((await subirCrudo(cliente, ruta, PNG, "image/png")).error).toBeNull();
    expect(await revisarComprobante(cliente, ruta)).toMatchObject({ ok: false, motivo: "fallo" });
    expect(await estaRevisado(ruta)).toBe(false);
    const escritura = await cliente.from("comprobante_revisado").insert({ ruta, tipo: "image/png" });
    expect(escritura.error).not.toBeNull();
  });

  it("la puerta del servidor usa la llave secreta del entorno", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const ruta = rutaDeComprobante(id, "png");
    expect((await subirCrudo(cliente, ruta, HTML, "image/png")).error).toBeNull();
    expect(await revisarComprobanteDesdeServidor(ruta)).toMatchObject({ ok: false, motivo: "contenido_no_coincide" });
    expect(await existeEnElBucket(ruta)).toBe(false);
  });
});

describe("criterio 2: un comprobante de más de 24 horas sin pago se borra; uno con pago nunca", () => {
  it("la limpieza borra el huérfano viejo con la API de Storage y deja el que un pago usa y el reciente", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const subir = async (nombre: string) => {
      const r = await subirComprobante(cliente, id, archivo(PNG, nombre, "image/png"));
      if (!r.ok) throw new Error(r.mensaje);
      fx.registrarComprobante(r.ruta);
      return r.ruta;
    };
    const huerfanoViejo = await subir("viejo.png");
    const conPago = await subir("con-pago.png");
    const reciente = await subir("reciente.png");
    expect((await revisarComprobante(fx.admin, huerfanoViejo)).ok).toBe(true);
    expect((await revisarComprobante(fx.admin, conPago)).ok).toBe(true);
    const admin = await fx.crearAdmin();
    await fx.crearPago({ idAdmin: admin.id, comprobante: conPago });
    await envejecer([huerfanoViejo, conPago], 25);

    const resumen = await limpiarComprobantesHuerfanos({ cliente: fx.admin });

    expect(resumen.fallidos).toBe(0);
    expect(resumen.borrados).toBeGreaterThanOrEqual(1);
    expect(await existeEnElBucket(huerfanoViejo)).toBe(false);
    expect(await estaRevisado(huerfanoViejo)).toBe(false);
    expect(await existeEnElBucket(conPago)).toBe(true);
    expect(await estaRevisado(conPago)).toBe(true);
    expect(await existeEnElBucket(reciente)).toBe(true);

    // Una segunda pasada no encuentra nada más de esta sesión.
    await limpiarComprobantesHuerfanos({ cliente: fx.admin });
    expect(await existeEnElBucket(conPago)).toBe(true);
    expect(await existeEnElBucket(reciente)).toBe(true);
  });

  it("con una sesión de persona la limpieza no corre: solo el servidor toma huérfanos", async () => {
    const { cliente } = await fx.crearAnonimo();
    await expect(limpiarComprobantesHuerfanos({ cliente })).rejects.toThrow(/huérfanos/);
  });

  it("la ruta del proceso programado exige el secreto y, con él, limpia", async () => {
    const secreto = "s".repeat(40);
    vi.stubEnv("CRON_SECRETO", secreto);
    const pedir = (autorizacion?: string) =>
      POST(new Request("http://localhost/api/procesos/limpiar-comprobantes", {
        method: "POST",
        headers: autorizacion ? { authorization: autorizacion } : {},
      }));

    expect((await pedir()).status).toBe(401);
    expect((await pedir(`Bearer ${"x".repeat(40)}`)).status).toBe(401);

    const { cliente, id } = await fx.crearAnonimo();
    const r = await subirComprobante(cliente, id, archivo(PNG, "a.png", "image/png"));
    if (!r.ok) throw new Error(r.mensaje);
    fx.registrarComprobante(r.ruta);
    await envejecer([r.ruta], 25);

    const respuesta = await pedir(`Bearer ${secreto}`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ fallidos: 0 });
    expect(await existeEnElBucket(r.ruta)).toBe(false);
  });
});

describe("criterio 3: una sesión sube máximo 5 comprobantes cada 24 horas", () => {
  async function llenarCuota() {
    const sesion = await fx.crearAnonimo();
    const rutas: string[] = [];
    for (let i = 0; i < CUOTA_COMPROBANTES; i++) {
      const r = await subirComprobante(sesion.cliente, sesion.id, archivo(PNG, `c${i}.png`, "image/png"));
      if (!r.ok) throw new Error(`la subida ${i + 1} debía entrar: ${r.mensaje}`);
      fx.registrarComprobante(r.ruta);
      rutas.push(r.ruta);
    }
    return { ...sesion, rutas };
  }

  it("la sexta subida desde la app se rechaza con un mensaje claro, sin intentar subir", async () => {
    const { cliente, id } = await llenarCuota();

    const sexta = await subirComprobante(cliente, id, archivo(PNG, "sexta.png", "image/png"));

    expect(sexta.ok).toBe(false);
    if (sexta.ok) return;
    expect(sexta.mensaje).toMatch(/^Ya subiste 5 comprobantes en las últimas 24 horas, el máximo permitido\. Podrás subir otro desde el .+\.$/);
    const { data } = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(data).toHaveLength(CUOTA_COMPROBANTES);
  });

  it("la cuota dice cuántas lleva y desde cuándo se libera un cupo", async () => {
    const { cliente, id } = await llenarCuota();
    const cuota = await consultarCuota(cliente);
    expect(cuota).toMatchObject({ usados: 5, maximo: 5 });
    const { rows } = await bd.query("select min(subido_en) as primera from privado.subida_comprobante where carpeta = $1", [id]);
    expect(cuota?.libreDesde?.getTime()).toBe((rows[0].primera as Date).getTime() + VENTANA_CUOTA_HORAS * 3_600_000);
  });

  it("cuenta subidas, no archivos: si la revisión descarta lo subido, el cupo no vuelve", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    for (let i = 0; i < CUOTA_COMPROBANTES; i++) {
      const ruta = rutaDeComprobante(id, "png");
      expect((await subirCrudo(cliente, ruta, HTML, "image/png")).error).toBeNull();
      expect(await revisarComprobante(fx.admin, ruta)).toMatchObject({ motivo: "contenido_no_coincide" });
    }
    const { data } = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(data ?? []).toHaveLength(0);

    const sexta = await subirComprobante(cliente, id, archivo(PNG, "sexta.png", "image/png"));
    if (sexta.ok) fx.registrarComprobante(sexta.ruta);
    expect(sexta.ok).toBe(false);
  });

  it("la base la hace cumplir aunque se salte la app, y el mensaje se traduce", async () => {
    const { cliente, id } = await llenarCuota();
    const { error } = await subirCrudo(cliente, rutaDeComprobante(id, "png"), PNG, "image/png");
    expect(error).not.toBeNull();
    expect(mensajeDeSubida(error as { message: string; statusCode?: string })).toBe(mensajeDeCuota());
    const { data } = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(data).toHaveLength(CUOTA_COMPROBANTES);
  });

  it("tampoco se evade con URL de subida firmadas pedidas antes de llenar la cuota", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const bucket = cliente.storage.from(BUCKET_COMPROBANTES);
    const firmadas: { ruta: string; token: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const ruta = rutaDeComprobante(id, "png");
      fx.registrarComprobante(ruta);
      const { data, error } = await bucket.createSignedUploadUrl(ruta);
      expect(error).toBeNull();
      firmadas.push({ ruta, token: data!.token });
    }
    for (let i = 0; i < CUOTA_COMPROBANTES; i++) {
      const r = await subirComprobante(cliente, id, archivo(PNG, `c${i}.png`, "image/png"));
      if (!r.ok) throw new Error(r.mensaje);
      fx.registrarComprobante(r.ruta);
    }
    for (const { ruta, token } of firmadas) {
      const { error } = await bucket.uploadToSignedUrl(ruta, token, blob(PNG, "image/png"), { contentType: "image/png" });
      expect(error, "subida con token por encima de la cuota").not.toBeNull();
    }
    const { data } = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(data).toHaveLength(CUOTA_COMPROBANTES);
  });

  it("la cuota es de cada sesión: otra sigue subiendo", async () => {
    await llenarCuota();
    const otra = await fx.crearAnonimo();
    const r = await subirComprobante(otra.cliente, otra.id, archivo(PNG, "otra.png", "image/png"));
    if (r.ok) fx.registrarComprobante(r.ruta);
    expect(r.ok).toBe(true);
  });

  it("pasadas las 24 horas, la sesión vuelve a subir", async () => {
    const { cliente, id } = await llenarCuota();
    await envejecerSubidas(id, 25);
    const r = await subirComprobante(cliente, id, archivo(PNG, "nueva.png", "image/png"));
    if (r.ok) fx.registrarComprobante(r.ruta);
    expect(r.ok).toBe(true);
  });
});
