import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desactivarCuenta, reactivarCuenta } from "@/lib/auth/cuentas";
import { SEMANAS_DEL_HORIZONTE, type FechaLibre } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres, cargarMaterias } from "@/lib/disponibilidad/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { cumpleAntelacion, inicioDeSesion } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { crearCliente, exigirSupabaseLocal, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-016 contra el Supabase local: lo que carga la página `/monitores` (el mismo código) con cada rol
 * que puede abrirla. Las fechas se calculan desde hoy en Bogotá, nunca con la zona del proceso.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let fx: Fixtures;
let bd: pg.Client;

beforeAll(async () => {
  await exigirSupabaseLocal();
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  await bd?.end();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

/** Día ISO (lunes 1 … domingo 7) de una fecha de calendario. */
function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

const hoy = () => diaDelNegocio(new Date());

/**
 * Una materia con un monitor certificado (con teléfono, correo y llave) y su franja semanal que cae dentro
 * de 2 días: así la antelación de 3 h nunca depende de la hora en que corre la prueba.
 */
async function escenario() {
  const admin = await fx.crearAdmin();
  const materia = await fx.crearMateria("Cálculo de prueba");
  const monitor = await fx.crearMonitor({ conContacto: true });
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({
    idMonitor: monitor.id,
    dia: diaIso(primera),
    hora: "10:00",
    presencial: true,
    precio: 32_000,
    duracionMin: 90,
    lugar: `Salón secreto ${materia.id}`,
    abiertaDesde: hoy(),
  });
  return { admin, materia, monitor, franja, primera };
}

const fechasDe = (libres: FechaLibre[], idFranja: string) => libres.filter((f) => f.idFranja === idFranja).map((f) => f.fecha);

describe("criterios 1 y 2: los certificados en la materia y sus fechas libres", () => {
  it("sin sesión, con sesión anónima, como monitor y como admin se ve lo mismo: solo el certificado en la materia", async () => {
    const { admin, materia, monitor, franja, primera } = await escenario();
    // Otro monitor con franja pero certificado en otra materia, y uno sin certificado: no salen.
    const otraMateria = await fx.crearMateria();
    const deOtraMateria = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: deOtraMateria.id, idMateria: otraMateria.id, idAdmin: admin.id });
    await fx.crearFranja({ idMonitor: deOtraMateria.id, dia: diaIso(primera), abiertaDesde: hoy() });
    const sinCertificado = await fx.crearMonitor();
    await fx.crearFranja({ idMonitor: sinCertificado.id, dia: diaIso(primera), abiertaDesde: hoy() });

    const clientes: [string, Cliente][] = [
      ["sin sesión", crearCliente()],
      ["sesión anónima", (await fx.crearAnonimo()).cliente],
      ["monitor", await fx.iniciarSesion(monitor)],
      ["admin", await fx.iniciarSesion(admin)],
    ];
    const vistas = await Promise.all(clientes.map(([, cliente]) => cargarFechasLibres(cliente, materia.codigo, SEMANAS_DEL_HORIZONTE)));

    const esperadas = [0, 7, 14, 21].map((d) => sumarDias(primera, d));
    for (const [i, [rol]] of clientes.entries()) {
      expect(vistas[i], rol).toEqual(vistas[0]);
    }
    expect(vistas[0].map((f) => f.idMonitor)).toEqual(esperadas.map(() => monitor.id));
    expect(vistas[0]).toEqual(
      esperadas.map((fecha) => ({
        idMonitor: monitor.id,
        nombreMonitor: "Monitor de prueba",
        idFranja: franja.id,
        fecha,
        hora: "10:00:00",
        duracionMin: 90,
        presencial: true,
        precio: 32_000,
      })),
    );
  });

  it("RN-33: una monitoría confirmada o por pagar ocupa su fecha; una cancelada la deja libre", async () => {
    const { materia, monitor, franja, primera } = await escenario();
    const lead = await fx.crearLead();
    const contexto = { materia, monitor, franja, lead };
    await fx.crearMonitoria(contexto, { fecha: sumarDias(primera, 7), estado: "confirmada" });
    await fx.crearMonitoria(contexto, { fecha: sumarDias(primera, 14), estado: "cancelada" });
    await fx.crearMonitoria(contexto, { fecha: sumarDias(primera, 21), estado: "pendiente_pago" });

    const libres = await cargarFechasLibres(crearCliente(), materia.codigo, SEMANAS_DEL_HORIZONTE);

    expect(fechasDe(libres, franja.id)).toEqual([primera, sumarDias(primera, 14)]);
  });

  it("una franja cerrada desde una fecha no da esa fecha ni las siguientes (HU-015)", async () => {
    const { materia, franja, primera } = await escenario();
    await fx.admin.from("franja").update({ cerrada_desde: sumarDias(primera, 14) }).eq("id", franja.id);

    const libres = await cargarFechasLibres(crearCliente(), materia.codigo, SEMANAS_DEL_HORIZONTE);

    expect(fechasDe(libres, franja.id)).toEqual([primera, sumarDias(primera, 7)]);
  });

  it("D-4: un monitor desactivado no aparece, y vuelve al reactivarlo", async () => {
    const { materia, monitor } = await escenario();

    await desactivarCuenta(monitor.id);
    try {
      expect(await cargarFechasLibres(crearCliente(), materia.codigo, SEMANAS_DEL_HORIZONTE)).toEqual([]);
    } finally {
      await reactivarCuenta(monitor.id);
    }
    expect(await cargarFechasLibres(crearCliente(), materia.codigo, SEMANAS_DEL_HORIZONTE)).toHaveLength(4);
  });

  it("el horizonte: 1 semana da solo la primera fecha; el código no distingue mayúsculas; uno desconocido no da nada", async () => {
    const { materia, franja, primera } = await escenario();
    const cliente = crearCliente();

    expect(fechasDe(await cargarFechasLibres(cliente, materia.codigo, 1), franja.id)).toEqual([primera]);
    expect(await cargarFechasLibres(cliente, ` ${materia.codigo.toLowerCase()} `, SEMANAS_DEL_HORIZONTE)).toHaveLength(4);
    expect(await cargarFechasLibres(cliente, "NO-EXISTE-16", SEMANAS_DEL_HORIZONTE)).toEqual([]);
    expect(await cargarFechasLibres(cliente, "INT-%", SEMANAS_DEL_HORIZONTE)).toEqual([]);
  });
});

describe("RN-35 y P-40: la antelación de 3 h, igual que el motor de plazos", () => {
  it("la fecha sale mientras falten 3 h o más para el inicio, con el borde incluido", async () => {
    const { admin, materia, franja, primera } = await escenario();
    const parametros = await cargarParametros(await fx.iniciarSesion(admin));
    const inicio = inicioDeSesion(primera, "10:00:00");
    const limite = inicio.getTime() - parametros.antelacionIndividualMin * 60_000;

    for (const desfase of [-3_600_000, -60_000, -1_000, 0, 1_000, 60_000, 3_600_000]) {
      const ahora = new Date(limite + desfase);
      const { rows } = await bd.query<{ fecha: string }>(
        "select to_char(fecha, 'YYYY-MM-DD') as fecha from privado.fechas_libres_de_materia($1, 4, $2) where id_franja = $3",
        [materia.codigo, ahora.toISOString(), franja.id],
      );
      const sale = rows.some((r) => r.fecha === primera);
      expect(sale, `con un desfase de ${desfase} ms`).toBe(cumpleAntelacion(inicio, ahora, false, parametros));
    }
  });
});

describe("criterio 4: no se exponen teléfono, correo ni llave", () => {
  it("lo que llega trae solo lo público, sin el contacto del monitor ni el lugar de la franja", async () => {
    const { materia, monitor } = await escenario();
    const { data: privado } = await fx.admin.from("monitor_privado").select("*").eq("id_monitor", monitor.id).single();

    const libres = await cargarFechasLibres(crearCliente(), materia.codigo, SEMANAS_DEL_HORIZONTE);
    const { data: crudo } = await crearCliente().rpc("fechas_libres_de_materia", { p_codigo_materia: materia.codigo, p_semanas: 4 });

    const texto = JSON.stringify([libres, crudo]);
    for (const secreto of [privado!.numero_telefono, privado!.correo, privado!.llave, `Salón secreto ${materia.id}`]) {
      expect(texto).not.toContain(secreto);
    }
    expect(Object.keys(crudo![0]).sort()).toEqual(
      ["duracion_min", "fecha", "hora", "id_franja", "id_monitor", "nombre_monitor", "precio", "presencial"].sort(),
    );
  });

  it("`p_ahora` no se alcanza por la Data API: ni con otro parámetro en la puerta ni en el esquema privado", async () => {
    const { materia } = await escenario();
    const cliente = crearCliente();
    const conAhora = await cliente.rpc("fechas_libres_de_materia", {
      p_codigo_materia: materia.codigo,
      p_semanas: 4,
      p_ahora: "2020-01-01T00:00:00Z",
    } as never);
    expect(conAhora.error).not.toBeNull();
    const privado = await cliente.schema("privado" as never).rpc("fechas_libres_de_materia" as never, {} as never);
    expect(privado.error?.code).toBe("PGRST106");
  });

  it("sin sesión sigue sin leer las monitorías ni el contacto de los monitores", async () => {
    await escenario();
    const cliente = crearCliente();
    const { error: monitorias } = await cliente.from("monitoria").select("id").limit(1);
    const { data: privados } = await cliente.from("monitor_privado").select("llave").limit(1);
    expect(monitorias?.code).toBe("42501");
    expect(privados ?? []).toEqual([]);
  });
});

describe("cargarMaterias: para elegir la materia (D-3)", () => {
  it("trae cada materia y si tiene monitores certificados", async () => {
    const { materia } = await escenario();
    const vacia = await fx.crearMateria("Materia sin monitores");

    const materias = await cargarMaterias(crearCliente());

    expect(materias).toContainEqual({ nombre: "Cálculo de prueba", codigo: materia.codigo, conCertificados: true });
    expect(materias).toContainEqual({ nombre: "Materia sin monitores", codigo: vacia.codigo, conCertificados: false });
  });
});
