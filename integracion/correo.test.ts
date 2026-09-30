import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claveDeCorreo, enviarCorreo, type Dependencias, type EntradaDeEnvio } from "@/lib/correo/enviar";
import { PLANTILLAS, renderizar, type DatosPorPlantilla, type Plantilla } from "@/lib/correo/plantillas";
import { crearProveedorMailpit, elegirProveedor } from "@/lib/correo/proveedor";
import { crearRegistroDeEnvios, PENDIENTE_VENCE_MS } from "@/lib/correo/registro";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-006 contra el Supabase LOCAL: el correo sale de verdad por Mailpit, y el registro es la tabla real.
// El criterio 2 (llega a una cuenta externa desde un dominio verificado) no se puede probar aquí: necesita
// un dominio verificado en Resend. Queda abierto y anotado en la HU.

let fx: Fixtures;
let mailpit: string;
const destinatarios: string[] = [];
const claves: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  // Los correos que dejó la prueba en el buzón y las filas del registro.
  for (const para of destinatarios.splice(0)) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`, { method: "DELETE" });
  }
  if (claves.length) await fx.admin.from("correo_envio").delete().in("clave", claves.splice(0));
  await fx.limpiar();
});

/** Un destinatario que solo existe en esta prueba, para que la búsqueda en Mailpit no se mezcle con otras. */
function destinatarioNuevo(): string {
  const correo = `correo-${randomUUID()}@calibra.test`;
  destinatarios.push(correo);
  return correo;
}

/** Una entidad nueva: la clave es la plantilla más esto, y se anota para borrar la fila al final. */
function entidadNueva(plantilla: Plantilla): string {
  const entidad = randomUUID();
  claves.push(claveDeCorreo(plantilla, entidad));
  return entidad;
}

type Mensaje = { ID: string; Subject: string; Text: string; HTML: string; From: { Name: string; Address: string }; To: { Address: string }[] };

/** Los correos que hay en Mailpit para un destinatario, con su contenido. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

const ENLACE = "https://calibra.example/x?token=abc123";
const EJEMPLOS: { [P in Plantilla]: DatosPorPlantilla[P] } = {
  recuperacion_diagnostico: { nombre: "Ana", materia: "Cálculo Integral", enlace: ENLACE },
  resena_individual: { nombre: "Ana", monitor: "Camilo Rojas", enlace: ENLACE },
  solicitud_llave_reembolso: { nombre: "Ana", monto: 25_000, motivo: "Cancelaste a tiempo", enlace: ENLACE },
  pago_rechazado_individual: { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06" },
  pago_rechazado_grupal: { nombre: "Ana", monto: 20_000, fechaSesion: "2020-01-13", enlace: ENLACE },
  escalamiento_pago: { nombreAdmin: "Admin Uno", nombrePagador: "Ana Pérez", monto: 25_000, enlace: "https://calibra.example/admin" },
  invitacion_monitor: { enlace: ENLACE, venceEn: "2020-01-13T15:00:00.000Z" },
  verificacion_lead: { nombre: "Ana", enlace: ENLACE, venceEn: "2020-01-13T15:00:00.000Z" },
};

const REMITENTE = "Calibra <no-responder@calibra.test>";

/**
 * Siempre Mailpit, sin pasar por `elegirProveedor(process.env)`: si quien corre las pruebas tiene una
 * RESEND_API_KEY o variables SMTP en su entorno, esa función elegiría Resend o Gmail y las pruebas
 * mandarían correo de verdad.
 */
const porMailpit = () => ({ ok: true, proveedor: crearProveedorMailpit({ url: mailpit, remitente: REMITENTE }) }) as const;

function dependenciasReales(cambios: Partial<Dependencias> = {}): Dependencias {
  return {
    registro: crearRegistroDeEnvios(fx.admin),
    proveedor: porMailpit(),
    esperar: async () => undefined, // sin esperas reales entre reintentos
    ...cambios,
  };
}

const entrada = <P extends Plantilla>(plantilla: P, destinatario: string, entidad: string): EntradaDeEnvio<P> => ({
  plantilla,
  datos: EJEMPLOS[plantilla],
  destinatario,
  entidad,
});

async function filaDe(plantilla: Plantilla, entidad: string) {
  const { data, error } = await fx.admin.from("correo_envio").select("*").eq("clave", claveDeCorreo(plantilla, entidad));
  expect(error).toBeNull();
  return data ?? [];
}

describe("el entorno local envía por Mailpit", () => {
  it("sin RESEND_API_KEY ni SMTP, y con MAILPIT_URL local, el proveedor es Mailpit", () => {
    expect(elegirProveedor({ MAILPIT_URL: mailpit })).toMatchObject({ ok: true, proveedor: { nombre: "mailpit" } });
  });
});

describe("criterio 1: un evento de la sección 8 con destinatario de correo sale en español, en HTML y en texto plano", () => {
  it.each(PLANTILLAS)("%s llega a Mailpit con asunto, HTML y texto, y queda anotado", async (plantilla) => {
    const para = destinatarioNuevo();
    const entidad = entidadNueva(plantilla);
    const resultado = await enviarCorreo(dependenciasReales(), entrada(plantilla, para, entidad));

    expect(resultado).toMatchObject({ ok: true, yaEnviado: false, intentos: 1 });
    const mensajes = await mensajesPara(para);
    expect(mensajes).toHaveLength(1);
    const esperado = renderizar(plantilla, EJEMPLOS[plantilla]);
    expect(mensajes[0].Subject).toBe(esperado.asunto);
    // El correo viaja con saltos de línea CRLF (retorno de carro más salto); el contenido es el mismo.
    const texto = mensajes[0].Text.split(String.fromCharCode(13)).join("");
    expect(texto.trim()).toBe(esperado.texto.trim());
    expect(mensajes[0].HTML).toContain('<html lang="es">');
    expect(mensajes[0].HTML).toContain("<h1");
    expect(mensajes[0].From.Address).toBe("no-responder@calibra.test");
    expect(mensajes[0].To.map((t) => t.Address)).toEqual([para]);

    const filas = await filaDe(plantilla, entidad);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      plantilla,
      destinatario: para,
      estado: "enviado",
      intentos: 1,
      ultimo_error: null,
      id_proveedor: mensajes[0].ID,
    });
    expect(filas[0].enviado_en).not.toBeNull();
  });

  it("un contacto que es un teléfono no manda nada ni deja fila", async () => {
    const entidad = entidadNueva("recuperacion_diagnostico");
    const resultado = await enviarCorreo(dependenciasReales(), entrada("recuperacion_diagnostico", "3001234567", entidad));
    expect(resultado).toMatchObject({ ok: false, motivo: "contacto_no_es_correo" });
    expect(await filaDe("recuperacion_diagnostico", entidad)).toEqual([]);
  });
});

describe("el registro guarda destinatario, plantilla, fecha y resultado, y no el cuerpo", () => {
  it("la fila no trae el cuerpo, ni los datos, ni el enlace con token", async () => {
    const para = destinatarioNuevo();
    const entidad = entidadNueva("recuperacion_diagnostico");
    await enviarCorreo(dependenciasReales(), entrada("recuperacion_diagnostico", para, entidad));

    const [fila] = await filaDe("recuperacion_diagnostico", entidad);
    expect(Object.keys(fila).sort()).toEqual(
      ["actualizado_en", "clave", "creado_en", "destinatario", "enviado_en", "estado", "id", "id_proveedor", "intentos", "plantilla", "reintentable", "ultimo_error"].sort(),
    );
    const todo = JSON.stringify(fila);
    expect(todo).not.toContain("abc123");
    expect(todo).not.toContain("Cálculo");
    expect(todo).not.toContain("<html");
  });
});

describe("criterio 3: si falla el proveedor, queda registrado y se reintenta sin duplicar", () => {
  const proveedorCaido = () =>
    ({ ok: true, proveedor: crearProveedorMailpit({ url: "http://127.0.0.1:1", remitente: REMITENTE }) }) as const;

  it("un proveedor caído deja el correo fallido con su error y tres intentos; al volver, sale una sola vez", async () => {
    const para = destinatarioNuevo();
    const entidad = entidadNueva("solicitud_llave_reembolso");

    const fallo = await enviarCorreo(dependenciasReales({ proveedor: proveedorCaido() }), entrada("solicitud_llave_reembolso", para, entidad));
    expect(fallo).toMatchObject({ ok: false, motivo: "fallo_del_proveedor", intentos: 3 });
    expect(await mensajesPara(para)).toEqual([]);

    const [tras] = await filaDe("solicitud_llave_reembolso", entidad);
    expect(tras).toMatchObject({ estado: "fallido", intentos: 3, enviado_en: null, id_proveedor: null });
    expect(tras.ultimo_error).toContain("Mailpit no respondió");
    expect(tras.ultimo_error!.length).toBeLessThanOrEqual(500);

    // El proveedor vuelve: la misma llamada reintenta sobre la MISMA fila y sale una sola vez.
    const exito = await enviarCorreo(dependenciasReales(), entrada("solicitud_llave_reembolso", para, entidad));
    expect(exito).toMatchObject({ ok: true, yaEnviado: false, intentos: 4 });
    expect(await mensajesPara(para)).toHaveLength(1);
    const filas = await filaDe("solicitud_llave_reembolso", entidad);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: tras.id, estado: "enviado", intentos: 4, ultimo_error: null });

    // Y otra llamada más no manda un segundo correo.
    expect(await enviarCorreo(dependenciasReales(), entrada("solicitud_llave_reembolso", para, entidad))).toMatchObject({ ok: true, yaEnviado: true });
    expect(await mensajesPara(para)).toHaveLength(1);
  });

  it("dos llamadas a la vez con la misma clave mandan un solo correo", async () => {
    const para = destinatarioNuevo();
    const entidad = entidadNueva("resena_individual");
    const resultados = await Promise.all([
      enviarCorreo(dependenciasReales(), entrada("resena_individual", para, entidad)),
      enviarCorreo(dependenciasReales(), entrada("resena_individual", para, entidad)),
    ]);

    expect(resultados.filter((r) => r.ok && !r.yaEnviado)).toHaveLength(1);
    // La otra no envió: o lo encontró en curso, o ya enviado.
    const otra = resultados.find((r) => !(r.ok && !r.yaEnviado))!;
    expect(otra.ok ? "ya_enviado" : otra.motivo).toMatch(/^(ya_enviado|en_curso)$/);
    expect(await mensajesPara(para)).toHaveLength(1);
    expect(await filaDe("resena_individual", entidad)).toHaveLength(1);
  });

  it("si la base de datos no está, no manda nada", async () => {
    const para = destinatarioNuevo();
    const registroRoto = {
      reservar: async () => {
        throw new Error("la base no responde");
      },
      marcarEnviado: async () => undefined,
      marcarFallido: async () => undefined,
    };
    const resultado = await enviarCorreo(dependenciasReales({ registro: registroRoto }), entrada("resena_individual", para, entidadNueva("resena_individual")));
    expect(resultado).toMatchObject({ ok: false, motivo: "fallo_del_registro" });
    expect(await mensajesPara(para)).toEqual([]);
  });
});

describe("el registro sobre la tabla real: quién se queda con un correo", () => {
  const datos = (clave: string) => ({ clave, plantilla: "recuperacion_diagnostico", destinatario: "alguien@calibra.test" });
  const claveNueva = () => {
    const clave = `recuperacion_diagnostico:${randomUUID()}`;
    claves.push(clave);
    return clave;
  };

  it("la primera llamada reserva; la segunda, con la fila fresca, la encuentra en curso", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    expect(await registro.reservar(datos(clave))).toEqual({ accion: "enviar", intentosPrevios: 0 });
    expect(await registro.reservar(datos(clave))).toEqual({ accion: "en_curso" });
  });

  it("un correo enviado no se vuelve a reservar", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    await registro.reservar(datos(clave));
    await registro.marcarEnviado(clave, { idProveedor: "prov-1", intentos: 1 });
    expect(await registro.reservar(datos(clave))).toEqual({ accion: "ya_enviado" });
  });

  it("uno fallido se toma con sus intentos previos y pasa a pendiente", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    await registro.reservar(datos(clave));
    await registro.marcarFallido(clave, { error: "Resend 503: caído", intentos: 3, reintentable: true });
    expect(await registro.reservar(datos(clave))).toEqual({ accion: "enviar", intentosPrevios: 3 });
    const { data } = await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single();
    expect(data?.estado).toBe("pendiente");
  });

  it("dos procesos que intentan tomar el mismo correo fallido: solo uno lo consigue", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    await registro.reservar(datos(clave));
    await registro.marcarFallido(clave, { error: "x", intentos: 1, reintentable: false });

    const tomas = await Promise.all(Array.from({ length: 6 }, () => registro.reservar(datos(clave))));
    expect(tomas.filter((t) => t.accion === "enviar")).toHaveLength(1);
    expect(tomas.filter((t) => t.accion === "en_curso")).toHaveLength(5);
  });

  it("un pendiente reciente es de otro; uno abandonado (mucho más de 5 minutos) se puede tomar", async () => {
    const clave = claveNueva();
    const registro = crearRegistroDeEnvios(fx.admin);
    await registro.reservar(datos(clave));
    // Se adelanta el reloj con margen de sobra a cada lado del límite: la hora de la fila la pone la base y
    // la de la prueba, esta máquina, y no deben depender de que coincidan al milisegundo.
    const ahora = Date.now();
    const unMinutoDespues = crearRegistroDeEnvios(fx.admin, () => ahora + PENDIENTE_VENCE_MS / 5);
    expect(await unMinutoDespues.reservar(datos(clave))).toEqual({ accion: "en_curso" });
    const diezMinutosDespues = crearRegistroDeEnvios(fx.admin, () => ahora + PENDIENTE_VENCE_MS * 2);
    expect(await diezMinutosDespues.reservar(datos(clave))).toEqual({ accion: "enviar", intentosPrevios: 0 });
  });

  it("varios procesos que encuentran el mismo pendiente abandonado: solo uno lo toma", async () => {
    const clave = claveNueva();
    await crearRegistroDeEnvios(fx.admin).reservar(datos(clave));
    const luego = crearRegistroDeEnvios(fx.admin, () => Date.now() + PENDIENTE_VENCE_MS * 2);
    const tomas = await Promise.all(Array.from({ length: 6 }, () => luego.reservar(datos(clave))));
    expect(tomas.filter((t) => t.accion === "enviar")).toHaveLength(1);
    expect(tomas.filter((t) => t.accion === "en_curso")).toHaveLength(5);
  });

  it("tomar un correo abandonado actualiza el destinatario (el contacto pudo cambiar)", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    await registro.reservar(datos(clave));
    await registro.marcarFallido(clave, { error: "x", intentos: 1, reintentable: false });
    await registro.reservar({ ...datos(clave), destinatario: "nuevo@calibra.test" });
    const { data } = await fx.admin.from("correo_envio").select("destinatario").eq("clave", clave).single();
    expect(data?.destinatario).toBe("nuevo@calibra.test");
  });

  it("un error de 2.000 caracteres se anota recortado a 300, muy por debajo del tope de 500 de la columna", async () => {
    const registro = crearRegistroDeEnvios(fx.admin);
    const clave = claveNueva();
    await registro.reservar(datos(clave));
    await registro.marcarFallido(clave, { error: "e".repeat(2_000), intentos: 3, reintentable: false });
    const { data } = await fx.admin.from("correo_envio").select("estado, ultimo_error").eq("clave", clave).single();
    expect(data?.estado).toBe("fallido");
    expect(data?.ultimo_error?.length).toBeGreaterThan(0);
    expect(data?.ultimo_error?.length).toBeLessThanOrEqual(300);
  });
});

describe("la puerta del servidor: enviarCorreoDesdeServidor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("con el entorno local (Mailpit, sin llave de Resend) manda el correo y lo anota", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_CONTRASENA", ""); // sin contraseña no hay SMTP (HU-066): nunca sale correo de verdad
    vi.stubEnv("CORREO_REMITENTE", "");
    vi.stubEnv("MAILPIT_URL", mailpit);
    const para = destinatarioNuevo();
    const entidad = entidadNueva("resena_individual");

    const resultado = await enviarCorreoDesdeServidor(entrada("resena_individual", para, entidad));

    expect(resultado).toMatchObject({ ok: true, yaEnviado: false });
    expect(await mensajesPara(para)).toHaveLength(1);
    expect(await filaDe("resena_individual", entidad)).toMatchObject([{ estado: "enviado", intentos: 1, destinatario: para }]);
  });

  it("sin ningún proveedor configurado no manda nada, no lanza y deja el correo fallido a la vista del admin", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_CONTRASENA", ""); // sin contraseña no hay SMTP (HU-066): nunca sale correo de verdad
    vi.stubEnv("CORREO_REMITENTE", "");
    vi.stubEnv("MAILPIT_URL", "");
    const para = destinatarioNuevo();
    const entidad = entidadNueva("resena_individual");

    const resultado = await enviarCorreoDesdeServidor(entrada("resena_individual", para, entidad));

    expect(resultado).toMatchObject({ ok: false, motivo: "sin_proveedor" });
    expect(await mensajesPara(para)).toHaveLength(0);
    // Queda anotado como fallido, con la causa y sin intentos: al configurar el proveedor, el mismo correo se reintenta.
    const filas = await filaDe("resena_individual", entidad);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: "fallido", intentos: 0, enviado_en: null });
    expect(filas[0].ultimo_error).toContain("RESEND_API_KEY");
  });

  it("sin llave para el registro devuelve un fallo del registro en vez de lanzar", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const para = destinatarioNuevo();
    const resultado = await enviarCorreoDesdeServidor(entrada("resena_individual", para, entidadNueva("resena_individual")));
    expect(resultado).toMatchObject({ ok: false, motivo: "fallo_del_registro" });
    expect(await mensajesPara(para)).toHaveLength(0);
  });
});

describe("quién puede leer el registro", () => {
  it("un admin lo lee; un monitor y un visitante, no", async () => {
    const para = destinatarioNuevo();
    const entidad = entidadNueva("resena_individual");
    await enviarCorreo(dependenciasReales(), entrada("resena_individual", para, entidad));
    const clave = claveDeCorreo("resena_individual", entidad);

    const admin = await fx.crearAdmin();
    const deAdmin = await (await fx.iniciarSesion(admin)).from("correo_envio").select("clave").eq("clave", clave);
    expect(deAdmin.error).toBeNull();
    expect(deAdmin.data).toEqual([{ clave }]);

    const monitor = await fx.crearMonitor();
    const deMonitor = await (await fx.iniciarSesion(monitor)).from("correo_envio").select("clave").eq("clave", clave);
    expect(deMonitor.data ?? []).toEqual([]);

    const { cliente: anonimo } = await fx.crearAnonimo();
    const deAnonimo = await anonimo.from("correo_envio").select("clave").eq("clave", clave);
    expect(deAnonimo.data ?? []).toEqual([]);

    // Ni un admin escribe con su sesión: escribe el servidor.
    const insercion = await (await fx.iniciarSesion(admin)).from("correo_envio").insert({ clave: `x:${randomUUID()}`, plantilla: "x", destinatario: "a@b.co" });
    expect(insercion.error).not.toBeNull();
  });
});
