import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearEnlaceDeComprobante, enlaceDeComprobanteDePago, subirComprobante } from "@/lib/comprobantes/almacenamiento";
import {
  BUCKET_COMPROBANTES,
  LIMITE_COMPROBANTE_BYTES,
  TIPOS_DE_COMPROBANTE,
  esRutaDeComprobante,
  rutaDeComprobante,
} from "@/lib/comprobantes/reglas";
import { crearCliente, exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-007 contra el Supabase LOCAL con Storage real (bucket, políticas, límites y enlaces firmados).
// Cada prueba crea sus propios usuarios y archivos y los borra al final.

let fx: Fixtures;

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

// Contenidos mínimos con la firma de cada formato (el Storage no mira el contenido; la app sí).
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 8, 7, 6, 5, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

const CONTENIDO: Record<keyof typeof TIPOS_DE_COMPROBANTE, Uint8Array> = {
  "image/png": PNG,
  "image/jpeg": JPG,
  "application/pdf": PDF,
};

const archivo = (bytes: Uint8Array | number, nombre: string, tipo: string) =>
  new File([typeof bytes === "number" ? new Uint8Array(bytes) : (bytes as BlobPart)], nombre, { type: tipo });

/**
 * Sube con la API de Storage por fuera de la validación de la app, para probar lo que el servidor
 * hace cumplir. Si la subida llegara a funcionar (una regla rota), el archivo queda anotado para que
 * la limpieza no deje huérfanos en la base local.
 */
async function subirCrudo(cliente: ReturnType<typeof crearCliente>, ruta: string, contenido: Blob, tipo: string) {
  const resultado = await cliente.storage.from(BUCKET_COMPROBANTES).upload(ruta, contenido, { contentType: tipo, upsert: false });
  if (!resultado.error) fx.registrarComprobante(ruta);
  return resultado;
}

/** Segundos que le quedan a un enlace firmado: salen del `exp` del token que trae la URL. */
function segundosRestantes(url: string): number {
  const token = new URL(url).searchParams.get("token");
  const carga = JSON.parse(Buffer.from(token!.split(".")[1], "base64url").toString("utf8")) as { exp: number };
  return carga.exp - Math.floor(Date.now() / 1000);
}

/** Un pagador: una sesión anónima que ya subió un PNG a su carpeta. */
async function pagadorConComprobante() {
  const { cliente, id } = await fx.crearAnonimo();
  const resultado = await subirComprobante(cliente, id, archivo(PNG, "captura.png", "image/png"));
  if (!resultado.ok) throw new Error(`no se pudo preparar el comprobante: ${resultado.mensaje}`);
  fx.registrarComprobante(resultado.ruta);
  return { cliente, id, ruta: resultado.ruta };
}

describe("el bucket", () => {
  it("es privado y su límite y sus tipos son los que declara la app", async () => {
    const { data, error } = await fx.admin.storage.getBucket(BUCKET_COMPROBANTES);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
    expect(data?.file_size_limit).toBe(LIMITE_COMPROBANTE_BYTES);
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(Object.keys(TIPOS_DE_COMPROBANTE).sort());
  });
});

describe("criterio 1: el pagador sube un JPG, un PNG o un PDF dentro del límite", () => {
  it.each(Object.entries(CONTENIDO))("guarda un %s en su carpeta del bucket privado", async (tipo, bytes) => {
    const { cliente, id } = await fx.crearAnonimo();
    const resultado = await subirComprobante(cliente, id, archivo(bytes, "comprobante", tipo));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    fx.registrarComprobante(resultado.ruta);

    expect(resultado.ruta.startsWith(`${id}/`)).toBe(true);
    expect(esRutaDeComprobante(resultado.ruta)).toBe(true);
    expect(resultado.ruta.endsWith(`.${TIPOS_DE_COMPROBANTE[tipo as keyof typeof TIPOS_DE_COMPROBANTE]}`)).toBe(true);

    // Está en el bucket y el dueño lo baja tal cual.
    const enBucket = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(enBucket.data?.map((o) => `${id}/${o.name}`)).toContain(resultado.ruta);
    const descarga = await cliente.storage.from(BUCKET_COMPROBANTES).download(resultado.ruta);
    expect(descarga.error).toBeNull();
    expect(new Uint8Array(await descarga.data!.arrayBuffer())).toEqual(bytes);
  });

  it("sube un archivo del tamaño exacto del límite", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const bytes = new Uint8Array(LIMITE_COMPROBANTE_BYTES);
    bytes.set(PDF);
    const resultado = await subirComprobante(cliente, id, archivo(bytes, "grande.pdf", "application/pdf"));
    expect(resultado.ok).toBe(true);
    if (resultado.ok) fx.registrarComprobante(resultado.ruta);
  });

  it("cada subida es un archivo nuevo: dos subidas iguales no se pisan", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const a = await subirComprobante(cliente, id, archivo(PNG, "a.png", "image/png"));
    const b = await subirComprobante(cliente, id, archivo(PNG, "a.png", "image/png"));
    if (a.ok) fx.registrarComprobante(a.ruta);
    if (b.ok) fx.registrarComprobante(b.ruta);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.ruta !== b.ruta).toBe(true);
  });

  it("el pago apunta al archivo: un admin lo abre desde el pago con un enlace firmado", async () => {
    // Dos pagos con comprobantes distintos: el enlace debe salir del pago que se pidió, no de otro.
    const primero = await pagadorConComprobante();
    const segundo = await pagadorConComprobante();
    const admin = await fx.crearAdmin();
    const { pago: pagoUno } = await fx.crearPago({ idAdmin: admin.id, comprobante: primero.ruta });
    const { pago: pagoDos } = await fx.crearPago({ idAdmin: admin.id, comprobante: segundo.ruta });
    const clienteAdmin = await fx.iniciarSesion(admin);

    for (const [pago, pagador] of [
      [pagoUno, primero],
      [pagoDos, segundo],
    ] as const) {
      const enlace = await enlaceDeComprobanteDePago(clienteAdmin, pago.id);
      expect(enlace.ok).toBe(true);
      if (!enlace.ok) return;
      expect(enlace.url).toContain(`/object/sign/${BUCKET_COMPROBANTES}/${pagador.ruta}`);
      expect(segundosRestantes(enlace.url)).toBeGreaterThan(0);
      expect(segundosRestantes(enlace.url)).toBeLessThanOrEqual(60);

      const respuesta = await fetch(enlace.url);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toMatch(/^image\/png/);
      expect(new Uint8Array(await respuesta.arrayBuffer())).toEqual(PNG);
    }
    expect(primero.ruta).not.toBe(segundo.ruta);
  });
});

describe("criterio 2: un archivo de otro tipo o más grande que el límite se rechaza con un mensaje claro", () => {
  it.each([
    ["un texto", archivo(PNG, "notas.txt", "text/plain"), "El comprobante debe ser una imagen JPG o PNG, o un PDF."],
    ["un GIF", archivo(PNG, "a.gif", "image/gif"), "El comprobante debe ser una imagen JPG o PNG, o un PDF."],
    ["un SVG", archivo(PNG, "a.svg", "image/svg+xml"), "El comprobante debe ser una imagen JPG o PNG, o un PDF."],
    ["un archivo vacío", archivo(0, "vacio.png", "image/png"), "El archivo está vacío. Elige la captura o el PDF del comprobante."],
    [
      "un archivo de 5,1 MB",
      archivo(LIMITE_COMPROBANTE_BYTES + 1, "grande.png", "image/png"),
      "El comprobante pesa 5,1 MB y el máximo es 5 MB. Comprime la imagen o toma otra captura.",
    ],
    [
      "un HTML que se hace pasar por PNG",
      archivo(new TextEncoder().encode("<!doctype html><script>alert(1)</script>"), "falso.png", "image/png"),
      "El contenido del archivo no coincide con su formato. Sube la captura o el PDF original.",
    ],
  ])("subirComprobante rechaza %s y no sube nada", async (_nombre, entrada, mensaje) => {
    const { cliente, id } = await fx.crearAnonimo();
    const resultado = await subirComprobante(cliente, id, entrada);
    if (resultado.ok) fx.registrarComprobante(resultado.ruta);
    expect(resultado).toEqual({ ok: false, mensaje });

    const enBucket = await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id);
    expect(enBucket.data ?? []).toEqual([]);
  });

  it("el Storage lo hace cumplir aunque se salte la app: tipo no permitido (415)", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    for (const tipo of ["text/plain", "image/gif", "image/svg+xml", "application/x-msdownload"]) {
      const { error } = await subirCrudo(cliente, rutaDeComprobante(id, "png"), new Blob([PNG], { type: tipo }), tipo);
      expect(error, tipo).not.toBeNull();
      expect(String((error as { statusCode?: string }).statusCode), tipo).toBe("415");
    }
    expect((await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id)).data ?? []).toEqual([]);
  });

  it("el Storage lo hace cumplir aunque se salte la app: más de 5 MB (413)", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const { error } = await subirCrudo(
      cliente,
      rutaDeComprobante(id, "png"),
      new Blob([new Uint8Array(LIMITE_COMPROBANTE_BYTES + 1)], { type: "image/png" }),
      "image/png",
    );
    expect(error).not.toBeNull();
    expect(String((error as { statusCode?: string }).statusCode)).toBe("413");
    expect((await fx.admin.storage.from(BUCKET_COMPROBANTES).list(id)).data ?? []).toEqual([]);
  });

  it("subir a la carpeta de otro devuelve un mensaje claro que no filtra detalles del servidor", async () => {
    const { cliente } = await fx.crearAnonimo();
    const otro = await fx.crearAnonimo();
    const resultado = await subirComprobante(cliente, otro.id, archivo(PNG, "a.png", "image/png"));
    if (resultado.ok) fx.registrarComprobante(resultado.ruta);
    expect(resultado).toEqual({
      ok: false,
      mensaje: "No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo.",
    });
    expect((await fx.admin.storage.from(BUCKET_COMPROBANTES).list(otro.id)).data ?? []).toEqual([]);
  });
});

describe("criterio 3: un admin abre un pago y ve el comprobante con un enlace firmado de corta vida", () => {
  it("por defecto el enlace vence en unos 60 segundos", async () => {
    const pagador = await pagadorConComprobante();
    const admin = await fx.crearAdmin();
    const clienteAdmin = await fx.iniciarSesion(admin);

    const enlace = await crearEnlaceDeComprobante(clienteAdmin, pagador.ruta);
    expect(enlace.ok).toBe(true);
    if (!enlace.ok) return;
    // Literales, no la constante: si alguien alarga la vigencia por defecto, esto falla.
    expect(segundosRestantes(enlace.url)).toBeGreaterThan(55);
    expect(segundosRestantes(enlace.url)).toBeLessThanOrEqual(60);
  });

  it("el enlace deja de servir cuando vence", async () => {
    const pagador = await pagadorConComprobante();
    const admin = await fx.crearAdmin();
    const clienteAdmin = await fx.iniciarSesion(admin);

    const enlace = await crearEnlaceDeComprobante(clienteAdmin, pagador.ruta, 2);
    expect(enlace.ok).toBe(true);
    if (!enlace.ok) return;
    expect((await fetch(enlace.url)).status).toBe(200);

    await new Promise((resolver) => setTimeout(resolver, 3_500));
    const vencido = await fetch(enlace.url);
    expect(vencido.status).not.toBe(200);
  });

  it("un pago que no existe no da enlace, aunque haya otros pagos", async () => {
    const pagador = await pagadorConComprobante();
    const admin = await fx.crearAdmin();
    await fx.crearPago({ idAdmin: admin.id, comprobante: pagador.ruta });
    const clienteAdmin = await fx.iniciarSesion(admin);
    const resultado = await enlaceDeComprobanteDePago(clienteAdmin, crypto.randomUUID());
    expect(resultado).toEqual({ ok: false, mensaje: "No se encontró el pago." });
  });
});

describe("criterio 4: un visitante u otro pagador no abre el comprobante aunque tenga la ruta", () => {
  it("otro pagador no lo baja, no lo firma, no lo lista y no sube a esa carpeta", async () => {
    const dueno = await pagadorConComprobante();
    const otro = await fx.crearAnonimo();
    const bucketDelOtro = otro.cliente.storage.from(BUCKET_COMPROBANTES);

    expect((await bucketDelOtro.download(dueno.ruta)).error).not.toBeNull();
    expect((await bucketDelOtro.createSignedUrl(dueno.ruta, 60)).error).not.toBeNull();
    expect((await crearEnlaceDeComprobante(otro.cliente, dueno.ruta)).ok).toBe(false);

    const listado = await bucketDelOtro.list(dueno.id);
    expect(listado.data ?? []).toEqual([]);

    const { error } = await subirCrudo(otro.cliente, rutaDeComprobante(dueno.id, "png"), new Blob([PNG], { type: "image/png" }), "image/png");
    expect(error).not.toBeNull();
    expect((await fx.admin.storage.from(BUCKET_COMPROBANTES).list(dueno.id)).data).toHaveLength(1);
  });

  it("un visitante sin sesión no sube nada ni abre el archivo por la URL pública ni por la de descarga", async () => {
    const dueno = await pagadorConComprobante();
    const visitante = crearCliente(); // solo la llave publicable: ni siquiera sesión anónima
    const bucket = visitante.storage.from(BUCKET_COMPROBANTES);

    const subida = await subirCrudo(visitante, rutaDeComprobante(dueno.id, "png"), new Blob([PNG], { type: "image/png" }), "image/png");
    expect(subida.error).not.toBeNull();
    expect((await bucket.download(dueno.ruta)).error).not.toBeNull();
    expect((await bucket.createSignedUrl(dueno.ruta, 60)).error).not.toBeNull();

    const urlPublica = bucket.getPublicUrl(dueno.ruta).data.publicUrl;
    expect((await fetch(urlPublica)).status).not.toBe(200);
  });

  it("un monitor (autenticado, pero no admin) no abre un comprobante ajeno", async () => {
    const dueno = await pagadorConComprobante();
    const monitor = await fx.crearMonitor();
    const clienteMonitor = await fx.iniciarSesion(monitor);
    expect((await clienteMonitor.storage.from(BUCKET_COMPROBANTES).download(dueno.ruta)).error).not.toBeNull();
    expect((await crearEnlaceDeComprobante(clienteMonitor, dueno.ruta)).ok).toBe(false);
  });

  it("el dueño sí abre el suyo, y un admin desactivado deja de abrir cualquiera (RN-23)", async () => {
    const dueno = await pagadorConComprobante();
    expect((await crearEnlaceDeComprobante(dueno.cliente, dueno.ruta)).ok).toBe(true);

    const admin = await fx.crearAdmin();
    const clienteAdmin = await fx.iniciarSesion(admin);
    expect((await crearEnlaceDeComprobante(clienteAdmin, dueno.ruta)).ok).toBe(true);

    const { error } = await fx.admin.auth.admin.updateUserById(admin.id, { ban_duration: "876000h" });
    expect(error).toBeNull();
    expect((await crearEnlaceDeComprobante(clienteAdmin, dueno.ruta)).ok).toBe(false);
  });
});

describe("un comprobante es evidencia: no se pisa ni se borra desde la app", () => {
  it("el dueño no puede subir otra vez a la misma ruta, ni pisarla con upsert, ni borrarla", async () => {
    const dueno = await pagadorConComprobante();
    const bucket = dueno.cliente.storage.from(BUCKET_COMPROBANTES);
    const otroContenido = new Blob([JPG], { type: "image/jpeg" });

    expect((await bucket.upload(dueno.ruta, otroContenido, { contentType: "image/jpeg", upsert: false })).error).not.toBeNull();
    expect((await bucket.upload(dueno.ruta, otroContenido, { contentType: "image/jpeg", upsert: true })).error).not.toBeNull();
    await bucket.remove([dueno.ruta]);

    // Sigue ahí y con su contenido original.
    const descarga = await fx.admin.storage.from(BUCKET_COMPROBANTES).download(dueno.ruta);
    expect(descarga.error).toBeNull();
    expect(new Uint8Array(await descarga.data!.arrayBuffer())).toEqual(PNG);
  });
});
