import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarEquipo, desactivarAdmin } from "@/lib/admin/equipo";
import { siguienteActivo } from "@/lib/admin/equipo-reglas";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria } from "@/lib/agendar/servidor";
import { desactivarCuenta } from "@/lib/auth/cuentas";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { validarPagador } from "@/lib/pagos/reglas";
import { registrarPago } from "@/lib/pagos/servidor";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-074 contra el Supabase local: los pagos en revisión de un admin que se desactiva pasan al siguiente admin activo.
 *
 * Los criterios 1 y 2 van por la ruta de `/admin/equipo` (`cargarEquipo` y `desactivarAdmin`, que llama a
 * `desactivarCuenta()`) con la sesión de verdad de otro admin, como `equipo.test.ts`. La base local puede tener otros
 * admins: quién recibe se calcula con el equipo que ve el admin, igual que la pantalla.
 *
 * El criterio 3 (un pago que se crea mientras se desactiva su admin) se prueba con dos conexiones `pg` a la vez, como
 * `expirar.test.ts`: R es la sesión del Lead que paga (`privado.registrar_pago` con su token) y D es la reasignación
 * (`public.reasignar_casos_de_admin` como service_role, lo que hace `desactivarCuenta()`). La reserva se aparta y el
 * comprobante se sube y se revisa de verdad, como en `pagos.test.ts`. `registrar_pago` elige siempre al PRIMER admin
 * activo (RN-42), así que el admin que se desactiva se pone primero en el orden, por debajo de la semilla, y se borra
 * con su usuario al final. Los archivos de integración no corren en paralelo (`vitest.integracion.config.mts`): nadie
 * más paga mientras tanto.
 *
 * El Auth local deja crear 150 sesiones anónimas por hora y el resto de la suite ya usa muchas: este archivo crea dos,
 * una sola vez, y cada prueba les pone su Lead.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const HORA = 60 * 60_000;
const PRECIO = 32_000;

// La firma mínima de un PNG: la revisión del servidor mira los primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

// Lo que escribe la persona; la acción lo normaliza con validarPagador antes de pagar.
const PAGADOR = validarPagador({ nombre: "Ana Pérez", correo: "ana.perez@uniandes.edu.co" });

/** Lo mismo que `desactivarCuenta()`: 100 años. */
const PARA_SIEMPRE = "876000h";

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

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
  // Un pago impide borrar su monitoría y su admin (llaves foráneas sin cascada).
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
 * antelación ni el aviso de las 12 h dependen de la hora en que corre la prueba.
 */
async function escenario() {
  const certificador = await fx.crearAdmin();
  const materia = await fx.crearMateria();
  const monitor = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: certificador.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", precio: PRECIO, abiertaDesde: hoy() });
  const pedido = (): PedidoDeAgendar => ({ idFranja: franja.id, fecha: primera, codigoMateria: materia.codigo });
  return { pedido };
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

/** Los pagos de una monitoría (con la llave secreta), anotados para la limpieza aunque una regresión cree de más. */
async function pagosDe(idMonitoria: string) {
  const filas = exito(await fx.admin.from("pago").select("*").eq("id_monitoria", idMonitoria), "leer los pagos");
  for (const fila of filas) fx.registrarPago(fila.id);
  return filas;
}

/** La hora de la base (la que usa la reasignación), no la del proceso. */
async function relojDeLaBase(): Promise<number> {
  const { rows } = await bd.query<{ ahora: Date }>("select clock_timestamp() as ahora");
  return rows[0].ahora.getTime();
}

/** El turno de la base (HU-054): el activo que sigue a `idAdmin` o, sin él, el primero activo, al que registrar_pago le da el pago. */
async function turno(idAdmin: string | null = null): Promise<string | null> {
  const { rows } = await bd.query<{ id: string | null }>("select privado.siguiente_admin_activo($1::uuid) as id", [idAdmin]);
  return rows[0].id;
}

async function activo(idAdmin: string): Promise<boolean> {
  const { rows } = await bd.query<{ activo: boolean }>("select privado.admin_activo($1) as activo", [idAdmin]);
  return rows[0].activo;
}

/**
 * El admin que se va a desactivar en el criterio 3, primero en el turno: por debajo de la semilla (1 y 2) y de
 * cualquier otro admin de la base. Su fila se va en cascada con su usuario en la limpieza, después de sus pagos.
 */
async function adminPrimero() {
  const admin = await fx.crearAdmin();
  const { rows } = await bd.query<{ orden: number }>("select min(orden_revision) - 1 as orden from public.admin");
  exito(await fx.admin.from("admin").update({ orden_revision: rows[0].orden }).eq("id", admin.id).select().single(), "poner al admin primero");
  expect(await turno(), "el admin de la prueba es el primero activo").toBe(admin.id);
  return admin;
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`, como postgres (o con el rol y el token de una sesión)

/**
 * Dentro de una transacción de `cliente`: lo que sigue corre con el token de la sesión anónima del Lead. El rol sigue
 * siendo postgres: la versión de `registrar_pago` que recibe la hora es interna (revisión de HU-018) y `auth.uid()` lee
 * el token sin importar el rol.
 */
async function comoLead(cliente: pg.Client, idSesion: string) {
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idSesion, role: "authenticated", is_anonymous: true })]);
}

/** R: `privado.registrar_pago` (HU-018) con la hora de la transacción, desde una conexión que ya corre como el Lead. */
async function registrarEn(cliente: pg.Client, idMonitoria: string, ruta: string) {
  if (!PAGADOR.ok) throw new Error(PAGADOR.mensaje);
  const { rows } = await cliente.query<{ resultado: string; id_pago: string | null }>(
    "select resultado, id_pago from privado.registrar_pago($1, $2, $3, $4)",
    [idMonitoria, ruta, PAGADOR.nombre, PAGADOR.correo],
  );
  return rows[0];
}

/** D: lo que llama `desactivarCuenta()`, la puerta pública como service_role, dentro de la transacción de `cliente`. */
async function reasignarEn(cliente: pg.Client, idAdmin: string): Promise<number> {
  await cliente.query("set local role service_role");
  const { rows } = await cliente.query<{ movidos: number }>("select public.reasignar_casos_de_admin($1) as movidos", [idAdmin]);
  await cliente.query("reset role");
  return rows[0].movidos;
}

/** El admin de un pago como lo ve `cliente` (dentro de su transacción). */
async function adminDelPago(cliente: pg.Client, idPago: string): Promise<string> {
  const { rows } = await cliente.query<{ id_admin: string }>("select id_admin from public.pago where id = $1", [idPago]);
  return rows[0].id_admin;
}

/** Una conexión propia para una de las partes de la carrera, con su número de proceso en la base. */
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

/**
 * Espera a que alguna conexión quede bloqueada por la conexión `porPid` (pg_blocking_pids). Con `pid`, esa en
 * particular; sin él, cualquiera (la de GoTrue, cuyo número no se conoce).
 */
async function esperarBloqueo(pid: number | null, porPid: number, consulta: { terminada: boolean }) {
  const hasta = Date.now() + ESPERA_MAXIMA;
  while (Date.now() < hasta) {
    if (consulta.terminada) throw new Error(`La consulta terminó sin esperar a la conexión ${porPid}.`);
    const { rows } = await bd.query<{ bloqueada: boolean }>(
      "select exists (select 1 from pg_stat_activity a where ($1::integer is null or a.pid = $1) and $2::integer = any(pg_blocking_pids(a.pid))) as bloqueada",
      [pid, porPid],
    );
    if (rows[0].bloqueada) return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error(`Ninguna conexión${pid ? ` (${pid})` : ""} quedó esperando a la conexión ${porPid} en ${ESPERA_MAXIMA} ms.`);
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 1 y 2: los pagos en revisión de un admin cuentan como casos abiertos y pasan cuando se desactiva", () => {
  it("su único caso abierto es un pago en revisión: el equipo lo cuenta; al desactivarlo pasa al siguiente activo con una hora nueva y aparece en su bandeja; el aprobado y el rechazado se quedan", async () => {
    // A: el que se desactiva. B: quien desactiva y certificó al monitor.
    const a = await fx.crearAdmin();
    const b = await fx.crearAdmin();
    const sesionB = await fx.iniciarSesion(b);
    const contexto = await fx.crearContextoDeMonitoria(b.id);
    // Lunes, el día de la franja: una monitoría por fecha.
    const [m1, m2, m3] = [
      await fx.crearMonitoria(contexto, { fecha: "2030-01-07" }),
      await fx.crearMonitoria(contexto, { fecha: "2030-01-14" }),
      await fx.crearMonitoria(contexto, { fecha: "2030-01-21" }),
    ];
    // Asignado hace 3 horas: con A ya estaba vencido (RN-42).
    const enRevision = await fx.crearPagoDe(m1.id, { idAdmin: a.id, fechaAsignacion: new Date(Date.now() - 3 * HORA).toISOString() });
    const aprobado = await fx.crearPagoDe(m2.id, { idAdmin: a.id, estado: "aprobado" });
    const rechazado = await fx.crearPagoDe(m3.id, { idAdmin: a.id, estado: "rechazado" });

    // Criterio 2: el pago en revisión cuenta; los revisados no.
    const equipoAntes = await cargarEquipo(sesionB);
    expect(equipoAntes.find((m) => m.id === a.id)).toMatchObject({ activo: true, casosAbiertos: 1 });
    const recibe = siguienteActivo(equipoAntes, a.id);
    expect(recibe, "debía haber otro admin activo").not.toBeNull();

    const antes = await relojDeLaBase();
    const resultado = await desactivarAdmin(sesionB, b.id, a.id);
    const despues = await relojDeLaBase();
    // Como el pago cuenta, la pantalla dice a quién pasó.
    expect(resultado).toEqual({ ok: true, nombre: "Admin de prueba", recibe: recibe!.nombre });

    // Criterio 1: pasa al siguiente activo, sigue en revisión y empieza una hora nueva; cuándo llegó no cambia.
    const pago = exito(await fx.admin.from("pago").select("*").eq("id", enRevision.id).single(), "leer el pago");
    expect(pago).toMatchObject({ id_admin: recibe!.id, estado: "en_revision" });
    expect(new Date(pago.fecha_pago).getTime()).toBe(new Date(enRevision.fecha_pago).getTime());
    const asignacion = new Date(pago.fecha_asignacion).getTime();
    expect(asignacion).toBeGreaterThanOrEqual(antes);
    expect(asignacion).toBeLessThanOrEqual(despues);

    // Quien lo recibe lo ve en su bandeja, ya no vencido.
    const bandeja = await cargarBandeja(fx.admin, recibe!.id, new Date());
    expect(bandeja.pagos.find((p) => p.id === enRevision.id)).toMatchObject({ restante: { vencido: false } });

    // RN-23: los revisados se quedan con A.
    const deA = exito(await fx.admin.from("pago").select("id").eq("id_admin", a.id), "leer los pagos de A");
    expect(deA.map((p) => p.id).sort()).toEqual([aprobado.id, rechazado.id].sort());

    const equipoDespues = await cargarEquipo(sesionB);
    expect(equipoDespues.find((m) => m.id === a.id)).toMatchObject({ activo: false, casosAbiertos: 0 });
  });
});

describe("criterio 3: un pago que se crea mientras se desactiva su admin queda con un admin activo", () => {
  it(
    "el pago ya eligió a A y no ha confirmado: la reasignación espera el candado del turno y, cuando el pago confirma, lo mueve",
    async () => {
      const e = await escenario();
      const a = await adminPrimero();
      const lead = await sesionLead();
      const id = await apartar(lead.cliente, e.pedido());
      const ruta = await comprobanteRevisado(lead.cliente, lead.id);
      const destino = await turno(a.id);

      const r = await conexion();
      const d = await conexion();
      try {
        await r.cliente.query("begin");
        await comoLead(r.cliente, lead.id);
        const pago = await registrarEn(r.cliente, id, ruta);
        expect(pago).toEqual({ resultado: "registrado", id_pago: expect.any(String) });
        fx.registrarPago(pago.id_pago!);
        expect(await adminDelPago(r.cliente, pago.id_pago!), "el pago eligió a A").toBe(a.id);

        await d.cliente.query("begin");
        const reasignacion = enCurso(reasignarEn(d.cliente, a.id));
        await esperarBloqueo(d.pid, r.pid, reasignacion);

        await r.cliente.query("commit");
        // D miró después de que R confirmara: el pago ya existía y era su único caso.
        expect(await reasignacion.promesa).toBe(1);
        await d.cliente.query("commit");
      } finally {
        await cerrar(r, d);
      }

      const pagos = await pagosDe(id);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ id_admin: destino, estado: "en_revision" });
      expect(await activo(pagos[0].id_admin)).toBe(true);
      // La hora nueva es la de D, que empezó después de que R eligiera.
      expect(new Date(pagos[0].fecha_asignacion).getTime()).toBeGreaterThan(new Date(pagos[0].fecha_pago).getTime());
    },
    60_000,
  );

  it(
    "la reasignación tiene el candado: el pago espera y, cuando la reasignación confirma, elige a A (aún sin banear); el baneo y la segunda reasignación lo mueven",
    async () => {
      const e = await escenario();
      const a = await adminPrimero();
      const lead = await sesionLead();
      const id = await apartar(lead.cliente, e.pedido());
      const ruta = await comprobanteRevisado(lead.cliente, lead.id);
      const destino = await turno(a.id);

      const r = await conexion();
      const d = await conexion();
      try {
        // La primera reasignación de desactivarCuenta: A no tiene casos, pero el candado queda tomado hasta confirmar.
        await d.cliente.query("begin");
        expect(await reasignarEn(d.cliente, a.id)).toBe(0);

        await r.cliente.query("begin");
        await comoLead(r.cliente, lead.id);
        const registro = enCurso(registrarEn(r.cliente, id, ruta));
        await esperarBloqueo(r.pid, d.pid, registro);

        await d.cliente.query("commit");
        const pago = await registro.promesa;
        expect(pago).toEqual({ resultado: "registrado", id_pago: expect.any(String) });
        fx.registrarPago(pago.id_pago!);
        await r.cliente.query("commit");
      } finally {
        await cerrar(r, d);
      }

      // Todavía no hay baneo: A sigue activo y es el primero, así que el pago es suyo.
      expect((await pagosDe(id)).map((p) => p.id_admin)).toEqual([a.id]);

      // Lo que sigue en desactivarCuenta: el baneo en Auth y la segunda reasignación.
      const { error } = await fx.admin.auth.admin.updateUserById(a.id, { ban_duration: PARA_SIEMPRE });
      if (error) throw error;
      expect(exito(await fx.admin.rpc("reasignar_casos_de_admin", { p_id_admin: a.id }), "la segunda reasignación")).toBe(1);

      const pagos = await pagosDe(id);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ id_admin: destino, estado: "en_revision" });
      expect(await activo(pagos[0].id_admin)).toBe(true);
      expect(await activo(a.id)).toBe(false);
    },
    60_000,
  );

  it(
    "la ventana entera por la ruta de la app: un pago que elige a A entre la primera reasignación y el baneo pasa en la segunda; A queda desactivado y sin casos",
    async () => {
      const e = await escenario();
      const a = await adminPrimero();
      const lead = await sesionLead();
      const id = await apartar(lead.cliente, e.pedido());
      const ruta = await comprobanteRevisado(lead.cliente, lead.id);
      const destino = await turno(a.id);

      // El baneo es un UPDATE de GoTrue sobre auth.users. Con la fila de A bloqueada por `freno`, desactivarCuenta() se
      // detiene justo después de la primera reasignación, ya confirmada, con A todavía activo: es la ventana.
      const freno = await conexion();
      let desactivacion: { terminada: boolean; promesa: Promise<void> } | null = null;
      try {
        await freno.cliente.query("begin");
        await freno.cliente.query("select 1 from auth.users where id = $1 for update", [a.id]);
        desactivacion = enCurso(desactivarCuenta(a.id));
        await esperarBloqueo(null, freno.pid, desactivacion);

        // En la ventana, el Lead paga por la misma ruta que la acción `pagar`, y el pago elige a A.
        expect(await activo(a.id)).toBe(true);
        if (!PAGADOR.ok) throw new Error(PAGADOR.mensaje);
        const registro = await registrarPago(lead.cliente, { idMonitoria: id, ruta, nombre: PAGADOR.nombre, correo: PAGADOR.correo });
        expect(registro).toEqual({ resultado: "registrado", idPago: expect.any(String) });
        expect((await pagosDe(id)).map((p) => p.id_admin)).toEqual([a.id]);

        // Se suelta el baneo: desactivarCuenta() banea a A y reasigna otra vez.
        await freno.cliente.query("rollback");
        await desactivacion.promesa;
      } finally {
        await cerrar(freno);
        await desactivacion?.promesa.catch(() => undefined);
      }

      const pagos = await pagosDe(id);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ id_admin: destino, estado: "en_revision" });
      expect(await activo(pagos[0].id_admin)).toBe(true);
      expect(await activo(a.id)).toBe(false);
    },
    60_000,
  );
});
