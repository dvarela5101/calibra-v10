import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  calcularComision,
  calcularMontoNeto,
  cancelableHasta,
  cumpleAntelacion,
  dentroDePlazo,
  derivadosDeMonitoria,
  desembolsableDesde,
  diaIsoDeFecha,
  fechaLimiteDiferencia,
  fechaLimitePago,
  finProgramado,
  inicioDeSesion,
  plazoAlcanzado,
  reporteInasistenciaHasta,
  reservaHasta,
  revisionHasta,
  ventanaResenaHasta,
} from "@/lib/plazos/motor";
import { cargarParametros, comoParametros, type ParametrosNegocio } from "@/lib/plazos/parametros";
import { PARAMETROS_DEL_DOCUMENTO } from "../pruebas/plazos-referencia";
import { crearCliente, exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-003, criterio 6: los procesos de la base y las pantallas usan las mismas fórmulas.
// La base (funciones SQL) es la fuente de verdad; src/lib/plazos/motor.ts es su gemelo para
// las pantallas. Aquí se comparan las dos implementaciones con casos de borde y aleatorios.
// Solo corren contra el Supabase LOCAL.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

let bd: pg.Client;
let parametros: ParametrosNegocio;

beforeAll(async () => {
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) {
    throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}): estas pruebas solo corren contra la base local.`);
  }
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  const { rows } = await bd.query("select * from public.parametros_negocio()");
  parametros = comoParametros(rows[0]);
});

afterAll(async () => {
  await bd.end();
});

/** Generador pseudoaleatorio con semilla: si una comparación falla, se reproduce igual. */
function generador(semilla: number) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const instantes = (n: number, semilla: number): Date[] => {
  const azar = generador(semilla);
  // Entre 2024 y 2033, con milisegundos.
  const desde = Date.UTC(2024, 0, 1);
  const hasta = Date.UTC(2033, 11, 31);
  return Array.from({ length: n }, () => new Date(desde + Math.floor(azar() * (hasta - desde))));
};

const tiempos = (filas: { [columna: string]: unknown }[], columna: string) =>
  filas.map((fila) => (fila[columna] as Date | null)?.getTime() ?? null);

describe("parámetros: un solo lugar", () => {
  it("la base devuelve exactamente la tabla 6.1 del documento y la comisión de RN-81", () => {
    expect(parametros).toEqual(PARAMETROS_DEL_DOCUMENTO);
  });
});

describe("inicio de la sesión (RN-36)", () => {
  it("SQL y TypeScript dan el mismo instante para fechas y horas de borde y aleatorias", async () => {
    const fechas = [
      "2026-01-01", "2026-02-28", "2026-03-01", "2026-09-28", "2026-10-05", "2026-10-31", "2026-12-31",
      "2027-01-01", "2028-02-28", "2028-02-29", "2028-03-01", "2028-12-31", "2032-02-29", "2100-01-01",
    ];
    const horas = ["00:00", "00:00:01", "04:59:59", "05:00", "09:30", "12:00", "17:45:30", "19:00", "23:59", "23:59:59"];
    const casos: [string, string][] = fechas.flatMap((fecha) => horas.map((hora): [string, string] => [fecha, hora]));

    const azar = generador(20260929);
    for (let i = 0; i < 400; i++) {
      const dia = new Date(Date.UTC(2024, 0, 1) + Math.floor(azar() * 3650) * 24 * HORA);
      const dosDigitos = (n: number) => String(n).padStart(2, "0");
      casos.push([
        dia.toISOString().slice(0, 10),
        `${dosDigitos(Math.floor(azar() * 24))}:${dosDigitos(Math.floor(azar() * 60))}:${dosDigitos(Math.floor(azar() * 60))}`,
      ]);
    }

    const { rows } = await bd.query(
      "select public.inicio_sesion(f::date, h::time) as inicio from unnest($1::text[], $2::text[]) with ordinality as x(f, h, i) order by i",
      [casos.map(([fecha]) => fecha), casos.map(([, hora]) => hora)],
    );
    expect(rows).toHaveLength(casos.length);
    casos.forEach(([fecha, hora], i) => {
      expect(inicioDeSesion(fecha, hora).getTime(), `${fecha} ${hora}`).toBe((rows[i].inicio as Date).getTime());
    });
  });

  it("el día ISO de TypeScript coincide con el de Postgres (lo que valida el trigger de monitoria)", async () => {
    const dias = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 24 * HORA).toISOString().slice(0, 10));
    const { rows } = await bd.query(
      "select extract(isodow from f::date)::int as dia from unnest($1::text[]) with ordinality as x(f, i) order by i",
      [dias],
    );
    dias.forEach((fecha, i) => expect(diaIsoDeFecha(fecha), fecha).toBe(rows[i].dia));
  });

  it("fin programado: inicio más duración, igual en ambas", async () => {
    const inicios = instantes(300, 1);
    const azar = generador(2);
    const duraciones = inicios.map(() => 15 + Math.floor(azar() * 240));
    const { rows } = await bd.query(
      "select public.fin_programado(t, d) as fin from unnest($1::timestamptz[], $2::int[]) with ordinality as x(t, d, i) order by i",
      [inicios.map((i) => i.toISOString()), duraciones],
    );
    inicios.forEach((inicio, i) => expect(finProgramado(inicio, duraciones[i]).getTime()).toBe((rows[i].fin as Date).getTime()));
  });
});

describe("plazos derivados (sección 6.1)", () => {
  it("cada plazo da el mismo instante en SQL y en TypeScript", async () => {
    const base = instantes(400, 3);
    const { rows } = await bd.query(
      `select
         public.reserva_hasta(t) as reserva, public.revision_hasta(t) as revision,
         public.cancelable_hasta(t, false) as cancel_individual, public.cancelable_hasta(t, true) as cancel_grupal,
         public.fecha_limite_pago(t) as limite_pago, public.fecha_limite_diferencia(t) as limite_diferencia,
         public.reporte_inasistencia_hasta(t) as reporte, public.ventana_resena_hasta(t) as resena,
         public.desembolsable_desde(t) as desembolso
       from unnest($1::timestamptz[]) with ordinality as x(t, i) order by i`,
      [base.map((instante) => instante.toISOString())],
    );
    const esperado = (f: (instante: Date) => Date) => base.map((instante) => f(instante).getTime());
    expect(tiempos(rows, "reserva")).toEqual(esperado((t) => reservaHasta(t, parametros)));
    expect(tiempos(rows, "revision")).toEqual(esperado((t) => revisionHasta(t, parametros)));
    expect(tiempos(rows, "cancel_individual")).toEqual(esperado((t) => cancelableHasta(t, false, parametros)));
    expect(tiempos(rows, "cancel_grupal")).toEqual(esperado((t) => cancelableHasta(t, true, parametros)));
    expect(tiempos(rows, "limite_pago")).toEqual(esperado((t) => fechaLimitePago(t, parametros)));
    expect(tiempos(rows, "limite_diferencia")).toEqual(esperado((t) => fechaLimiteDiferencia(t, parametros)));
    expect(tiempos(rows, "reporte")).toEqual(esperado((t) => reporteInasistenciaHasta(t, parametros)));
    expect(tiempos(rows, "resena")).toEqual(esperado((t) => ventanaResenaHasta(t, parametros)));
    expect(tiempos(rows, "desembolso")).toEqual(esperado((t) => desembolsableDesde(t, parametros)));
  });

  it("los bordes inclusivos dan lo mismo en ambas: un minuto antes, exacto, un minuto después y desfases al azar", async () => {
    const azar = generador(4);
    const inicios = instantes(120, 5);
    const desfases = [-HORA, -MINUTO, -1000, -1, 0, 1, 1000, MINUTO, HORA];
    // Desfases al azar de hasta ±2 días, además de los de borde.
    const todos = [...desfases, ...Array.from({ length: 6 }, () => Math.floor((azar() - 0.5) * 4 * 24 * HORA))];

    const casos: { limite: Date; ahora: Date; inicio: Date; grupal: boolean }[] = [];
    for (const inicio of inicios) {
      for (const grupal of [false, true]) {
        for (const plazo of [
          cancelableHasta(inicio, grupal, parametros),
          fechaLimitePago(inicio, parametros),
          fechaLimiteDiferencia(inicio, parametros),
          reservaHasta(inicio, parametros),
          desembolsableDesde(inicio, parametros),
        ]) {
          for (const desfase of todos) casos.push({ limite: plazo, ahora: new Date(plazo.getTime() + desfase), inicio, grupal });
        }
        // Antelación: `ahora` alrededor de inicio - 3 h y de inicio - 36 h.
        for (const desfase of todos) {
          const borde = inicio.getTime() - (grupal ? parametros.antelacionGrupalMin : parametros.antelacionIndividualMin) * MINUTO;
          casos.push({ limite: new Date(borde), ahora: new Date(borde + desfase), inicio, grupal });
        }
      }
    }

    const { rows } = await bd.query(
      `select public.dentro_de_plazo(l, a) as dentro, public.plazo_alcanzado(l, a) as alcanzado,
              public.cumple_antelacion(i, a, g) as antelacion
       from unnest($1::timestamptz[], $2::timestamptz[], $3::timestamptz[], $4::boolean[]) with ordinality as x(l, a, i, g, n)
       order by n`,
      [
        casos.map((c) => c.limite.toISOString()),
        casos.map((c) => c.ahora.toISOString()),
        casos.map((c) => c.inicio.toISOString()),
        casos.map((c) => c.grupal),
      ],
    );
    expect(rows).toHaveLength(casos.length);
    casos.forEach((c, i) => {
      const contexto = `limite=${c.limite.toISOString()} ahora=${c.ahora.toISOString()}`;
      expect(dentroDePlazo(c.limite, c.ahora), `dentro ${contexto}`).toBe(rows[i].dentro);
      expect(plazoAlcanzado(c.limite, c.ahora), `alcanzado ${contexto}`).toBe(rows[i].alcanzado);
      expect(cumpleAntelacion(c.inicio, c.ahora, c.grupal, parametros), `antelación ${contexto}`).toBe(rows[i].antelacion);
    });
  });
});

describe("comisión de la plataforma (RN-81)", () => {
  it("comisión y neto coinciden para todos los brutos de 0 a 3000, los bordes del tope y valores al azar", async () => {
    const azar = generador(6);
    const brutos = [
      ...Array.from({ length: 3001 }, (_, i) => i),
      149_985, 149_990, 149_994, 149_995, 149_999, 150_000, 150_001, 150_005, 150_010, 2_000_000,
      ...Array.from({ length: 2000 }, () => Math.floor(azar() * 5_000_000)),
    ];
    const { rows } = await bd.query(
      "select public.comision(b) as comision, public.monto_neto(b) as neto from unnest($1::int[]) with ordinality as x(b, i) order by i",
      [brutos],
    );
    brutos.forEach((bruto, i) => {
      expect(calcularComision(bruto, parametros), `comisión de ${bruto}`).toBe(rows[i].comision);
      expect(calcularMontoNeto(bruto, parametros), `neto de ${bruto}`).toBe(rows[i].neto);
    });
  });

  it("los ejemplos del documento: 25.000, 100.000, 150.000 y 200.000", async () => {
    const { rows } = await bd.query("select b, public.comision(b) as c, public.monto_neto(b) as n from unnest($1::int[]) as b", [
      [25_000, 100_000, 150_000, 200_000],
    ]);
    expect(rows.map((f) => [f.b, f.c, f.n])).toEqual([
      [25_000, 2_500, 22_500],
      [100_000, 10_000, 90_000],
      [150_000, 15_000, 135_000],
      [200_000, 15_000, 185_000],
    ]);
  });

  it("ambas rechazan un bruto negativo", async () => {
    await expect(bd.query("select public.comision(-1)")).rejects.toMatchObject({ code: "22023" });
    expect(() => calcularComision(-1, parametros)).toThrow(RangeError);
  });
});

describe("atributos derivados de una monitoría: la vista monitoria_plazos frente a derivadosDeMonitoria", () => {
  it("dan los mismos valores para individuales y grupales, con o sin finalizar, cruzando la medianoche", async () => {
    await bd.query("begin");
    try {
      const idAdmin = randomUUID();
      const idMonitor = randomUUID();
      const idMateria = randomUUID();
      const idLead = randomUUID();
      await bd.query("insert into auth.users (id, is_anonymous) values ($1, false), ($2, false)", [idAdmin, idMonitor]);
      await bd.query("insert into public.materia (id, nombre, codigo) values ($1, 'Materia de plazos', $2)", [idMateria, `PLZ-${randomUUID().slice(0, 12)}`]);
      await bd.query("insert into public.admin (id, nombre, correo, orden_revision) values ($1, 'Admin', 'admin@calibra.test', $2)", [idAdmin, randomInt(1_000_000, 2_000_000_000)]);
      await bd.query("insert into public.monitor (id, nombre) values ($1, 'Monitor')", [idMonitor]);
      await bd.query("insert into public.certificado (id_monitor, id_materia, id_admin) values ($1, $2, $3)", [idMonitor, idMateria, idAdmin]);
      await bd.query(
        "insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values ($1, 'Lead', 'lead@calibra.test', true, now())",
        [idLead],
      );

      // Franjas: hora y duración variadas, incluida una que cruza la medianoche y una del domingo a las 00:00.
      const definiciones = [
        { hora: "10:00", duracionMin: 60, fecha: "2026-10-05" },
        { hora: "10:00", duracionMin: 90, fecha: "2026-10-12" },
        { hora: "23:30", duracionMin: 90, fecha: "2026-10-07" },
        { hora: "00:00", duracionMin: 45, fecha: "2026-10-11" },
        { hora: "19:15:30", duracionMin: 120, fecha: "2028-02-29" },
        { hora: "05:00", duracionMin: 30, fecha: "2026-12-31" },
      ];
      const esperados = new Map<string, ReturnType<typeof derivadosDeMonitoria>>();
      const creacion = new Date("2026-10-01T14:00:00.000Z");
      const finalizacion = new Date("2026-10-15T22:37:11.000Z");

      for (const definicion of definiciones) {
        const dia = diaIsoDeFecha(definicion.fecha);
        const { rows: franja } = await bd.query(
          "insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min) values ($1, $2, $3, true, 25000, $4) returning id",
          [idMonitor, dia, definicion.hora, definicion.duracionMin],
        );
        // Cada franja se prueba como individual sin finalizar, y como grupal sin finalizar y finalizada.
        const variantes = [
          { esGrupal: false, finalizada: false, fecha: definicion.fecha },
          { esGrupal: true, finalizada: false, fecha: nuevaFecha(definicion.fecha, 7) },
          { esGrupal: true, finalizada: true, fecha: nuevaFecha(definicion.fecha, 14) },
        ];
        for (const variante of variantes) {
          const { rows: monitoria } = await bd.query(
            `insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total, fecha_creacion, estado, fecha_finalizacion)
             values ($1, $2, $3, $4, 25000, $5, $6, $7) returning id`,
            [
              franja[0].id,
              idMateria,
              idLead,
              variante.fecha,
              creacion.toISOString(),
              variante.finalizada ? "realizada" : "confirmada",
              variante.finalizada ? finalizacion.toISOString() : null,
            ],
          );
          if (variante.esGrupal) {
            await bd.query(
              "insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values ($1, 3, 'dividido', 20000)",
              [monitoria[0].id],
            );
          }
          esperados.set(
            monitoria[0].id,
            derivadosDeMonitoria(
              {
                franja: { dia: diaIsoDeFecha(variante.fecha), hora: definicion.hora, duracionMin: definicion.duracionMin },
                fecha: variante.fecha,
                fechaCreacion: creacion,
                esGrupal: variante.esGrupal,
                fechaFinalizacion: variante.finalizada ? finalizacion : null,
              },
              parametros,
            ),
          );
        }
      }

      const { rows } = await bd.query(
        "select * from public.monitoria_plazos where id_monitoria = any($1::uuid[])",
        [[...esperados.keys()]],
      );
      expect(rows).toHaveLength(esperados.size);
      for (const fila of rows) {
        const e = esperados.get(fila.id_monitoria)!;
        const ms = (fecha: Date | null) => fecha?.getTime() ?? null;
        expect(
          {
            inicio: ms(fila.inicio),
            fin: ms(fila.fin_programado),
            reserva: ms(fila.reserva_hasta),
            cancelable: ms(fila.cancelable_hasta),
            pago: ms(fila.fecha_limite_pago),
            diferencia: ms(fila.fecha_limite_diferencia),
            reporte: ms(fila.reporte_inasistencia_hasta),
            resena: ms(fila.ventana_resena_hasta),
            desembolso: ms(fila.desembolsable_desde),
          },
          `monitoria ${fila.id_monitoria} (grupal: ${fila.es_grupal})`,
        ).toEqual({
          inicio: ms(e.inicio),
          fin: ms(e.finProgramado),
          reserva: ms(e.reservaHasta),
          cancelable: ms(e.cancelableHasta),
          pago: ms(e.fechaLimitePago),
          diferencia: ms(e.fechaLimiteDiferencia),
          reporte: ms(e.reporteInasistenciaHasta),
          resena: ms(e.ventanaResenaHasta),
          desembolso: ms(e.desembolsableDesde),
        });
      }
    } finally {
      await bd.query("rollback");
    }
  });

  it("la base y TypeScript rechazan una fecha que no cae en el día de la franja", async () => {
    await bd.query("begin");
    try {
      const idAdmin = randomUUID();
      const idMonitor = randomUUID();
      const idMateria = randomUUID();
      const idLead = randomUUID();
      await bd.query("insert into auth.users (id, is_anonymous) values ($1, false), ($2, false)", [idAdmin, idMonitor]);
      await bd.query("insert into public.materia (id, nombre, codigo) values ($1, 'Materia', $2)", [idMateria, `PLZ-${randomUUID().slice(0, 12)}`]);
      await bd.query("insert into public.admin (id, nombre, correo, orden_revision) values ($1, 'Admin', 'a@calibra.test', $2)", [idAdmin, randomInt(1_000_000, 2_000_000_000)]);
      await bd.query("insert into public.monitor (id, nombre) values ($1, 'Monitor')", [idMonitor]);
      await bd.query("insert into public.certificado (id_monitor, id_materia, id_admin) values ($1, $2, $3)", [idMonitor, idMateria, idAdmin]);
      await bd.query("insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values ($1, 'L', 'l@calibra.test', true, now())", [idLead]);
      const { rows: franja } = await bd.query(
        "insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min) values ($1, 1, '10:00', true, 25000, 60) returning id",
        [idMonitor],
      );
      // 2026-10-06 es martes; la franja es de los lunes.
      await bd.query("savepoint dia_incorrecto");
      await expect(
        bd.query(
          "insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total) values ($1, $2, $3, '2026-10-06', 25000)",
          [franja[0].id, idMateria, idLead],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await bd.query("rollback to savepoint dia_incorrecto");
      expect(() =>
        derivadosDeMonitoria(
          {
            franja: { dia: 1, hora: "10:00", duracionMin: 60 },
            fecha: "2026-10-06",
            fechaCreacion: new Date(),
            esGrupal: false,
            fechaFinalizacion: null,
          },
          parametros,
        ),
      ).toThrow(RangeError);
    } finally {
      await bd.query("rollback");
    }
  });
});

/** Suma días a una fecha AAAA-MM-DD, sin depender de la zona del proceso. */
function nuevaFecha(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 24 * HORA).toISOString().slice(0, 10);
}

describe("expuestas a la app por la Data API", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    await exigirSupabaseLocal();
  });

  beforeEach(() => {
    fx = new Fixtures();
  });

  it("una sesión anónima lee los parámetros y llama a las funciones por RPC", async () => {
    try {
      const { cliente } = await fx.crearAnonimo();
      await expect(cargarParametros(cliente)).resolves.toEqual(PARAMETROS_DEL_DOCUMENTO);

      const comision = await cliente.rpc("comision", { p_monto_bruto: 25_000 });
      expect(comision.error).toBeNull();
      expect(comision.data).toBe(2_500);

      const neto = await cliente.rpc("monto_neto", { p_monto_bruto: 25_000 });
      expect(neto.data).toBe(22_500);

      const inicio = await cliente.rpc("inicio_sesion", { p_fecha: "2026-10-05", p_hora: "10:00" });
      expect(new Date(inicio.data as string).toISOString()).toBe("2026-10-05T15:00:00.000Z");

      // La vista respeta las políticas: una sesión anónima sin monitorías no ve ninguna fila.
      const vista = await cliente.from("monitoria_plazos").select("id_monitoria");
      expect(vista.error).toBeNull();
      expect(vista.data).toEqual([]);
    } finally {
      await fx.limpiar();
    }
  });

  it("sin sesión (rol anon) no puede llamar a las funciones ni leer la vista", async () => {
    const anonimo = crearCliente();
    const comision = await anonimo.rpc("comision", { p_monto_bruto: 25_000 });
    expect(comision.error?.code).toBe("42501");
    const parametrosSinSesion = await anonimo.rpc("parametros_negocio");
    expect(parametrosSinSesion.error?.code).toBe("42501");
    const vista = await anonimo.from("monitoria_plazos").select("id_monitoria");
    expect(vista.error?.code).toBe("42501");
  });
});
