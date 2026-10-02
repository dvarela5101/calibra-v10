import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria, cargarReserva } from "@/lib/agendar/servidor";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { SEMANAS_DEL_HORIZONTE } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres } from "@/lib/disponibilidad/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { validarPagador } from "@/lib/pagos/reglas";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-027 contra el Supabase local. El proceso (`privado.expirar_reservas`) lo corre pg_cron como postgres cada
 * minuto: aquí se llama con un cliente `pg` como postgres. Las reservas se apartan, se leen y se vuelven a pedir por
 * la misma ruta de la página (`agendarMonitoria`, `cargarReserva`, `cargarFechasLibres`) con la sesión anónima de cada
 * Lead. Los bordes y el conteo exacto del proceso, con una hora fija, están en `supabase/tests/expirar_reservas.test.sql`.
 *
 * POR QUÉ SE ENVEJECE DENTRO DE UNA TRANSACCIÓN: el mismo proceso corre de verdad cada minuto en la base local y en
 * la de CI. Si la prueba confirmara una reserva envejecida, pg_cron podría cancelarla antes que la prueba y ya no se
 * sabría quién la canceló. Por eso cada prueba envejece la reserva (`fecha_creacion` hacia atrás) en la misma
 * transacción en que la cancela o la vuelve a pedir: hasta que esa transacción termina, pg_cron solo ve la reserva
 * recién creada, vigente, y no la toca.
 * Una transacción que confirma `privado.expirar_reservas(now())` cancela también cualquier otra reserva de la base que
 * ya hubiera vencido: es lo mismo que haría pg_cron en menos de un minuto. Con una hora futura (criterio 2, el pago
 * primero, y la corrida del minuto siguiente del criterio 3) la transacción siempre se revierte, porque cancelaría
 * reservas ajenas que todavía están vigentes.
 *
 * El Auth local deja crear 150 sesiones anónimas por hora y el resto de la suite ya usa muchas: este archivo crea dos,
 * una sola vez, y cada prueba les pone su Lead.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PRECIO = 32_000;

// La firma mínima de un PNG: la revisión del servidor mira los primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

// Lo que escribe la persona; la acción lo normaliza con validarPagador antes de pagar.
const PAGADOR = validarPagador({ nombre: "Ana Pérez", correo: "ana.perez@uniandes.edu.co" });

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

type Sesion = Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
type Escenario = Awaited<ReturnType<typeof escenario>>;

let fx: Fixtures;
let sesiones: Fixtures;
let bd: pg.Client;
/** Las dos sesiones anónimas del archivo. Ninguna es Lead de entrada: cada prueba le crea el suyo (`sesionLead`). */
let pool: [Sesion, Sesion];
/** La franja de la prueba: al final se anotan sus monitorías y sus pagos para la limpieza, aunque la prueba falle a medias. */
let franjaDeLaPrueba: string | null;

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

beforeEach(() => {
  fx = new Fixtures();
  franjaDeLaPrueba = null;
});

afterEach(async () => {
  // Un pago impide borrar su monitoría (llave foránea sin cascada).
  if (franjaDeLaPrueba) for (const { id } of await monitoriasDe(franjaDeLaPrueba)) await pagosDe(id);
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
async function sesionLead(numero: 0 | 1) {
  const sesion = pool[numero];
  const lead = await fx.crearLeadDeSesion(sesion.id);
  return { ...sesion, lead };
}

/**
 * Un monitor certificado en una materia, con una franja que cae dentro de 2 días a las 10:00 a $ 32.000: ni la
 * antelación ni el aviso de las 12 h dependen de la hora en que corre la prueba. `pedido(n)` es la fecha de la semana n
 * (0 a 3, dentro del horizonte que se agenda).
 */
async function escenario() {
  const admin = await fx.crearAdmin();
  const materia = await fx.crearMateria();
  const monitor = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", precio: PRECIO, abiertaDesde: hoy() });
  franjaDeLaPrueba = franja.id;
  const pedido = (semana = 0): PedidoDeAgendar => ({ idFranja: franja.id, fecha: sumarDias(primera, 7 * semana), codigoMateria: materia.codigo });
  const todas = [0, 1, 2, 3].map((semana) => pedido(semana).fecha);
  return { materia, franja, pedido, todas };
}

/** Aparta la fecha con la sesión del Lead, como la página de agendar, y la anota para la limpieza. */
async function apartar(cliente: Cliente, pedido: PedidoDeAgendar): Promise<string> {
  const { resultado, idMonitoria } = await agendarMonitoria(cliente, pedido, false);
  if (idMonitoria) fx.registrarMonitoria(idMonitoria);
  expect(resultado, "apartar la fecha").toBe("agendada");
  return idMonitoria!;
}

/** Las fechas de la franja de la prueba que ve un visitante sin sesión en la lista de la materia (HU-016). */
async function fechasLibresDe(e: Escenario): Promise<string[]> {
  const libres = await cargarFechasLibres(crearCliente(), e.materia.codigo, SEMANAS_DEL_HORIZONTE);
  return libres.filter((f) => f.idFranja === e.franja.id).map((f) => f.fecha);
}

/** Lo que pasa antes de pagar: el navegador sube el PNG a la carpeta de la sesión y el servidor lo revisa. */
async function comprobanteRevisado(cliente: Cliente, idUsuario: string): Promise<string> {
  const subida = await subirComprobante(cliente, idUsuario, new File([PNG as BlobPart], "transferencia.png", { type: "image/png" }));
  if (!subida.ok) throw new Error(`no se pudo subir el comprobante: ${subida.mensaje}`);
  fx.registrarComprobante(subida.ruta);
  expect(await revisarComprobanteDesdeServidor(subida.ruta), "revisar el comprobante").toEqual({ ok: true, tipo: "image/png" });
  return subida.ruta;
}

/** Las monitorías de una franja (con la llave secreta), anotadas para la limpieza aunque una regresión cree de más. */
async function monitoriasDe(idFranja: string) {
  const filas = exito(await fx.admin.from("monitoria").select("id").eq("id_franja", idFranja), "leer las monitorías de la franja");
  for (const fila of filas) fx.registrarMonitoria(fila.id);
  return filas;
}

/** Los pagos de una monitoría (con la llave secreta), anotados para la limpieza aunque una regresión cree de más. */
async function pagosDe(idMonitoria: string) {
  const filas = exito(await fx.admin.from("pago").select("*").eq("id_monitoria", idMonitoria), "leer los pagos");
  for (const fila of filas) fx.registrarPago(fila.id);
  return filas;
}

/** En qué pagos está un comprobante. */
const usosDe = async (ruta: string) => exito(await fx.admin.from("pago").select("id_monitoria").eq("comprobante", ruta), "leer los usos del comprobante");

const avisosDe = async (id: string) => exito(await fx.admin.from("aviso_monitor").select("evento").eq("id_monitoria", id), "leer los avisos al monitor");

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`, como postgres (o con el rol y el token de una sesión)

/** Corre `accion` en una transacción de `cliente`: la confirma si `confirmar`; si no, o si algo falla, la revierte. */
async function enTransaccion<T>(cliente: pg.Client, confirmar: boolean, accion: () => Promise<T>): Promise<T> {
  await cliente.query("begin");
  try {
    const resultado = await accion();
    await cliente.query(confirmar ? "commit" : "rollback");
    return resultado;
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  }
}

type Fila = { estado: string; motivo_cancelacion: string | null; fecha_creacion: string; ctid: string };

/** La monitoría como la ve `cliente` (dentro de su transacción), con la versión física de la fila (`ctid`). */
async function fila(cliente: pg.Client, id: string): Promise<Fila> {
  const { rows } = await cliente.query<Fila>(
    "select estado::text, motivo_cancelacion::text, fecha_creacion::text, ctid::text from public.monitoria where id = $1",
    [id],
  );
  if (rows.length !== 1) throw new Error(`La monitoría ${id} no existe.`);
  return rows[0];
}

/** Dentro de la transacción de `bd`: la reserva se apartó hace `minutos` minutos, contados desde la hora de la transacción. */
async function envejecer(id: string, minutos: number) {
  const { rowCount } = await bd.query("update public.monitoria set fecha_creacion = now() - make_interval(mins => $2) where id = $1", [id, minutos]);
  expect(rowCount, "envejecer la reserva").toBe(1);
}

/**
 * Corre el proceso en `cliente`: con `ahora` (el texto exacto de un timestamptz) o, sin él, con la hora de la
 * transacción, como el trabajo de pg_cron (`select privado.expirar_reservas(now())`). Devuelve cuántas canceló.
 */
async function expirar(cliente: pg.Client, ahora?: string): Promise<number> {
  const { rows } =
    ahora === undefined
      ? await cliente.query<{ canceladas: number }>("select privado.expirar_reservas(now()) as canceladas")
      : await cliente.query<{ canceladas: number }>("select privado.expirar_reservas($1::timestamptz) as canceladas", [ahora]);
  return rows[0].canceladas;
}

async function fechaLibre(pedido: PedidoDeAgendar): Promise<boolean> {
  const { rows } = await bd.query<{ libre: boolean }>("select privado.fecha_libre($1, $2::date, now()) as libre", [pedido.idFranja, pedido.fecha]);
  return rows[0].libre;
}

/**
 * Dentro de una transacción de `cliente`: lo que sigue corre con el token de la sesión anónima del Lead. El rol sigue
 * siendo postgres: la versión de `registrar_pago` que recibe la hora es interna (revisión de HU-018) y `auth.uid()` lee
 * el token sin importar el rol.
 */
async function comoLead(cliente: pg.Client, idSesion: string) {
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idSesion, role: "authenticated", is_anonymous: true })]);
}

/** `privado.registrar_pago` (HU-018) con la hora `ahora`, desde una conexión que ya corre como el Lead. */
async function registrarEn(cliente: pg.Client, idMonitoria: string, ruta: string, ahora: string) {
  if (!PAGADOR.ok) throw new Error(PAGADOR.mensaje);
  const { rows } = await cliente.query<{ resultado: string; id_pago: string | null }>(
    "select resultado, id_pago from privado.registrar_pago($1, $2, $3, $4, $5::timestamptz)",
    [idMonitoria, ruta, PAGADOR.nombre, PAGADOR.correo, ahora],
  );
  return rows[0];
}

/** Una conexión propia para una de las dos partes de la carrera, con su número de proceso en la base. */
async function conexion() {
  const cliente = new pg.Client({ connectionString: URL_BD });
  await cliente.connect();
  // Si algo no bloquea (o no suelta) como se espera, la consulta falla en vez de colgar la prueba.
  await cliente.query("set lock_timeout = '15s'");
  const { rows } = await cliente.query<{ pid: number }>("select pg_backend_pid() as pid");
  return { cliente, pid: rows[0].pid };
}

type Conexion = Awaited<ReturnType<typeof conexion>>;

/** Cierra las conexiones aunque tengan una consulta esperando: la base revierte su transacción y suelta los bloqueos. */
async function cerrar(...conexiones: Conexion[]) {
  await Promise.allSettled(conexiones.map((c) => c.cliente.end()));
}

/** Una consulta que se deja corriendo: se sabe si ya terminó sin esperarla, y su error no queda sin atender. */
function enCurso<T>(promesa: Promise<T>) {
  const consulta = { terminada: false, promesa };
  promesa.then(
    () => (consulta.terminada = true),
    () => (consulta.terminada = true),
  );
  return consulta;
}

/** Espera a que la conexión `pid` quede bloqueada por la conexión `porPid` (pg_blocking_pids). */
async function esperarBloqueo(pid: number, porPid: number, consulta: { terminada: boolean }) {
  const hasta = Date.now() + ESPERA_MAXIMA;
  while (Date.now() < hasta) {
    if (consulta.terminada) throw new Error(`La consulta de la conexión ${pid} terminó sin esperar a la conexión ${porPid}.`);
    const { rows } = await bd.query<{ bloqueada: boolean }>("select $2::integer = any(pg_blocking_pids($1::integer)) as bloqueada", [pid, porPid]);
    if (rows[0].bloqueada) return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error(`La conexión ${pid} no quedó esperando a la conexión ${porPid} en ${ESPERA_MAXIMA} ms.`);
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1 (RN-34, sección 6.3): el proceso cancela la reserva vencida y la fecha queda libre", () => {
  it("apartada por la página y vencida hace 11 minutos, el proceso la pasa a cancelada (reserva_expirada) sin pago ni aviso; la fecha vuelve a la lista y otro Lead la agenda", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const otra = await sesionLead(1);
    const id = await apartar(duena.cliente, e.pedido());
    // Por pagar y vigente, ocupa su fecha (HU-017, criterio 5).
    expect(await fechasLibresDe(e)).toEqual(e.todas.slice(1));

    const canceladas = await enTransaccion(bd, true, async () => {
      await envejecer(id, 11);
      const n = await expirar(bd);
      expect(await fila(bd, id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" });
      expect(await fechaLibre(e.pedido()), "privado.fecha_libre").toBe(true);
      return n;
    });

    // Al menos la de la prueba: la base compartida puede tener otras vencidas que pg_cron no alcanzó a cancelar.
    expect(canceladas).toBeGreaterThanOrEqual(1);
    const reserva = await cargarReserva(duena.cliente, id);
    expect(reserva).toMatchObject({ id, estado: "cancelada", motivoCancelacion: "reserva_expirada" });
    expect(await pagosDe(id)).toEqual([]);
    // D-16: una reserva que vence sin pago no se le avisa a nadie.
    expect(await avisosDe(id)).toEqual([]);
    expect(await fechasLibresDe(e)).toEqual(e.todas);

    const deOtra = await agendarMonitoria(otra.cliente, e.pedido(), false);
    if (deOtra.idMonitoria) fx.registrarMonitoria(deOtra.idMonitoria);
    expect(deOtra).toEqual({ resultado: "agendada", idMonitoria: expect.any(String) });
    expect(await cargarReserva(otra.cliente, deOtra.idMonitoria!)).toMatchObject({ estado: "pendiente_pago", idLead: otra.lead.id, fecha: e.pedido().fecha });
  });
});

describe("nota técnica: la disponibilidad mira reservaHasta por sí misma, sin esperar al proceso", () => {
  it("sin correr el proceso, la fecha de una reserva vencida aparece libre y otro Lead la agenda: agendar cancela la vencida en el momento", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const otra = await sesionLead(1);
    const id = await apartar(duena.cliente, e.pedido());
    const { idFranja, fecha, codigoMateria } = e.pedido();

    const nueva = await enTransaccion(bd, true, async () => {
      await envejecer(id, 11);
      // Nadie la canceló: el proceso no se corre aquí y pg_cron no ve esta transacción.
      expect(await fila(bd, id)).toMatchObject({ estado: "pendiente_pago", motivo_cancelacion: null });
      expect(await fechaLibre(e.pedido()), "privado.fecha_libre").toBe(true);

      // La lista que lee la página (public.fechas_libres_de_materia, con la hora de la base), como un visitante sin sesión.
      await bd.query("set local role anon");
      const { rows: libres } = await bd.query<{ fecha: string }>(
        "select fecha::text from public.fechas_libres_de_materia($1, $2) where id_franja = $3 order by fecha",
        [codigoMateria, SEMANAS_DEL_HORIZONTE, idFranja],
      );
      expect(libres.map((f) => f.fecha)).toEqual(e.todas);

      // Otro Lead la pide con su sesión, por la misma puerta que agendarMonitoria (y con su rol, authenticated).
      await bd.query("set local role authenticated");
      await comoLead(bd, otra.id);
      const { rows } = await bd.query<{ resultado: string; id_monitoria: string | null }>(
        "select resultado, id_monitoria from public.agendar_monitoria($1, $2::date, $3, false)",
        [idFranja, fecha, codigoMateria],
      );
      await bd.query("reset role");
      expect(rows).toEqual([{ resultado: "agendada", id_monitoria: expect.any(String) }]);
      expect(await fila(bd, id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" });
      return rows[0].id_monitoria!;
    });
    fx.registrarMonitoria(nueva);

    expect(await cargarReserva(otra.cliente, nueva)).toMatchObject({ estado: "pendiente_pago", idLead: otra.lead.id, fecha });
    expect(await cargarReserva(duena.cliente, id)).toMatchObject({ estado: "cancelada", motivoCancelacion: "reserva_expirada" });
    expect(await avisosDe(id)).toEqual([]);
    // La fecha ya es de la reserva nueva.
    expect(await fechasLibresDe(e)).toEqual(e.todas.slice(1));
  });
});

describe("criterio 2: un comprobante que llega en el mismo instante en que vence la reserva", () => {
  // Dos conexiones a la vez, cada una en su transacción: A es la sesión del Lead que paga (privado.registrar_pago con
  // su rol y su token) y B es el proceso (privado.expirar_reservas como postgres). La reserva está justo en el borde:
  // con el límite (reserva_hasta, P-40) el pago todavía entra; un microsegundo después, el proceso ya la cancela. Las
  // horas viajan como texto de la base, porque Date pierde los microsegundos. El comprobante se sube y se revisa de
  // verdad, como en integracion/pagos.test.ts.

  it(
    "el pago llega primero: el proceso espera el bloqueo de la fila y, cuando el pago confirma, ya no la toca; queda confirmada con un pago",
    async () => {
      const e = await escenario();
      const duena = await sesionLead(0);
      const id = await apartar(duena.cliente, e.pedido());
      const ruta = await comprobanteRevisado(duena.cliente, duena.id);
      // Recién apartada, vence en unos 10 minutos: pg_cron no la alcanza durante la prueba.
      const { rows: bordes } = await bd.query<{ limite: string; despues: string; holgura: boolean }>(
        `select public.reserva_hasta(fecha_creacion)::text as limite,
                (public.reserva_hasta(fecha_creacion) + interval '1 microsecond')::text as despues,
                public.reserva_hasta(fecha_creacion) > now() + interval '5 minutes' as holgura
         from public.monitoria where id = $1`,
        [id],
      );
      const { limite, despues, holgura } = bordes[0];
      expect(holgura, "la reserva vence lejos de la hora de pg_cron").toBe(true);

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await comoLead(a.cliente, duena.id);
        const pago = await registrarEn(a.cliente, id, ruta, limite);
        expect(pago).toEqual({ resultado: "registrado", id_pago: expect.any(String) });
        fx.registrarPago(pago.id_pago!);

        await b.cliente.query("begin");
        const proceso = enCurso(expirar(b.cliente, despues));
        await esperarBloqueo(b.pid, a.pid, proceso);

        await a.cliente.query("commit");
        await proceso.promesa;
        // B volvió a mirar la fila con el pago confirmado: ya no estaba por pagar y no la canceló.
        expect(await fila(b.cliente, id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
        // La hora de B es futura: cancelaría reservas ajenas que siguen vigentes.
        await b.cliente.query("rollback");
      } finally {
        await cerrar(a, b);
      }

      expect(await fila(bd, id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
      const pagos = await pagosDe(id);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ estado: "en_revision", monto: PRECIO, comprobante: ruta });
      expect((await cargarReserva(duena.cliente, id))?.estado).toBe("confirmada");
    },
    60_000,
  );

  it(
    "el proceso llega primero: el pago espera el bloqueo de la fila y, cuando el proceso confirma, responde vencida sin crear el pago",
    async () => {
      const e = await escenario();
      const duena = await sesionLead(0);
      const id = await apartar(duena.cliente, e.pedido());
      const ruta = await comprobanteRevisado(duena.cliente, duena.id);

      const a = await conexion();
      const b = await conexion();
      try {
        // B hace lo que haría el proceso un microsegundo después del límite. La reserva se envejece en la misma
        // transacción para que pg_cron no se adelante (no la ve vencida hasta que B confirma), y B corre con la hora
        // de la base: confirmar es lo mismo que haría pg_cron.
        await b.cliente.query("begin");
        const { rows } = await b.cliente.query<{ limite: string; despues: string }>(
          `update public.monitoria set fecha_creacion = now() - interval '10 minutes' - interval '1 microsecond'
           where id = $1
           returning public.reserva_hasta(fecha_creacion)::text as limite, now()::text as despues`,
          [id],
        );
        const { limite, despues } = rows[0];
        expect(await expirar(b.cliente, despues)).toBeGreaterThanOrEqual(1);
        expect(await fila(b.cliente, id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" });

        // A paga con la hora del límite, cuando su reserva todavía estaba vigente: si nadie la hubiera cancelado,
        // el pago entraría (es lo que pasa en la prueba anterior).
        await a.cliente.query("begin");
        await comoLead(a.cliente, duena.id);
        const pago = enCurso(registrarEn(a.cliente, id, ruta, limite));
        await esperarBloqueo(a.pid, b.pid, pago);

        await b.cliente.query("commit");
        expect(await pago.promesa).toEqual({ resultado: "vencida", id_pago: null });
        await a.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }

      expect(await fila(bd, id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" });
      expect(await pagosDe(id)).toEqual([]);
      expect(await usosDe(ruta)).toEqual([]);
      expect(await avisosDe(id)).toEqual([]);
      expect(await cargarReserva(duena.cliente, id)).toMatchObject({ estado: "cancelada", motivoCancelacion: "reserva_expirada" });
    },
    60_000,
  );
});

describe("criterio 3: el proceso corre dos veces seguidas y la segunda no cambia nada", () => {
  it("la primera corrida cancela la vencida; la segunda, con la misma hora, devuelve 0 y no reescribe la fila; la del minuto siguiente tampoco la toca", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const id = await apartar(duena.cliente, e.pedido());

    // Se revierte: la corrida del minuto siguiente cancelaría reservas ajenas que siguen vigentes.
    await enTransaccion(bd, false, async () => {
      await envejecer(id, 11);
      expect(await expirar(bd)).toBeGreaterThanOrEqual(1);
      const despuesDeLaPrimera = await fila(bd, id);
      expect(despuesDeLaPrimera).toMatchObject({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" });

      expect(await expirar(bd)).toBe(0);
      // La misma versión de la fila (ctid): la segunda corrida ni siquiera la reescribió.
      expect(await fila(bd, id)).toEqual(despuesDeLaPrimera);

      // Una corrida posterior puede cancelar otras reservas de la base compartida, pero no vuelve a tocar esta.
      const { rows } = await bd.query<{ siguiente: string }>("select (now() + interval '1 minute')::text as siguiente");
      await expirar(bd, rows[0].siguiente);
      expect(await fila(bd, id)).toEqual(despuesDeLaPrimera);
    });
  });
});

describe("el proceso programado (sección 6.3)", () => {
  it("pg_cron lo corre cada minuto con la hora de la base, y ni un visitante, ni una sesión, ni el servidor pueden ejecutarlo", async () => {
    const { rows } = await bd.query<{ schedule: string; command: string; active: boolean }>(
      "select schedule, command, active from cron.job where jobname = 'calibra-expirar-reservas'",
    );
    expect(rows).toEqual([{ schedule: "* * * * *", command: "select privado.expirar_reservas(now())", active: true }]);

    for (const rol of ["anon", "authenticated", "service_role"]) {
      await enTransaccion(bd, false, async () => {
        await bd.query(`set local role ${rol}`);
        await expect(bd.query("select privado.expirar_reservas(now())"), rol).rejects.toThrow(/permission denied/i);
      });
    }
  });
});
