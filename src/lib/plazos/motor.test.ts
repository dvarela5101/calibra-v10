import { describe, expect, it, vi } from "vitest";
import { PARAMETROS_DEL_DOCUMENTO as P } from "../../../pruebas/plazos-referencia";
import type { ParametrosNegocio } from "./parametros";
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
  sesionDeFranja,
  ventanaResenaHasta,
} from "./motor";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const iso = (fecha: Date) => fecha.toISOString();
const en = (base: Date, ms: number) => new Date(base.getTime() + ms);

// Lunes 5 de octubre de 2026, 10:00 en Bogotá (UTC-5) = 15:00 UTC.
const INICIO = new Date("2026-10-05T15:00:00.000Z");
const FIN = new Date("2026-10-05T16:00:00.000Z"); // franja de 60 minutos

describe("inicioDeSesion (RN-36)", () => {
  it("es fecha más hora en Bogotá, sin importar UTC", () => {
    expect(iso(inicioDeSesion("2026-09-28", "12:00"))).toBe("2026-09-28T17:00:00.000Z");
    expect(iso(inicioDeSesion("2026-10-05", "10:00"))).toBe("2026-10-05T15:00:00.000Z");
  });

  it("acepta segundos", () => {
    expect(iso(inicioDeSesion("2026-09-28", "10:30:15"))).toBe("2026-09-28T15:30:15.000Z");
  });

  it("la medianoche y el último segundo caen en el día UTC correcto", () => {
    expect(iso(inicioDeSesion("2026-09-28", "00:00"))).toBe("2026-09-28T05:00:00.000Z");
    // 23:59:59 en Bogotá ya es el día siguiente en UTC.
    expect(iso(inicioDeSesion("2026-09-28", "23:59:59"))).toBe("2026-09-29T04:59:59.000Z");
  });

  it("maneja fin de año y año bisiesto", () => {
    expect(iso(inicioDeSesion("2026-12-31", "20:00"))).toBe("2027-01-01T01:00:00.000Z");
    expect(iso(inicioDeSesion("2028-02-29", "08:00"))).toBe("2028-02-29T13:00:00.000Z");
  });

  it("no usa la zona del proceso: da lo mismo con TZ de Tokio, UTC o Los Ángeles", async () => {
    const zonaOriginal = process.env.TZ;
    const esperado = "2026-10-05T15:00:00.000Z";
    try {
      const desfases = new Set<number>();
      for (const zona of ["Asia/Tokyo", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = zona;
        // Comprueba que el cambio de zona sí tuvo efecto: si no, esta prueba no probaría nada.
        desfases.add(new Date(2026, 9, 5, 10, 0, 0).getTimezoneOffset());
        // El motor crea su formateador de fechas al cargarse: se vuelve a cargar con cada zona ya
        // puesta. Sin esto, quitar `timeZone` del formateador no haría fallar la prueba.
        vi.resetModules();
        const motor = await import("./motor");
        expect(iso(motor.inicioDeSesion("2026-10-05", "10:00"))).toBe(esperado);
        expect(iso(motor.inicioDeSesion("2026-01-01", "00:00"))).toBe("2026-01-01T05:00:00.000Z");
      }
      expect(desfases.size).toBeGreaterThan(1);
    } finally {
      if (zonaOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = zonaOriginal;
      vi.resetModules();
    }
  });

  it.each([
    ["2026-02-29", "10:00", /no existe/], // 2026 no es bisiesto
    ["2026-02-30", "10:00", /no existe/],
    ["2026-04-31", "10:00", /no existe/],
    ["2026-13-01", "10:00", /no existe/],
    ["2026-00-10", "10:00", /no existe/],
    ["0050-01-01", "10:00", /fuera de rango/], // Date.UTC lo leería como 1950
    ["0100-01-01", "10:00", /fuera de rango/], // Bogotá tenía otro huso antes de 1914
    ["1899-12-31", "10:00", /fuera de rango/],
    ["2026-9-28", "10:00", /AAAA-MM-DD/],
    ["28/09/2026", "10:00", /AAAA-MM-DD/],
    ["", "10:00", /AAAA-MM-DD/],
    ["2026-09-28", "24:00", /HH:MM/],
    ["2026-09-28", "9:00", /HH:MM/],
    ["2026-09-28", "12:60", /HH:MM/],
    ["2026-09-28", "12:00:60", /HH:MM/],
    ["2026-09-28", "12:00:00.5", /HH:MM/],
    ["2026-09-28", "", /HH:MM/],
  ])("rechaza fecha %j y hora %j", (fecha, hora, mensaje) => {
    expect(() => inicioDeSesion(fecha, hora)).toThrow(mensaje);
  });
});

describe("diaIsoDeFecha", () => {
  it.each([
    ["2026-09-28", 1], // lunes
    ["2026-10-01", 4], // jueves
    ["2026-10-04", 7], // domingo
    ["2026-10-05", 1],
    ["2028-02-29", 2], // martes
    ["2026-12-31", 4],
  ])("%s cae en el día ISO %i", (fecha, dia) => {
    expect(diaIsoDeFecha(fecha)).toBe(dia);
  });
});

describe("finProgramado y sesionDeFranja (RN-36)", () => {
  it("el fin es el inicio más duracionMin", () => {
    expect(iso(finProgramado(INICIO, 60))).toBe("2026-10-05T16:00:00.000Z");
    expect(iso(finProgramado(INICIO, 90))).toBe("2026-10-05T16:30:00.000Z");
  });

  it("una duración que cruza la medianoche cambia de día", () => {
    const tarde = inicioDeSesion("2026-10-05", "23:30");
    expect(iso(finProgramado(tarde, 60))).toBe("2026-10-06T05:30:00.000Z");
  });

  it.each([0, -30, 1.5, Number.NaN])("rechaza la duración %s", (duracion) => {
    expect(() => finProgramado(INICIO, duracion)).toThrow(/duracionMin/);
  });

  it("una franja del lunes a las 10:00 con 90 minutos, en un lunes concreto", () => {
    const { inicio, fin } = sesionDeFranja({ dia: 1, hora: "10:00", duracionMin: 90 }, "2026-10-05");
    expect(iso(inicio)).toBe("2026-10-05T15:00:00.000Z");
    expect(iso(fin)).toBe("2026-10-05T16:30:00.000Z");
  });

  it("rechaza una fecha que no cae en el día de la franja, como el trigger de la base", () => {
    expect(() => sesionDeFranja({ dia: 1, hora: "10:00", duracionMin: 60 }, "2026-10-06")).toThrow(/no cae en el día 1/);
  });
});

describe("plazos derivados (sección 6.1)", () => {
  const creacion = new Date("2026-10-01T14:00:00.000Z");

  it("reserva: 10 minutos desde que se agenda", () => {
    expect(iso(reservaHasta(creacion, P))).toBe("2026-10-01T14:10:00.000Z");
  });

  it("revisión: 1 hora desde la asignación", () => {
    expect(iso(revisionHasta(creacion, P))).toBe("2026-10-01T15:00:00.000Z");
  });

  it("cancelación: 12 h antes en individual y 24 h antes en grupal", () => {
    expect(iso(cancelableHasta(INICIO, false, P))).toBe("2026-10-05T03:00:00.000Z");
    expect(iso(cancelableHasta(INICIO, true, P))).toBe("2026-10-04T15:00:00.000Z");
  });

  it("pago de integrantes: 24 h antes; diferencia: 5 h antes", () => {
    expect(iso(fechaLimitePago(INICIO, P))).toBe("2026-10-04T15:00:00.000Z");
    expect(iso(fechaLimiteDiferencia(INICIO, P))).toBe("2026-10-05T10:00:00.000Z");
  });

  it("reporte de inasistencia y desembolso: 24 h después del fin", () => {
    expect(iso(reporteInasistenciaHasta(FIN, P))).toBe("2026-10-06T16:00:00.000Z");
    expect(iso(desembolsableDesde(FIN, P))).toBe("2026-10-06T16:00:00.000Z");
  });

  it("reseña grupal: 1 h después de finalizar", () => {
    const finalizacion = new Date("2026-10-05T16:20:00.000Z");
    expect(iso(ventanaResenaHasta(finalizacion, P))).toBe("2026-10-05T17:20:00.000Z");
  });

  it("los parámetros salen del argumento, no del módulo", () => {
    const otros = { ...P, reservaMin: 15, cancelacionIndividualMin: 60 };
    expect(iso(reservaHasta(creacion, otros))).toBe("2026-10-01T14:15:00.000Z");
    expect(iso(cancelableHasta(INICIO, false, otros))).toBe("2026-10-05T14:00:00.000Z");
  });

  it("rechaza una fecha inválida en vez de propagar NaN", () => {
    expect(() => reservaHasta(new Date("no es una fecha"), P)).toThrow(/fechaCreacion/);
    expect(() => cancelableHasta(new Date(Number.NaN), false, P)).toThrow(/inicio/);
  });
});

describe("bordes inclusivos (P-40): un minuto antes, en el borde y un minuto después", () => {
  const creacion = new Date("2026-10-01T14:00:00.000Z");
  const finalizacion = new Date("2026-10-05T16:20:00.000Z");

  // Para un plazo "hasta X" se esperan [antes, borde, después] = [true, true, false].
  // Para un plazo "desde X" se esperan [false, true, true].
  const HASTA = [true, true, false];
  const DESDE = [false, true, true];

  // El borde se escribe a mano desde la referencia (inicio, fin, creación...), sin pasar por la
  // función que se prueba: si un plazo estuviera mal, el borde que dice la tabla 6.1 y el que
  // calcula la función no coincidirían y la prueba fallaría.
  const casos: [string, Date, (ahora: Date) => boolean, boolean[]][] = [
    ["antelación individual de 3 h (RN-35)", en(INICIO, -3 * HORA), (ahora) => cumpleAntelacion(INICIO, ahora, false, P), HASTA],
    ["antelación grupal de 36 h (RN-35)", en(INICIO, -36 * HORA), (ahora) => cumpleAntelacion(INICIO, ahora, true, P), HASTA],
    ["reserva de 10 min (RN-34)", en(creacion, 10 * MINUTO), (ahora) => dentroDePlazo(reservaHasta(creacion, P), ahora), HASTA],
    ["revisión de 1 h (RN-42)", en(creacion, HORA), (ahora) => dentroDePlazo(revisionHasta(creacion, P), ahora), HASTA],
    ["cancelación individual hasta 12 h antes (RN-60)", en(INICIO, -12 * HORA), (ahora) => dentroDePlazo(cancelableHasta(INICIO, false, P), ahora), HASTA],
    ["cancelación grupal hasta 24 h antes (RN-60)", en(INICIO, -24 * HORA), (ahora) => dentroDePlazo(cancelableHasta(INICIO, true, P), ahora), HASTA],
    ["pago de integrantes hasta 24 h antes (RN-54)", en(INICIO, -24 * HORA), (ahora) => dentroDePlazo(fechaLimitePago(INICIO, P), ahora), HASTA],
    ["diferencia hasta 5 h antes (RN-55)", en(INICIO, -5 * HORA), (ahora) => dentroDePlazo(fechaLimiteDiferencia(INICIO, P), ahora), HASTA],
    ["reporte de inasistencia hasta 24 h después del fin (RN-62)", en(FIN, 24 * HORA), (ahora) => dentroDePlazo(reporteInasistenciaHasta(FIN, P), ahora), HASTA],
    ["reseña grupal hasta 1 h después de finalizar (RN-71)", en(finalizacion, HORA), (ahora) => dentroDePlazo(ventanaResenaHasta(finalizacion, P), ahora), HASTA],
    ["desembolso desde 24 h después del fin (RN-83)", en(FIN, 24 * HORA), (ahora) => plazoAlcanzado(desembolsableDesde(FIN, P), ahora), DESDE],
  ];

  it.each(casos)("%s", (_nombre, borde, evaluar, esperado) => {
    const resultado = [-MINUTO, 0, MINUTO].map((desfase) => evaluar(en(borde, desfase)));
    expect(resultado).toEqual(esperado);
  });

  it("el borde de cada plazo cae donde dice la tabla", () => {
    expect(iso(en(INICIO, -3 * HORA))).toBe("2026-10-05T12:00:00.000Z");
    expect(iso(cancelableHasta(INICIO, false, P))).toBe(iso(en(INICIO, -12 * HORA)));
    expect(iso(cancelableHasta(INICIO, true, P))).toBe(iso(en(INICIO, -24 * HORA)));
    expect(iso(fechaLimiteDiferencia(INICIO, P))).toBe(iso(en(INICIO, -5 * HORA)));
    expect(iso(desembolsableDesde(FIN, P))).toBe(iso(en(FIN, 24 * HORA)));
  });

  it("un segundo de más ya es fuera de plazo: el borde inclusivo no se redondea a minutos", () => {
    const limite = cancelableHasta(INICIO, false, P);
    expect(dentroDePlazo(limite, en(limite, 1000))).toBe(false);
    expect(dentroDePlazo(limite, en(limite, -1000))).toBe(true);
    expect(plazoAlcanzado(limite, en(limite, -1000))).toBe(false);
  });

  it("agendar con la sesión ya empezada o pasada nunca cumple la antelación", () => {
    expect(cumpleAntelacion(INICIO, INICIO, false, P)).toBe(false);
    expect(cumpleAntelacion(INICIO, en(INICIO, HORA), true, P)).toBe(false);
  });

  it("rechaza fechas inválidas en los predicados", () => {
    expect(() => dentroDePlazo(new Date(Number.NaN), INICIO)).toThrow(/limite/);
    expect(() => plazoAlcanzado(INICIO, new Date(Number.NaN))).toThrow(/ahora/);
  });
});

describe("derivadosDeMonitoria", () => {
  const franja = { dia: 1, hora: "10:00", duracionMin: 60 };
  const fechaCreacion = new Date("2026-10-01T14:00:00.000Z");

  it("una individual: sin plazos de grupal", () => {
    const d = derivadosDeMonitoria({ franja, fecha: "2026-10-05", fechaCreacion, esGrupal: false, fechaFinalizacion: null }, P);
    expect(iso(d.inicio)).toBe("2026-10-05T15:00:00.000Z");
    expect(iso(d.finProgramado)).toBe("2026-10-05T16:00:00.000Z");
    expect(iso(d.reservaHasta)).toBe("2026-10-01T14:10:00.000Z");
    expect(iso(d.cancelableHasta)).toBe("2026-10-05T03:00:00.000Z");
    expect(iso(d.reporteInasistenciaHasta)).toBe("2026-10-06T16:00:00.000Z");
    expect(iso(d.desembolsableDesde)).toBe("2026-10-06T16:00:00.000Z");
    expect(d.fechaLimitePago).toBeNull();
    expect(d.fechaLimiteDiferencia).toBeNull();
    expect(d.ventanaResenaHasta).toBeNull();
  });

  it("una grupal sin finalizar: cancelación a 24 h y límites de pago y diferencia", () => {
    const d = derivadosDeMonitoria({ franja, fecha: "2026-10-05", fechaCreacion, esGrupal: true, fechaFinalizacion: null }, P);
    expect(iso(d.cancelableHasta)).toBe("2026-10-04T15:00:00.000Z");
    expect(iso(d.fechaLimitePago!)).toBe("2026-10-04T15:00:00.000Z");
    expect(iso(d.fechaLimiteDiferencia!)).toBe("2026-10-05T10:00:00.000Z");
    expect(d.ventanaResenaHasta).toBeNull();
  });

  it("una grupal finalizada: ventana de reseña de 1 h", () => {
    const fechaFinalizacion = new Date("2026-10-05T16:05:00.000Z");
    const d = derivadosDeMonitoria({ franja, fecha: "2026-10-05", fechaCreacion, esGrupal: true, fechaFinalizacion }, P);
    expect(iso(d.ventanaResenaHasta!)).toBe("2026-10-05T17:05:00.000Z");
  });

  it("una individual finalizada sigue sin límite de reseña (RN-72)", () => {
    const fechaFinalizacion = new Date("2026-10-05T16:05:00.000Z");
    const d = derivadosDeMonitoria({ franja, fecha: "2026-10-05", fechaCreacion, esGrupal: false, fechaFinalizacion }, P);
    expect(d.ventanaResenaHasta).toBeNull();
  });

  it("rechaza una fecha que no cae en el día de la franja", () => {
    expect(() =>
      derivadosDeMonitoria({ franja, fecha: "2026-10-06", fechaCreacion, esGrupal: false, fechaFinalizacion: null }, P),
    ).toThrow(/no cae en el día/);
  });
});

describe("comisión de la plataforma (RN-81)", () => {
  it.each([
    [25_000, 2_500, 22_500], // individual de 25.000
    [100_000, 10_000, 90_000], // grupal de 5 x 20.000
    [150_000, 15_000, 135_000], // el tope se alcanza con 150.000
    [200_000, 15_000, 185_000], // por encima, la comisión no crece
    [0, 0, 0],
  ])("bruto %i: comisión %i y neto %i", (bruto, comision, neto) => {
    expect(calcularComision(bruto, P)).toBe(comision);
    expect(calcularMontoNeto(bruto, P)).toBe(neto);
  });

  it("alrededor del tope: un peso menos, el borde y un peso más", () => {
    expect(calcularComision(149_990, P)).toBe(14_999);
    expect(calcularComision(150_000, P)).toBe(15_000);
    expect(calcularComision(150_010, P)).toBe(15_000);
  });

  // SUPUESTO A VALIDAR: RN-81 no fija el redondeo; se toma el peso más cercano, medio peso hacia arriba.
  it.each([
    [4, 0],
    [5, 1],
    [14, 1],
    [15, 2],
    [25, 3],
    [149_994, 14_999],
    [149_995, 15_000],
  ])("redondeo al peso más cercano: bruto %i da comisión %i", (bruto, comision) => {
    expect(calcularComision(bruto, P)).toBe(comision);
  });

  it("la comisión es el 10 % del bruto (a medio peso) y nunca pasa del tope", () => {
    for (let bruto = 0; bruto <= 300_000; bruto += 137) {
      const comision = calcularComision(bruto, P);
      // Independiente de la implementación: el 10 % exacto, con tolerancia de medio peso, hasta el tope.
      if (bruto <= 150_000) expect(Math.abs(comision - bruto / 10)).toBeLessThanOrEqual(0.5);
      else expect(comision).toBe(15_000);
      expect(calcularMontoNeto(bruto, P)).toBe(bruto - comision);
    }
  });

  it("usa el porcentaje y el tope que le pasan", () => {
    const otros = { ...P, comisionPorcentaje: 20, comisionTope: 1_000 };
    expect(calcularComision(2_000, otros)).toBe(400);
    expect(calcularComision(10_000, otros)).toBe(1_000);
  });

  it.each([-1, -25_000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rechaza el bruto %s",
    (bruto) => {
      expect(() => calcularComision(bruto, P)).toThrow(/montoBruto/);
      expect(() => calcularMontoNeto(bruto, P)).toThrow(/montoBruto/);
    },
  );
});

describe("cada función lee su propio parámetro y ninguna lleva un número propio", () => {
  // Los valores del documento se repiten (1440 en cuatro plazos, 60 en dos): una función que leyera
  // el campo equivocado, o que llevara el número escrito, pasaría sin que nadie lo note. Con un primo
  // distinto por campo, cada desfase identifica de qué parámetro sale.
  const D: ParametrosNegocio = {
    reservaMin: 7,
    revisionMin: 11,
    antelacionIndividualMin: 13,
    antelacionGrupalMin: 17,
    cancelacionIndividualMin: 19,
    cancelacionGrupalMin: 23,
    pagoIntegrantesMin: 29,
    diferenciaMin: 31,
    reporteInasistenciaMin: 37,
    resenaGrupalMin: 41,
    desembolsoMin: 43,
    comisionPorcentaje: 47,
    comisionTope: 53,
  };
  const T = new Date("2026-10-05T15:00:00.000Z");
  const minutos = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / MINUTO;

  it.each([
    ["reservaHasta usa reservaMin", () => minutos(T, reservaHasta(T, D)), 7],
    ["revisionHasta usa revisionMin", () => minutos(T, revisionHasta(T, D)), 11],
    ["cancelableHasta individual usa cancelacionIndividualMin", () => minutos(T, cancelableHasta(T, false, D)), -19],
    ["cancelableHasta grupal usa cancelacionGrupalMin", () => minutos(T, cancelableHasta(T, true, D)), -23],
    ["fechaLimitePago usa pagoIntegrantesMin", () => minutos(T, fechaLimitePago(T, D)), -29],
    ["fechaLimiteDiferencia usa diferenciaMin", () => minutos(T, fechaLimiteDiferencia(T, D)), -31],
    ["reporteInasistenciaHasta usa reporteInasistenciaMin", () => minutos(T, reporteInasistenciaHasta(T, D)), 37],
    ["ventanaResenaHasta usa resenaGrupalMin", () => minutos(T, ventanaResenaHasta(T, D)), 41],
    ["desembolsableDesde usa desembolsoMin", () => minutos(T, desembolsableDesde(T, D)), 43],
  ])("%s", (_nombre, desfase, esperado) => {
    expect(desfase()).toBe(esperado);
  });

  it("cumpleAntelacion usa antelacionIndividualMin (13) y antelacionGrupalMin (17)", () => {
    const antes = (min: number) => new Date(T.getTime() - min * MINUTO);
    expect([13, 12].map((min) => cumpleAntelacion(T, antes(min), false, D))).toEqual([true, false]);
    expect([17, 16].map((min) => cumpleAntelacion(T, antes(min), true, D))).toEqual([true, false]);
  });

  it("calcularComision usa comisionPorcentaje (47 %) y comisionTope (53)", () => {
    expect(calcularComision(100, D)).toBe(47);
    expect(calcularComision(1_000, D)).toBe(53);
    expect(calcularMontoNeto(100, D)).toBe(53);
  });
});
