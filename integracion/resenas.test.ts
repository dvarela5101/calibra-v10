import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/invitar-resenas/route";
import { finalizarMonitoria } from "@/lib/agenda/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { diaDelNegocio } from "@/lib/fechas";
import { rutaDeResena } from "@/lib/resenas/reglas";
import {
  leerResenaPorToken,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarInvitacionesResena,
  reconstruirInvitacionResena,
  registrarResena,
} from "@/lib/resenas/servidor";
import { exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-035 contra el Supabase local: el trigger de `monitoria` anota la invitación al pasar a `realizada` (por el
 * monitor con `finalizar_monitoria` o por quien sea), `procesarInvitacionesResena` (el mismo código de la ruta
 * `/api/procesos/invitar-resenas`) manda por Mailpit el enlace `/resena?token=...` al correo del Lead, y
 * `leerResenaPorToken` / `registrarResena` (lo que usa la página del enlace) dejan la reseña ligada al pago.
 * En local no hay configuración en Vault, así que la base no llama a la app: la prueba llama el proceso.
 *
 * Los datos son de la prueba y los borra ella: una monitoría por lunes lejano (una franja no tiene dos activas el
 * mismo día), cada una con su pago. Las invitaciones se van en cascada con el pago; las reseñas no, así que la
 * limpieza las borra antes. La corrida del proceso toma cualquier invitación pendiente de la base (lotes de 10):
 * por eso se repite hasta que la de la prueba queda procesada.
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

let fx: Fixtures;
let mailpit: string;
let e: Awaited<ReturnType<typeof construirEscenario>>;
let sesionMonitor: Cliente;
const pagos: string[] = [];
const monitoriasConReporte: string[] = [];
const correos = new Set<string>();

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  fx = new Fixtures();
  try {
    e = await construirEscenario();
    sesionMonitor = await fx.iniciarSesion(e.monitor);
  } catch (error) {
    await fx.limpiar();
    throw error;
  }
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    // Los reportes de HU-080 los insertó la prueba y la llave foránea impide borrar antes la monitoría.
    if (monitoriasConReporte.length) await fx.admin.from("reporte_inasistencia").delete().in("id_monitoria", monitoriasConReporte);
    if (pagos.length) {
      await fx.admin.from("correo_envio").delete().in("clave", pagos.map((id) => claveDeCorreo("resena_individual", id)));
      // La reseña cuelga del pago sin cascada: antes de que la limpieza borre los pagos.
      await fx.admin.from("resena").delete().in("id_pago", pagos);
    }
    await fx.limpiar();
  }
});

/** Un lunes a cuatro semanas o más de hoy en Bogotá, como lo guarda la base. */
function lunesLejano(semanasExtra = 0): string {
  const dia = new Date(`${diaDelNegocio(new Date())}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + 28 + semanasExtra * 7);
  while (dia.getUTCDay() !== 1) dia.setUTCDate(dia.getUTCDate() + 1);
  return dia.toISOString().slice(0, 10);
}

async function construirEscenario() {
  const admin = await fx.crearAdmin();
  const { materia } = await fx.crearEvaluacion();
  const monitor = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1, hora: "10:00:00" });
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return { admin, materia, monitor, lead, franja, contexto: { materia, monitor, franja, lead } };
}

let semana = 0;

type EstadoDePago = "en_revision" | "aprobado" | "rechazado";

/**
 * Una individual confirmada del escenario en un lunes distinto, con su pago (aprobado por defecto). Aún no pasa a
 * `realizada`: eso lo hace cada prueba.
 */
async function confirmada(estadoDePago: EstadoDePago = "aprobado") {
  const monitoria = await fx.crearMonitoria(e.contexto, { fecha: lunesLejano(semana++), estado: "confirmada" });
  const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: e.admin.id, estado: estadoDePago });
  pagos.push(pago.id);
  return { monitoria, pago };
}

async function pasarARealizada(idMonitoria: string) {
  exito(
    await fx.admin
      .from("monitoria")
      .update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() })
      .eq("id", idMonitoria)
      .select()
      .single(),
    "pasar la monitoría a realizada",
  );
}

/** Una individual realizada, con su pago aprobado y su invitación anotada por el trigger. */
async function realizada() {
  const caso = await confirmada();
  await pasarARealizada(caso.monitoria.id);
  return caso;
}

async function invitacionesDe(idPago: string) {
  return exito(await fx.admin.from("invitacion_resena").select("id, token, procesado_en, intentos").eq("id_pago", idPago), "leer invitaciones");
}

async function tokenDe(idPago: string): Promise<string> {
  const [invitacion] = await invitacionesDe(idPago);
  if (!invitacion) throw new Error(`El pago ${idPago} no tiene invitación.`);
  return invitacion.token;
}

async function resenasDe(idPago: string) {
  return exito(await fx.admin.from("resena").select("id_pago, calificacion, comentario, fecha").eq("id_pago", idPago), "leer reseñas");
}

type Mensaje = { Subject: string; Text: string; HTML: string };

async function correosDelLead(): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${e.lead.correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el proceso hasta que la invitación de ese pago queda procesada (puede haber otras pendientes en la base). */
async function procesarHasta(idPago: string) {
  for (let i = 0; i < 10; i++) {
    await procesarInvitacionesResena({ cliente: fx.admin });
    const [invitacion] = await invitacionesDe(idPago);
    if (!invitacion || invitacion.procesado_en !== null) return;
  }
  throw new Error(`La invitación del pago ${idPago} no se procesó tras 10 corridas.`);
}

describe("criterio 1: una individual que pasa a realizada le manda al Lead el enlace de su pago", () => {
  it("al finalizarla el monitor se anota la invitación; el proceso manda el correo con el enlace y no lo repite", async () => {
    // Una confirmada que ya empezó hace 2 h, de un monitor propio y en su propia franja (la base no deja finalizar lo
    // que aún no empieza). La franja dura 30 min como máximo y no pasa de la medianoche.
    const monitorPropio = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: monitorPropio.id, idMateria: e.materia.id, idAdmin: e.admin.id });
    const sesionPropia = await fx.iniciarSesion(monitorPropio);
    const inicio = new Date(Math.floor((Date.now() - 2 * HORA) / 1000) * 1000);
    const fecha = diaDelNegocio(inicio);
    const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(inicio);
    const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7;
    const franja = await fx.crearFranja({ idMonitor: monitorPropio.id, dia, hora, duracionMin: Math.min(30, 24 * 60 - minutosDelDia) });
    const monitoria = await fx.crearMonitoria({ ...e.contexto, monitor: monitorPropio, franja }, { fecha, estado: "confirmada" });
    const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: e.admin.id, estado: "aprobado" });
    pagos.push(pago.id);
    expect(await invitacionesDe(pago.id)).toEqual([]);
    const antes = (await correosDelLead()).length;

    expect(await finalizarMonitoria(sesionPropia, monitoria.id)).toBe("finalizada");

    const [invitacion] = await invitacionesDe(pago.id);
    expect(invitacion.procesado_en).toBeNull();
    expect(invitacion.token).toMatch(/^[0-9a-f]{64}$/);

    await procesarHasta(pago.id);

    const correosDespues = await correosDelLead();
    expect(correosDespues).toHaveLength(antes + 1);
    const correo = correosDespues.find((c) => c.Subject.includes("Monitor de prueba"));
    expect(correo, "debía llegar el correo de la reseña").toBeDefined();
    expect(correo!.Subject).toBe("¿Cómo te fue con Monitor de prueba?");
    expect(correo!.Text).toContain(rutaDeResena(invitacion.token));
    expect(correo!.HTML).toContain(rutaDeResena(invitacion.token));
    expect((await invitacionesDe(pago.id))[0].procesado_en).not.toBeNull();
    const registro = exito(
      await fx.admin.from("correo_envio").select("estado, destinatario").eq("clave", claveDeCorreo("resena_individual", pago.id)).single(),
      "leer el registro",
    );
    expect(registro).toEqual({ estado: "enviado", destinatario: e.lead.correo });

    // Otra corrida no lo manda otra vez.
    await procesarInvitacionesResena({ cliente: fx.admin });
    expect(await correosDelLead()).toHaveLength(antes + 1);
  });

  it("pasar a realizada por otro camino (la base, sin el monitor) anota igual la invitación; si ya estaba realizada, no se anota otra", async () => {
    const { monitoria, pago } = await confirmada();
    await pasarARealizada(monitoria.id);
    const [primera] = await invitacionesDe(pago.id);
    expect(primera).toBeDefined();

    // Un cambio posterior en la monitoría (sigue realizada) no crea ni cambia la invitación.
    exito(await fx.admin.from("monitoria").update({ estado: "realizada" }).eq("id", monitoria.id).select().single(), "repetir el estado");
    expect(await invitacionesDe(pago.id)).toEqual([primera]);
    await procesarHasta(pago.id);
  });

  it("una monitoría que no llega a realizada no anota invitación, y a un pago rechazado tampoco", async () => {
    const cancelada = await confirmada();
    exito(
      await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "estudiante" }).eq("id", cancelada.monitoria.id).select().single(),
      "cancelar",
    );
    expect(await invitacionesDe(cancelada.pago.id)).toEqual([]);

    const rechazado = await confirmada("rechazado");
    await pasarARealizada(rechazado.monitoria.id);
    expect(await invitacionesDe(rechazado.pago.id)).toEqual([]);
  });

  it("una grupal que pasa a realizada no recibe invitación (su reseña es otra regla)", async () => {
    const { monitoria, pago } = await confirmada();
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: monitoria.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );

    await pasarARealizada(monitoria.id);

    expect(await invitacionesDe(pago.id)).toEqual([]);
  });
});

describe("criterio 3: lo que no se reseña (reconstructor del reintento, HU-065)", () => {
  it("reconstruirInvitacionResena devuelve el correo al Lead con el enlace del pago; el mapa de reconstructores lo usa", async () => {
    const { pago } = await realizada();
    const token = await tokenDe(pago.id);

    const reconstruido = await reconstruirInvitacionResena(pago.id, fx.admin);

    expect(reconstruido?.destinatario).toBe(e.lead.correo);
    expect(reconstruido?.datos).toMatchObject({ nombre: e.lead.nombre, monitor: "Monitor de prueba" });
    expect((reconstruido?.datos as { enlace: string }).enlace).toContain(rutaDeResena(token));
    expect(typeof RECONSTRUCTORES.resena_individual).toBe("function");
    await procesarHasta(pago.id);
  });

  it("es null si no hay invitación, si el id no es un uuid, si el pago ya tiene reseña o si fue rechazado", async () => {
    // Sin invitación (la monitoría sigue confirmada).
    const sinInvitacion = await confirmada();
    expect(await reconstruirInvitacionResena(sinInvitacion.pago.id, fx.admin)).toBeNull();
    expect(await reconstruirInvitacionResena("no-es-un-uuid", fx.admin)).toBeNull();

    // Ya reseñada.
    const reseñada = await realizada();
    expect(await reconstruirInvitacionResena(reseñada.pago.id, fx.admin)).not.toBeNull();
    expect(await registrarResena(await tokenDe(reseñada.pago.id), 5, null)).toBe("registrada");
    expect(await reconstruirInvitacionResena(reseñada.pago.id, fx.admin)).toBeNull();

    // Rechazado después de anotar la invitación.
    const rechazada = await realizada();
    exito(
      await fx.admin.from("pago").update({ estado: "rechazado", fecha_revision: new Date().toISOString() }).eq("id", rechazada.pago.id).select().single(),
      "rechazar el pago",
    );
    expect(await reconstruirInvitacionResena(rechazada.pago.id, fx.admin)).toBeNull();
  });

  it("el proceso no manda la invitación de un pago que ya se rechazó o se reseñó: la descarta y la marca procesada", async () => {
    const rechazada = await realizada();
    exito(
      await fx.admin.from("pago").update({ estado: "rechazado", fecha_revision: new Date().toISOString() }).eq("id", rechazada.pago.id).select().single(),
      "rechazar el pago",
    );
    const antes = (await correosDelLead()).length;

    await procesarHasta(rechazada.pago.id);

    expect(await correosDelLead()).toHaveLength(antes);
    expect((await invitacionesDe(rechazada.pago.id))[0].procesado_en).not.toBeNull();
    const registro = exito(
      await fx.admin.from("correo_envio").select("clave").eq("clave", claveDeCorreo("resena_individual", rechazada.pago.id)),
      "leer el registro",
    );
    expect(registro).toEqual([]);
  });
});

describe("leerResenaPorToken y registrarResena, de punta a punta", () => {
  it("el enlace disponible trae monitor, materia y fecha de inicio; al calificar se guarda la reseña ligada al pago, y una segunda vez es ya_resenada", async () => {
    const { monitoria, pago } = await realizada();
    const token = await tokenDe(pago.id);

    const antes = await leerResenaPorToken(token);
    expect(antes).toMatchObject({ estado: "disponible", nombreMonitor: "Monitor de prueba", nombreMateria: e.materia.nombre });
    expect(antes!.inicio).toBe(new Date(`${monitoria.fecha}T15:00:00Z`).toISOString());

    const desde = Date.now();
    expect(await registrarResena(token, 4, "  Muy claro y puntual  ")).toBe("registrada");
    const hasta = Date.now();

    const [resena] = await resenasDe(pago.id);
    expect(resena).toMatchObject({ id_pago: pago.id, calificacion: 4, comentario: "Muy claro y puntual" });
    const fecha = new Date(resena.fecha).getTime();
    expect(fecha).toBeGreaterThanOrEqual(desde - 5_000);
    expect(fecha).toBeLessThanOrEqual(hasta + 5_000);
    expect((await leerResenaPorToken(token))?.estado).toBe("ya_resenada");

    expect(await registrarResena(token, 1, "Otra opinión")).toBe("ya_resenada");
    expect(await resenasDe(pago.id)).toEqual([resena]);
    await procesarHasta(pago.id);
  });

  it("el comentario es opcional: sin comentario o con solo espacios se guarda nulo", async () => {
    const a = await realizada();
    expect(await registrarResena(await tokenDe(a.pago.id), 5, null)).toBe("registrada");
    expect((await resenasDe(a.pago.id))[0]).toMatchObject({ calificacion: 5, comentario: null });

    const b = await realizada();
    expect(await registrarResena(await tokenDe(b.pago.id), 1, "   ")).toBe("registrada");
    expect((await resenasDe(b.pago.id))[0]).toMatchObject({ calificacion: 1, comentario: null });
    await procesarHasta(a.pago.id);
    await procesarHasta(b.pago.id);
  });

  it("la base rechaza una calificación fuera de 1 a 5 y un comentario de más de 1000 caracteres, sin guardar nada", async () => {
    const { pago } = await realizada();
    const token = await tokenDe(pago.id);

    await expect(registrarResena(token, 0, null)).rejects.toThrow(/resena_calificacion_de_1_a_5/);
    await expect(registrarResena(token, 6, null)).rejects.toThrow(/resena_calificacion_de_1_a_5/);
    await expect(registrarResena(token, 3, "a".repeat(1001))).rejects.toThrow(/resena_comentario_largo/);
    expect(await resenasDe(pago.id)).toEqual([]);

    expect(await registrarResena(token, 3, "a".repeat(1000))).toBe("registrada");
    await procesarHasta(pago.id);
  });

  it("un pago rechazado no se puede reseñar: el enlace dice no_disponible y no se guarda nada", async () => {
    const { pago } = await realizada();
    const token = await tokenDe(pago.id);
    exito(
      await fx.admin.from("pago").update({ estado: "rechazado", fecha_revision: new Date().toISOString() }).eq("id", pago.id).select().single(),
      "rechazar el pago",
    );

    expect((await leerResenaPorToken(token))?.estado).toBe("no_disponible");
    expect(await registrarResena(token, 5, "No debería guardarse")).toBe("no_disponible");
    expect(await resenasDe(pago.id)).toEqual([]);
    await procesarHasta(pago.id);
  });

  it("si la monitoría deja de estar realizada el enlace no permite reseñar", async () => {
    const { monitoria, pago } = await realizada();
    const token = await tokenDe(pago.id);
    // Solo la base lo puede forzar: la app nunca la devuelve a otro estado.
    exito(await fx.admin.from("monitoria").update({ estado: "confirmada", fecha_finalizacion: null }).eq("id", monitoria.id).select().single(), "volver a confirmada");

    expect((await leerResenaPorToken(token))?.estado).toBe("no_disponible");
    expect(await registrarResena(token, 5, null)).toBe("no_disponible");
    expect(await resenasDe(pago.id)).toEqual([]);
    await procesarHasta(pago.id);
  });

  it("un token inexistente o con forma inválida no existe: leer devuelve null y registrar, no_existe", async () => {
    const inventado = randomBytes(32).toString("hex");
    expect(await leerResenaPorToken(inventado)).toBeNull();
    expect(await registrarResena(inventado, 5, null)).toBe("no_existe");
    for (const malo of ["", "abc", "x".repeat(64), `${inventado}0`, "' or 1=1 --"]) {
      expect(await leerResenaPorToken(malo), malo).toBeNull();
      expect(await registrarResena(malo, 5, null), malo).toBe("no_existe");
    }
  });

  it("dos envíos a la vez del mismo enlace dejan una sola reseña", async () => {
    const { pago } = await realizada();
    const token = await tokenDe(pago.id);

    const resultados = await Promise.all([registrarResena(token, 5, "Uno"), registrarResena(token, 2, "Dos")]);

    expect(resultados.sort()).toEqual(["registrada", "ya_resenada"]);
    expect(await resenasDe(pago.id)).toHaveLength(1);
    await procesarHasta(pago.id);
  });
});

describe("las invitaciones solo las toca la llave secreta", () => {
  it("anon y un usuario con sesión no leen invitaciones ni llaman las funciones del enlace", async () => {
    const { pago } = await realizada();
    const token = await tokenDe(pago.id);
    const anonimo = await fx.crearAnonimo();

    for (const cliente of [anonimo.cliente, sesionMonitor]) {
      const lectura = await cliente.from("invitacion_resena").select("token").eq("id_pago", pago.id);
      expect(lectura.error ? [] : lectura.data).toEqual([]);
      expect((await cliente.rpc("resena_por_token", { p_token: token })).error).not.toBeNull();
      expect((await cliente.rpc("registrar_resena", { p_token: token, p_calificacion: 5, p_comentario: "" })).error).not.toBeNull();
      expect((await cliente.rpc("datos_de_invitacion_resena", { p_id_pago: pago.id })).error).not.toBeNull();
    }
    expect(await resenasDe(pago.id)).toEqual([]);
    await procesarHasta(pago.id);
  });
});

describe("cuando no se puede procesar", () => {
  it("sin registro de correos la invitación queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    const { pago } = await realizada();
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    const estado = async () => (await invitacionesDe(pago.id))[0];

    await procesarInvitacionesResena({ cliente: fx.admin, enviar: sinRegistro });
    expect(await estado()).toMatchObject({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarInvitacionesResena({ cliente: fx.admin, enviar: sinRegistro });
    const final = await estado();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
  });

  it("pasado el presupuesto de tiempo no toma más invitaciones: quedan para la próxima corrida", async () => {
    const { pago } = await realizada();
    let llamadas = 0;
    // El reloj ya pasó el presupuesto desde la primera consulta después del inicio.
    const reloj = () => (llamadas++ === 0 ? 0 : PRESUPUESTO_DE_CORRIDA_MS);

    const resumen = await procesarInvitacionesResena({ cliente: fx.admin, reloj });

    expect(resumen.pospuestas).toBe(resumen.revisadas);
    expect(resumen.enviadas).toBe(0);
    expect((await invitacionesDe(pago.id))[0].procesado_en).toBeNull();
    await procesarHasta(pago.id);
  });
});

describe("la ruta /api/procesos/invitar-resenas", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/invitar-resenas", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin el secreto del proceso programado, o con otro, responde 401 y no toca la base", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamar(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
  });

  it("con el secreto correcto procesa las invitaciones y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const { pago } = await realizada();

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartadas", "enEspera", "enviadas", "fallidas", "pospuestas", "revisadas", "tomadasPorOtro"]);
    expect(resumen.revisadas).toBe(
      resumen.enviadas + resumen.enEspera + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas,
    );
    await procesarHasta(pago.id);
  });
});

describe("HU-080: no se invita a reseñar a quien reportó que el monitor no llegó (D-40)", () => {
  async function reportar(idMonitoria: string, estado: "en_revision" | "aceptado" | "rechazado" = "en_revision") {
    exito(await fx.admin.from("reporte_inasistencia").insert({ id_monitoria: idMonitoria, id_admin: e.admin.id, estado, fecha_decision: estado === "en_revision" ? null : new Date().toISOString() }).select().single(), "crear el reporte");
    monitoriasConReporte.push(idMonitoria);
  }

  async function decidir(idMonitoria: string, estado: "aceptado" | "rechazado") {
    exito(
      await fx.admin.from("reporte_inasistencia").update({ estado, fecha_decision: new Date().toISOString() }).eq("id_monitoria", idMonitoria).select().single(),
      "decidir el reporte",
    );
  }

  const conElEnlace = async (token: string) => (await correosDelLead()).filter((c) => c.Text.includes(rutaDeResena(token)));

  it("con el reporte abierto antes de realizada, el proceso la deja en espera: no manda correo ni marca la invitación; al rechazarse se manda", async () => {
    const { monitoria, pago } = await confirmada();
    await reportar(monitoria.id);
    await pasarARealizada(monitoria.id);
    const token = await tokenDe(pago.id);

    // El listado ya la deja fuera (reporte abierto): ni se revisa, ni se marca, ni suma intento.
    await procesarInvitacionesResena({ cliente: fx.admin });

    expect(await conElEnlace(token)).toHaveLength(0);
    expect(await invitacionesDe(pago.id)).toEqual([expect.objectContaining({ procesado_en: null, intentos: 0 })]);

    await decidir(monitoria.id, "rechazado");
    await procesarHasta(pago.id);

    expect(await conElEnlace(token)).toHaveLength(1);
    expect((await invitacionesDe(pago.id))[0].procesado_en).not.toBeNull();
  });

  it("con la invitación ya enviada y un reporte después, el enlace da con_reporte y no se guarda reseña; tras el rechazo vuelve a poder calificar", async () => {
    const { monitoria, pago } = await realizada();
    const token = await tokenDe(pago.id);
    await procesarHasta(pago.id);

    await reportar(monitoria.id);

    expect((await leerResenaPorToken(token))?.estado).toBe("con_reporte");
    expect(await registrarResena(token, 5, "Excelente")).toBe("con_reporte");
    expect(await resenasDe(pago.id)).toEqual([]);

    await decidir(monitoria.id, "rechazado");

    expect((await leerResenaPorToken(token))?.estado).toBe("disponible");
    expect(await registrarResena(token, 4, null)).toBe("registrada");
    expect(await resenasDe(pago.id)).toHaveLength(1);
  });

  it("un reporte aceptado también bloquea el enlace, aunque la monitoría quede cancelada", async () => {
    const { monitoria, pago } = await realizada();
    const token = await tokenDe(pago.id);
    await procesarHasta(pago.id);

    await reportar(monitoria.id, "aceptado");
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" }).eq("id", monitoria.id).select().single(), "cancelar la monitoría");

    expect((await leerResenaPorToken(token))?.estado).toBe("con_reporte");
    expect(await registrarResena(token, 3, null)).toBe("con_reporte");
    expect(await resenasDe(pago.id)).toEqual([]);
  });

  it("una reseña ya guardada no se toca porque después llegue un reporte", async () => {
    const { monitoria, pago } = await realizada();
    const token = await tokenDe(pago.id);
    expect(await registrarResena(token, 4, "Muy bien")).toBe("registrada");
    const [antes] = await resenasDe(pago.id);
    await procesarHasta(pago.id);

    await reportar(monitoria.id);

    expect(await resenasDe(pago.id)).toEqual([antes]);
    expect((await leerResenaPorToken(token))?.estado).toBe("ya_resenada");
  });
});
