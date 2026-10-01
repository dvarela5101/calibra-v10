import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/avisar-monitores/route";
import {
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarAvisosAlMonitor,
  reconstruirAvisoCancelada,
  reconstruirAvisoConfirmada,
} from "@/lib/avisos/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

/**
 * HU-051 contra el Supabase local: el trigger de `monitoria` anota el aviso, `procesarAvisosAlMonitor` (el mismo
 * código de la ruta `/api/procesos/avisar-monitores`) lo manda por Mailpit al correo del monitor y lo marca
 * procesado. En local no hay configuración en Vault, así que la base no llama a la app: la prueba llama el proceso.
 *
 * El estado lo cambia service_role, como lo harán HU-018 (confirmar) y HU-024 (cancelar): el trigger reacciona al
 * cambio sin importar quién lo hace. Las monitorías son de un lunes a varias semanas, lejos de cualquier proceso
 * programado.
 */

let fx: Fixtures;
let mailpit: string;
let e: Awaited<ReturnType<typeof construirEscenario>>;
const claves: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  fx = new Fixtures();
  try {
    e = await construirEscenario();
  } catch (error) {
    await fx.limpiar();
    throw error;
  }
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (e) await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${e.monitor.correo}"`)}`, { method: "DELETE" });
  if (claves.length) await fx.admin.from("correo_envio").delete().in("clave", claves);
  await fx?.limpiar();
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
  // Con monitor_privado: el aviso va a su correo, como el de un monitor registrado (HU-013).
  const monitor = await fx.crearMonitor({ conContacto: true });
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1, hora: "10:00:00" });
  const lead = await fx.crearLead();
  return { admin, materia, monitor, lead, contexto: { materia, monitor, franja, lead } };
}

let semana = 0;
/** Una monitoría pendiente de pago, cada una en un lunes distinto (una franja no tiene dos activas el mismo día). */
async function pendiente() {
  const monitoria = await fx.crearMonitoria(e.contexto, { fecha: lunesLejano(semana++), estado: "pendiente_pago" });
  claves.push(claveDeCorreo("aviso_monitor_confirmada", monitoria.id), claveDeCorreo("aviso_monitor_cancelada", monitoria.id));
  return monitoria;
}

async function cambiarEstado(id: string, estado: "confirmada" | "cancelada" | "realizada", motivo?: string) {
  exito(
    await fx.admin
      .from("monitoria")
      .update({
        estado,
        motivo_cancelacion: (motivo ?? null) as never,
        fecha_finalizacion: estado === "realizada" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select()
      .single(),
    `pasar la monitoría a ${estado}`,
  );
}

async function avisosDe(id: string) {
  return exito(await fx.admin.from("aviso_monitor").select("evento, procesado_en").eq("id_monitoria", id).order("creado_en"), "leer avisos");
}

type Mensaje = { Subject: string; Text: string; HTML: string };

async function correosDelMonitor(): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${e.monitor.correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

async function procesar() {
  return procesarAvisosAlMonitor({ cliente: fx.admin });
}

describe("criterio 1: una individual que pasa a confirmada le llega al monitor", () => {
  it("el trigger anota el aviso, el proceso manda el correo con los datos de la sesión y sin el contacto del estudiante, y no lo repite", async () => {
    const m = await pendiente();
    const antes = (await correosDelMonitor()).length;

    await cambiarEstado(m.id, "confirmada");
    expect(await avisosDe(m.id)).toEqual([{ evento: "confirmada", procesado_en: null }]);

    const resumen = await procesar();
    expect(resumen.enviados).toBeGreaterThanOrEqual(1);
    expect(resumen.conError).toBe(0);

    const correos = await correosDelMonitor();
    expect(correos).toHaveLength(antes + 1);
    const correo = correos.find((c) => c.Subject === `Tienes una monitoría confirmada de ${e.materia.nombre}`);
    expect(correo, "debía llegar el aviso de confirmada").toBeDefined();
    expect(correo!.Text).toContain(`${e.lead.nombre} tiene una monitoría contigo y ya quedó confirmada.`);
    expect(correo!.Text).toContain("Duración: 60 minutos.");
    expect(correo!.Text).toContain("Modalidad: presencial.");
    expect(correo!.Text).toContain("/monitor/agenda");
    for (const privado of [e.lead.correo, e.lead.numero_telefono].filter(Boolean)) {
      expect(correo!.Text).not.toContain(privado);
      expect(correo!.HTML).not.toContain(privado);
    }

    const [aviso] = await avisosDe(m.id);
    expect(aviso.procesado_en).not.toBeNull();
    const registro = exito(
      await fx.admin.from("correo_envio").select("estado, destinatario").eq("clave", claveDeCorreo("aviso_monitor_confirmada", m.id)).single(),
      "leer el registro",
    );
    expect(registro).toEqual({ estado: "enviado", destinatario: e.monitor.correo });

    // Otra corrida no lo manda otra vez.
    await procesar();
    expect(await correosDelMonitor()).toHaveLength(antes + 1);
  });
});

describe("criterio 2: el estudiante cancela una confirmada", () => {
  it("le llega al monitor que el estudiante la canceló, con la materia", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    await procesar();
    const antes = (await correosDelMonitor()).length;

    await cambiarEstado(m.id, "cancelada", "estudiante");
    expect((await avisosDe(m.id)).map((a) => a.evento)).toEqual(["confirmada", "cancelada"]);
    await procesar();

    const correos = await correosDelMonitor();
    expect(correos).toHaveLength(antes + 1);
    const correo = correos.find((c) => c.Subject === `Se canceló tu monitoría de ${e.materia.nombre}`);
    expect(correo, "debía llegar el aviso de cancelación").toBeDefined();
    expect(correo!.Text).toContain(`${e.lead.nombre} canceló la monitoría de ${e.materia.nombre} del`);
  });

  it("si la cancela antes de que salga el aviso de confirmada, solo sale el de cancelación", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    await cambiarEstado(m.id, "cancelada", "estudiante");
    const asuntos = async () => (await correosDelMonitor()).map((c) => c.Subject);
    const cuantos = (lista: string[], asunto: string) => lista.filter((a) => a === asunto).length;
    const confirmada = `Tienes una monitoría confirmada de ${e.materia.nombre}`;
    const cancelada = `Se canceló tu monitoría de ${e.materia.nombre}`;
    const antes = await asuntos();

    const resumen = await procesar();
    expect(resumen.descartados).toBeGreaterThanOrEqual(1);

    const despues = await asuntos();
    expect(despues).toHaveLength(antes.length + 1);
    expect(cuantos(despues, cancelada)).toBe(cuantos(antes, cancelada) + 1);
    expect(cuantos(despues, confirmada)).toBe(cuantos(antes, confirmada));
    expect((await avisosDe(m.id)).every((a) => a.procesado_en !== null)).toBe(true);
  });
});

describe("criterio 3: lo que no se avisa", () => {
  it("una reserva que vence sin pago, una confirmada que se cancela por otro motivo y una que se realiza no anotan avisos nuevos", async () => {
    const vencida = await pendiente();
    await cambiarEstado(vencida.id, "cancelada", "reserva_expirada");
    expect(await avisosDe(vencida.id)).toEqual([]);

    const rechazada = await pendiente();
    await cambiarEstado(rechazada.id, "confirmada");
    await cambiarEstado(rechazada.id, "cancelada", "pago_rechazado");
    expect((await avisosDe(rechazada.id)).map((a) => a.evento)).toEqual(["confirmada"]);

    const realizada = await pendiente();
    await cambiarEstado(realizada.id, "confirmada");
    await cambiarEstado(realizada.id, "realizada");
    expect((await avisosDe(realizada.id)).map((a) => a.evento)).toEqual(["confirmada"]);
    await procesar();
  });
});

describe("sin mandarlo dos veces", () => {
  it("dos corridas a la vez sobre el mismo aviso mandan un solo correo", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    const antes = (await correosDelMonitor()).length;

    await Promise.all([procesar(), procesar()]);

    expect(await correosDelMonitor()).toHaveLength(antes + 1);
    expect((await avisosDe(m.id))[0].procesado_en).not.toBeNull();
  });
});

describe("cuando no se puede procesar", () => {
  it("sin registro de correos el aviso queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    const intentosDe = async () =>
      exito(await fx.admin.from("aviso_monitor").select("intentos, procesado_en").eq("id_monitoria", m.id).single(), "leer el aviso");

    const primera = await procesarAvisosAlMonitor({ cliente: fx.admin, enviar: sinRegistro });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await intentosDe()).toEqual({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarAvisosAlMonitor({ cliente: fx.admin, enviar: sinRegistro });
    const final = await intentosDe();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
  });

  it("pasado el presupuesto de tiempo no toma más avisos: quedan para la próxima corrida", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    let llamadas = 0;
    // El reloj ya pasó el presupuesto desde la primera consulta después del inicio.
    const reloj = () => (llamadas++ === 0 ? 0 : PRESUPUESTO_DE_CORRIDA_MS);

    const resumen = await procesarAvisosAlMonitor({ cliente: fx.admin, reloj });

    expect(resumen.pospuestos).toBe(resumen.revisados);
    expect(resumen.enviados).toBe(0);
    expect((await avisosDe(m.id))[0].procesado_en).toBeNull();
    await procesar();
  });
});

describe("criterio 4: el reintento (HU-065) reconstruye el aviso desde la monitoría", () => {
  it("con el proveedor caído el correo queda fallido, y el proceso de reintentos lo manda una sola vez", async () => {
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");
    const clave = claveDeCorreo("aviso_monitor_confirmada", m.id);
    const antes = (await correosDelMonitor()).length;

    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await procesar();
    vi.unstubAllEnvs();
    expect(caida.fallidos).toBeGreaterThanOrEqual(1);
    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({
      estado: "fallido",
      reintentable: true,
    });
    expect((await avisosDe(m.id))[0].procesado_en).not.toBeNull();

    // El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante.
    await reintentarCorreosFallidos({
      cliente: fx.admin,
      reconstructores: RECONSTRUCTORES,
      enviar: enviarCorreoDesdeServidor,
      ahora: new Date(Date.now() + 3 * 60_000),
    });

    expect(exito(await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single(), "leer el registro").estado).toBe("enviado");
    const correos = await correosDelMonitor();
    expect(correos).toHaveLength(antes + 1);
    expect(correos.filter((c) => c.Subject === `Tienes una monitoría confirmada de ${e.materia.nombre}`).length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("el de confirmada mientras siga confirmada, y el de cancelada cuando la canceló el estudiante", async () => {
    const m = await pendiente();
    expect(await reconstruirAvisoConfirmada(m.id, fx.admin)).toBeNull();

    await cambiarEstado(m.id, "confirmada");
    const confirmada = await reconstruirAvisoConfirmada(m.id, fx.admin);
    expect(confirmada?.destinatario).toBe(e.monitor.correo);
    expect(confirmada?.datos).toMatchObject({ nombreEstudiante: e.lead.nombre, materia: e.materia.nombre, duracionMin: 60, presencial: true });
    expect(await reconstruirAvisoCancelada(m.id, fx.admin)).toBeNull();

    await cambiarEstado(m.id, "cancelada", "estudiante");
    expect(await reconstruirAvisoConfirmada(m.id, fx.admin)).toBeNull();
    expect((await reconstruirAvisoCancelada(m.id, fx.admin))?.destinatario).toBe(e.monitor.correo);
    expect(await reconstruirAvisoConfirmada("no-es-un-uuid", fx.admin)).toBeNull();
    await procesar();
  });
});

describe("la ruta /api/procesos/avisar-monitores", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/avisar-monitores", {
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

  it("con el secreto correcto procesa los avisos y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const m = await pendiente();
    await cambiarEstado(m.id, "confirmada");

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartados", "enviados", "fallidos", "pospuestos", "revisados", "tomadosPorOtro"]);
    expect(resumen.revisados).toBe(
      resumen.enviados + resumen.descartados + resumen.fallidos + resumen.tomadosPorOtro + resumen.conError + resumen.pospuestos,
    );
    expect((await avisosDe(m.id))[0].procesado_en).not.toBeNull();
  });
});
