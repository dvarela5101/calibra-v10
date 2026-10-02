import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria, cargarReserva } from "@/lib/agendar/servidor";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { rutaDeComprobante, rutaEsDelUsuario } from "@/lib/comprobantes/reglas";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { validarPagador } from "@/lib/pagos/reglas";
import { registrarPago } from "@/lib/pagos/servidor";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-018 contra el Supabase local, por la misma ruta que la acción `pagar`: la sesión del Lead sube el comprobante
 * a su carpeta con su propio cliente (`subirComprobante`), el servidor lo revisa con la llave secreta
 * (`revisarComprobanteDesdeServidor`) y `registrarPago` llama a `public.registrar_pago` con el cliente de la
 * sesión. Así también se prueban la política del bucket, la revisión de HU-059, los permisos de la función y el
 * turno de admins de HU-054. La reserva se aparta con `agendarMonitoria` (HU-017), como en la página.
 *
 * El Auth local deja crear 150 sesiones anónimas por hora y el resto de la suite ya usa muchas: este archivo crea
 * dos, una sola vez, como `agendar.test.ts`. La cuota de comprobantes (5 cada 24 h) es por sesión, así que cada
 * prueba la empieza libre.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const PRECIO = 32_000;

// La firma mínima de un PNG: la revisión del servidor mira los primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

type Sesion = Awaited<ReturnType<Fixtures["crearAnonimo"]>>;

let fx: Fixtures;
let sesiones: Fixtures;
let bd: pg.Client;
/** Las dos sesiones anónimas del archivo. Ninguna es Lead de entrada: cada prueba le crea el suyo (`sesionLead`). */
let pool: [Sesion, Sesion];
/** Las monitorías que apartó la prueba: al final se anotan sus pagos para la limpieza, aunque la prueba falle a medias. */
let apartadas: string[];

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  sesiones = new Fixtures();
  try {
    pool = [await sesiones.crearAnonimo(), await sesiones.crearAnonimo()];
  } catch (error) {
    await sesiones.limpiar();
    throw error;
  }
});

afterAll(async () => {
  await bd?.end();
  await sesiones?.limpiar();
});

beforeEach(async () => {
  fx = new Fixtures();
  apartadas = [];
  // La cuota cuenta subidas, no archivos: borrar los de la prueba anterior no la libera.
  await bd.query("delete from privado.subida_comprobante where carpeta = any($1::text[])", [pool.map((sesion) => sesion.id)]);
});

afterEach(async () => {
  // Un pago impide borrar su monitoría (llave foránea sin cascada).
  for (const id of apartadas) await pagosDe(id);
  await fx.limpiar();
});

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

const hoy = () => diaDelNegocio(new Date());

/** Una de las sesiones anónimas del archivo, ya con su contacto dejado: es Lead (HU-068). */
async function sesionLead(numero: 0 | 1 = 0) {
  const sesion = pool[numero];
  const lead = await fx.crearLeadDeSesion(sesion.id);
  return { ...sesion, lead };
}

/**
 * Un monitor certificado en una materia, con una franja que cae dentro de 2 días a las 10:00 a $ 32.000: ni la
 * antelación ni el aviso de las 12 h dependen de la hora en que corre la prueba. `pedido(n)` es la fecha de la
 * semana n (0 a 3, dentro del horizonte que se agenda).
 */
async function escenario() {
  const admin = await fx.crearAdmin();
  const { materia } = await fx.crearEvaluacion();
  const monitor = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", precio: PRECIO, abiertaDesde: hoy() });
  const pedido = (semana = 0): PedidoDeAgendar => ({ idFranja: franja.id, fecha: sumarDias(primera, 7 * semana), codigoMateria: materia.codigo });
  return { admin, monitor, pedido };
}

/** Aparta la fecha con la sesión del Lead, como la página de agendar, y la anota para la limpieza. */
async function apartar(cliente: Cliente, pedido: PedidoDeAgendar): Promise<string> {
  const { resultado, idMonitoria } = await agendarMonitoria(cliente, pedido, false);
  if (idMonitoria) {
    fx.registrarMonitoria(idMonitoria);
    apartadas.push(idMonitoria);
  }
  expect(resultado, "apartar la fecha").toBe("agendada");
  return idMonitoria!;
}

/** Lo que pasa antes de pagar: el navegador sube el PNG a la carpeta de la sesión y el servidor lo revisa. */
async function comprobanteRevisado(cliente: Cliente, idUsuario: string): Promise<string> {
  const subida = await subirComprobante(cliente, idUsuario, new File([PNG as BlobPart], "transferencia.png", { type: "image/png" }));
  if (!subida.ok) throw new Error(`no se pudo subir el comprobante: ${subida.mensaje}`);
  fx.registrarComprobante(subida.ruta);
  expect(await revisarComprobanteDesdeServidor(subida.ruta), "revisar el comprobante").toEqual({ ok: true, tipo: "image/png" });
  return subida.ruta;
}

// Lo que escribe la persona; la acción lo normaliza con validarPagador antes de pagar.
const PAGADOR = validarPagador({ nombre: "  Ana   Pérez ", correo: " Ana.Perez@Uniandes.EDU.co " });

/** Registra el pago con la sesión de `cliente`, como la acción, y anota el pago que se cree para la limpieza. */
async function pagar(cliente: Cliente, idMonitoria: string, ruta: string) {
  if (!PAGADOR.ok) throw new Error(PAGADOR.mensaje);
  const registro = await registrarPago(cliente, { idMonitoria, ruta, nombre: PAGADOR.nombre, correo: PAGADOR.correo });
  if (registro.idPago) fx.registrarPago(registro.idPago);
  return registro;
}

/** Los pagos de una monitoría (con la llave secreta), anotados para la limpieza aunque una regresión cree de más. */
async function pagosDe(idMonitoria: string) {
  const filas = exito(await fx.admin.from("pago").select("*").eq("id_monitoria", idMonitoria).order("fecha_pago"), "leer los pagos");
  for (const fila of filas) fx.registrarPago(fila.id);
  return filas;
}

/** En qué pagos está un comprobante. */
const usosDe = async (ruta: string) => exito(await fx.admin.from("pago").select("id_monitoria").eq("comprobante", ruta), "leer los usos del comprobante");

const monitoriaDe = async (id: string) =>
  exito(await fx.admin.from("monitoria").select("estado, valor_total").eq("id", id).single(), "leer la monitoría");

const avisosDe = async (id: string) =>
  exito(await fx.admin.from("aviso_monitor").select("evento").eq("id_monitoria", id), "leer los avisos al monitor");

/** La hora de la base (la que usa `registrar_pago`), no la del proceso. */
async function relojDeLaBase(): Promise<number> {
  const { rows } = await bd.query<{ ahora: Date }>("select clock_timestamp() as ahora");
  return rows[0].ahora.getTime();
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 2, 3 y 6: el Lead adjunta el comprobante y queda un pago en revisión", () => {
  it("registrado: pago en_revision por el valor_total, del primer admin activo y con fecha de asignación; la monitoría queda confirmada y se anota el aviso al monitor", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const id = await apartar(lead.cliente, e.pedido());
    const ruta = await comprobanteRevisado(lead.cliente, lead.id);
    // El turno sale de la base (HU-054): otras pruebas pueden cambiar el orden o desactivar admins.
    const { rows } = await bd.query<{ id: string | null }>("select privado.siguiente_admin_activo() as id");
    const turno = rows[0].id;
    expect(turno, "la base local tiene un admin activo").not.toBeNull();
    const antes = await relojDeLaBase();

    const registro = await pagar(lead.cliente, id, ruta);

    const despues = await relojDeLaBase();
    expect(registro).toEqual({ resultado: "registrado", idPago: expect.any(String) });
    const pagos = await pagosDe(id);
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({
      id: registro.idPago,
      estado: "en_revision",
      // P-36: el monto es el valor_total de la monitoría; nadie lo escribió.
      monto: PRECIO,
      nombre_pagador: "Ana Pérez",
      contacto: "ana.perez@uniandes.edu.co",
      id_admin: turno,
      comprobante: ruta,
      fecha_revision: null,
      referencia_transferencia: null,
    });
    const asignacion = new Date(pagos[0].fecha_asignacion).getTime();
    expect(asignacion).toBeGreaterThanOrEqual(antes);
    expect(asignacion).toBeLessThanOrEqual(despues);
    expect(new Date(pagos[0].fecha_pago).getTime()).toBe(asignacion);

    // RN-38: sin esperar al admin. La página del Lead ya la lee confirmada.
    expect(await monitoriaDe(id)).toEqual({ estado: "confirmada", valor_total: PRECIO });
    expect((await cargarReserva(lead.cliente, id))?.estado).toBe("confirmada");
    // HU-051: el paso a confirmada anota el aviso al monitor.
    expect(await avisosDe(id)).toEqual([{ evento: "confirmada" }]);
  });

  it("un segundo intento sobre la misma monitoría, con otro comprobante revisado, da ya_pagada y no crea otro pago", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const id = await apartar(lead.cliente, e.pedido());
    const primero = await comprobanteRevisado(lead.cliente, lead.id);
    expect((await pagar(lead.cliente, id, primero)).resultado).toBe("registrado");
    const segundo = await comprobanteRevisado(lead.cliente, lead.id);

    expect(await pagar(lead.cliente, id, segundo)).toEqual({ resultado: "ya_pagada", idPago: null });

    const pagos = await pagosDe(id);
    expect(pagos.map((p) => p.comprobante)).toEqual([primero]);
    expect(await usosDe(segundo)).toEqual([]);
    expect((await monitoriaDe(id)).estado).toBe("confirmada");
    expect(await avisosDe(id)).toHaveLength(1);
  });

  it("dos envíos a la vez sobre la misma monitoría (doble clic o dos pestañas): uno registrado, el otro ya_pagada y un solo pago, en dos rondas", async () => {
    const e = await escenario();
    const lead = await sesionLead();

    for (const ronda of [0, 1]) {
      // Con la anterior ya confirmada, D-8 deja apartar otra fecha.
      const id = await apartar(lead.cliente, e.pedido(ronda));
      const a = await comprobanteRevisado(lead.cliente, lead.id);
      const b = await comprobanteRevisado(lead.cliente, lead.id);
      // Se alterna quién sale primero en la llamada.
      const [primera, segunda] = ronda === 0 ? [a, b] : [b, a];

      const resultados = await Promise.all([pagar(lead.cliente, id, primera), pagar(lead.cliente, id, segunda)]);

      expect(resultados.map((r) => r.resultado).sort(), `ronda ${ronda + 1}`).toEqual(["registrado", "ya_pagada"]);
      const ganadora = resultados.findIndex((r) => r.resultado === "registrado");
      const pagos = await pagosDe(id);
      expect(pagos, `ronda ${ronda + 1}`).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ id: resultados[ganadora].idPago, comprobante: [primera, segunda][ganadora], monto: PRECIO });
      expect((await monitoriaDe(id)).estado).toBe("confirmada");
      expect(await avisosDe(id)).toHaveLength(1);
    }
  });
});

describe("criterio 4 (RN-34, P-40): vencida la reserva de 10 minutos, no se adjunta el comprobante", () => {
  it("con la reserva apartada hace 11 minutos da vencida, la haya cancelado ya o no el proceso de HU-027: no hay pago, no se confirma y no se avisa", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const id = await apartar(lead.cliente, e.pedido());
    exito(
      await fx.admin.from("monitoria").update({ fecha_creacion: new Date(Date.now() - 11 * MINUTO).toISOString() }).eq("id", id).select().single(),
      "envejecer la reserva",
    );
    const ruta = await comprobanteRevisado(lead.cliente, lead.id);

    expect(await pagar(lead.cliente, id, ruta)).toEqual({ resultado: "vencida", idPago: null });

    expect(await pagosDe(id)).toEqual([]);
    expect(await usosDe(ruta)).toEqual([]);
    // El proceso de cada minuto (HU-027) la cancela si corre después de envejecerla; si no, sigue por pagar. El
    // resultado es vencida en los dos casos: no depende de quién llegó primero.
    const { estado, motivo_cancelacion } = exito(
      await fx.admin.from("monitoria").select("estado, motivo_cancelacion").eq("id", id).single(),
      "leer la monitoría",
    );
    expect([
      { estado: "pendiente_pago", motivo_cancelacion: null },
      { estado: "cancelada", motivo_cancelacion: "reserva_expirada" },
    ]).toContainEqual({ estado, motivo_cancelacion });
    expect(await avisosDe(id)).toEqual([]);
  });
});

describe("criterio 7: el comprobante está en la carpeta de quien paga, revisado y en el bucket", () => {
  it("el de otra sesión, aunque esté revisado: la acción lo corta con rutaEsDelUsuario y, si alguien se la salta, la base responde comprobante_ajeno", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const otra = pool[1];
    const id = await apartar(lead.cliente, e.pedido());
    const ajeno = await comprobanteRevisado(otra.cliente, otra.id);

    expect(rutaEsDelUsuario(lead.id, ajeno)).toBe(false);
    expect(await pagar(lead.cliente, id, ajeno)).toEqual({ resultado: "comprobante_ajeno", idPago: null });

    expect(await pagosDe(id)).toEqual([]);
    expect(await usosDe(ajeno)).toEqual([]);
    expect((await monitoriaDe(id)).estado).toBe("pendiente_pago");
  });

  it("una ruta de su carpeta que nunca se subió: la revisión falla antes de pagar, y la base tampoco la acepta sin revisar", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const id = await apartar(lead.cliente, e.pedido());
    const ruta = rutaDeComprobante(lead.id, "png");

    expect(rutaEsDelUsuario(lead.id, ruta)).toBe(true);
    expect(await revisarComprobanteDesdeServidor(ruta)).toEqual({
      ok: false,
      motivo: "no_existe",
      mensaje: "No encontramos el comprobante. Vuelve a subirlo.",
    });
    expect(await pagar(lead.cliente, id, ruta)).toEqual({ resultado: "comprobante_sin_revisar", idPago: null });

    expect(await pagosDe(id)).toEqual([]);
    expect((await monitoriaDe(id)).estado).toBe("pendiente_pago");
  });

  it("uno que ya respalda el pago de otra monitoría: comprobante_usado, aunque la revisión lo vuelva a aceptar", async () => {
    const e = await escenario();
    const lead = await sesionLead();
    const primera = await apartar(lead.cliente, e.pedido(0));
    const ruta = await comprobanteRevisado(lead.cliente, lead.id);
    expect((await pagar(lead.cliente, primera, ruta)).resultado).toBe("registrado");
    // Con la primera confirmada, D-8 deja apartar otra fecha.
    const segunda = await apartar(lead.cliente, e.pedido(1));
    expect(await revisarComprobanteDesdeServidor(ruta)).toEqual({ ok: true, tipo: "image/png" });

    expect(await pagar(lead.cliente, segunda, ruta)).toEqual({ resultado: "comprobante_usado", idPago: null });

    expect(await pagosDe(segunda)).toEqual([]);
    expect(await usosDe(ruta)).toEqual([{ id_monitoria: primera }]);
    expect((await monitoriaDe(segunda)).estado).toBe("pendiente_pago");
  });
});

describe("supuesto 3: solo la sesión del Lead de la reserva paga", () => {
  it("otro Lead, el monitor de la monitoría y un admin, cada uno con su comprobante revisado, reciben no_es_tuya; sin sesión ni se ejecuta", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const otra = await sesionLead(1);
    const id = await apartar(duena.cliente, e.pedido());
    const quienes: [string, Cliente, string][] = [
      ["otro Lead", otra.cliente, otra.id],
      ["el monitor de la monitoría", await fx.iniciarSesion(e.monitor), e.monitor.id],
      ["un admin", await fx.iniciarSesion(e.admin), e.admin.id],
    ];

    for (const [quien, cliente, idUsuario] of quienes) {
      const ruta = await comprobanteRevisado(cliente, idUsuario);
      expect(await pagar(cliente, id, ruta), quien).toEqual({ resultado: "no_es_tuya", idPago: null });
      expect(await usosDe(ruta), quien).toEqual([]);
    }
    // Una reserva que no existe da lo mismo: no se revela cuáles existen.
    expect(await pagar(duena.cliente, randomUUID(), rutaDeComprobante(duena.id, "png"))).toEqual({ resultado: "no_es_tuya", idPago: null });
    // Sin sesión (rol anon) la función ni siquiera se ejecuta.
    await expect(pagar(crearCliente(), id, rutaDeComprobante(duena.id, "png"))).rejects.toThrow(/No se pudo registrar el pago: 42501/);

    expect(await pagosDe(id)).toEqual([]);
    expect((await monitoriaDe(id)).estado).toBe("pendiente_pago");
    expect(await avisosDe(id)).toEqual([]);
  });
});
