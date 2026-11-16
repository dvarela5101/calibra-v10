import { describe, expect, it } from "vitest";
import {
  diaIso,
  esFecha,
  estadoDeMonitoria,
  etiquetaDeDia,
  fechasDeRepeticion,
  franjaOcurreEn,
  hrefDelCalendario,
  leerDia,
  leerSemanas,
  leerVista,
  lunesDe,
  marcasDelDia,
  mismoMes,
  nombreAccesibleDelDia,
  ocurrenciasPorDia,
  primerDiaDelMes,
  rangoDeHoras,
  rangoDeSemana,
  rejillaDelMes,
  resumenDelDia,
  rutaDeOcurrencia,
  semanaDe,
  sumarDias,
  textoDeRepeticion,
  tituloDelMes,
  type FranjaDeCalendario,
  type MonitoriaParaCalendario,
} from "./reglas";

// Hoy en estas pruebas: lunes 16 de noviembre de 2026. El jueves 19 es el día de las franjas de ejemplo.
const HOY = "2026-11-16";

const franja = (extra: Partial<FranjaDeCalendario> = {}): FranjaDeCalendario => ({
  id: "f1",
  dia: 4,
  hora: "10:00:00",
  duracion_min: 60,
  presencial: false,
  precio: 25000,
  abierta_desde: "2026-11-01",
  cerrada_desde: null,
  ...extra,
});

const monitoria = (extra: Partial<MonitoriaParaCalendario> = {}): MonitoriaParaCalendario => ({
  idMonitoria: "m1",
  fecha: "2026-11-19",
  hora: "10:00:00",
  duracionMin: 60,
  presencial: false,
  estado: "confirmada",
  reservaVencida: false,
  nombreEstudiante: "Valeria",
  nombreMateria: "Cálculo I",
  ...extra,
});

describe("fechas civiles", () => {
  it("reconoce solo días reales", () => {
    expect(esFecha("2026-11-19")).toBe(true);
    expect(esFecha("2028-02-29")).toBe(true);
    expect(esFecha("2026-02-29")).toBe(false);
    expect(esFecha("2026-13-01")).toBe(false);
    expect(esFecha("2026-1-9")).toBe(false);
    expect(esFecha("hoy")).toBe(false);
    expect(esFecha(undefined)).toBe(false);
  });

  it("suma días cruzando mes y año, también hacia atrás", () => {
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2027-01-01", -1)).toBe("2026-12-31");
    expect(sumarDias("2028-02-28", 2)).toBe("2028-03-01");
    expect(sumarDias("2026-11-19", 7)).toBe("2026-11-26");
  });

  it("da el día ISO: lunes 1 ... domingo 7", () => {
    expect(diaIso("2026-11-16")).toBe(1);
    expect(diaIso("2026-11-19")).toBe(4);
    expect(diaIso("2026-11-22")).toBe(7);
    expect(diaIso("2026-11-01")).toBe(7);
  });

  it("la semana va de lunes a domingo, también en un cambio de mes y de año", () => {
    expect(semanaDe("2026-11-19")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(semanaDe("2026-11-22")[0]).toBe("2026-11-16");
    expect(semanaDe("2026-11-16")[6]).toBe("2026-11-22");
    expect(semanaDe("2026-12-31")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(lunesDe("2026-12-01")).toBe("2026-11-30");
  });

  it("el primer día del mes, con desplazamiento", () => {
    expect(primerDiaDelMes("2026-11-19")).toBe("2026-11-01");
    expect(primerDiaDelMes("2026-11-19", 1)).toBe("2026-12-01");
    expect(primerDiaDelMes("2026-12-19", 1)).toBe("2027-01-01");
    expect(primerDiaDelMes("2027-01-19", -1)).toBe("2026-12-01");
    expect(primerDiaDelMes("2026-01-31", -1)).toBe("2025-12-01");
  });

  it("la rejilla del mes trae las semanas completas que lo cubren", () => {
    // Noviembre de 2026 empieza en domingo y termina en lunes: seis semanas.
    const nov = rejillaDelMes("2026-11-19");
    expect(nov).toHaveLength(6);
    expect(nov[0][0]).toBe("2026-10-26");
    expect(nov[0][6]).toBe("2026-11-01");
    expect(nov[5][0]).toBe("2026-11-30");
    expect(nov[5][6]).toBe("2026-12-06");
    expect(nov.every((s) => s.length === 7)).toBe(true);
    // Febrero de 2027 empieza en lunes y tiene 28 días: cuatro semanas justas.
    const feb = rejillaDelMes("2027-02-10");
    expect(feb).toHaveLength(4);
    expect(feb[0][0]).toBe("2027-02-01");
    expect(feb[3][6]).toBe("2027-02-28");
    // Diciembre de 2026 termina en jueves y la última semana llega a enero.
    const dic = rejillaDelMes("2026-12-15");
    expect(dic[dic.length - 1][6]).toBe("2027-01-03");
    // Febrero bisiesto.
    expect(rejillaDelMes("2028-02-10").flat()).toContain("2028-02-29");
  });

  it("mismoMes compara mes y año", () => {
    expect(mismoMes("2026-11-30", "2026-11-01")).toBe(true);
    expect(mismoMes("2025-11-30", "2026-11-01")).toBe(false);
    expect(mismoMes("2026-12-01", "2026-11-30")).toBe(false);
  });
});

describe("textos de fechas", () => {
  it("el día, el rango de la semana y el título del mes", () => {
    expect(etiquetaDeDia("2026-11-19")).toBe("jueves 19 de noviembre");
    expect(rangoDeSemana("2026-11-19")).toBe("16 a 22 de nov.");
    expect(rangoDeSemana("2026-11-30")).toBe("30 de nov. a 6 de dic.");
    expect(rangoDeSemana("2026-12-31")).toBe("28 de dic. de 2026 a 3 de ene. de 2027");
    expect(tituloDelMes("2026-11-19")).toBe("Noviembre de 2026");
  });

  it("el nombre accesible del día dice cuántas franjas hay y si es hoy", () => {
    expect(nombreAccesibleDelDia("2026-11-19", 3, HOY)).toBe("jueves 19 de noviembre, 3 franjas");
    expect(nombreAccesibleDelDia("2026-11-20", 1, HOY)).toBe("viernes 20 de noviembre, 1 franja");
    expect(nombreAccesibleDelDia("2026-11-21", 0, HOY)).toBe("sábado 21 de noviembre, sin franjas");
    expect(nombreAccesibleDelDia(HOY, 2, HOY)).toBe("lunes 16 de noviembre (hoy), 2 franjas");
  });
});

describe("la dirección", () => {
  it("la vista es semana salvo que diga mes", () => {
    expect(leerVista(undefined)).toBe("semana");
    expect(leerVista("mes")).toBe("mes");
    expect(leerVista(["mes", "semana"])).toBe("mes");
    expect(leerVista("MES")).toBe("semana");
    expect(leerVista("año")).toBe("semana");
  });

  it("el día es el de la dirección si es una fecha real, y si no hoy", () => {
    expect(leerDia("2026-11-19", HOY)).toBe("2026-11-19");
    expect(leerDia(["2026-12-01", "x"], HOY)).toBe("2026-12-01");
    expect(leerDia(undefined, HOY)).toBe(HOY);
    expect(leerDia("2026-02-30", HOY)).toBe(HOY);
    expect(leerDia("mañana", HOY)).toBe(HOY);
    expect(leerDia("", HOY)).toBe(HOY);
  });

  it("arma la dirección del calendario", () => {
    expect(hrefDelCalendario("mes", "2026-12-01")).toBe("/monitor?vista=mes&dia=2026-12-01");
  });
});

describe("franjaOcurreEn", () => {
  it("pide su día de la semana, abierta_desde inclusive y cerrada_desde exclusivo", () => {
    const f = franja({ abierta_desde: "2026-11-19", cerrada_desde: "2026-12-04" });
    expect(franjaOcurreEn(f, "2026-11-19")).toBe(true);
    expect(franjaOcurreEn(f, "2026-11-12")).toBe(false);
    expect(franjaOcurreEn(f, "2026-11-26")).toBe(true);
    expect(franjaOcurreEn(f, "2026-12-03")).toBe(true);
    expect(franjaOcurreEn(f, "2026-12-04")).toBe(false);
    expect(franjaOcurreEn(f, "2026-11-20")).toBe(false);
  });

  it("sin cierre sigue indefinidamente, también en otro año", () => {
    expect(franjaOcurreEn(franja({ cerrada_desde: null }), "2027-03-04")).toBe(true);
  });

  it("«solo el jueves 19» es abierta el 19 y cerrada el 20", () => {
    const f = franja({ abierta_desde: "2026-11-19", cerrada_desde: "2026-11-20" });
    expect(franjaOcurreEn(f, "2026-11-19")).toBe(true);
    expect(franjaOcurreEn(f, "2026-11-26")).toBe(false);
  });
});

describe("estadoDeMonitoria", () => {
  it("confirmada y realizada son reservadas; pendiente vigente, por pagar; el resto no ocupa", () => {
    expect(estadoDeMonitoria({ estado: "confirmada", reservaVencida: false })).toBe("reservada");
    expect(estadoDeMonitoria({ estado: "realizada", reservaVencida: false })).toBe("reservada");
    expect(estadoDeMonitoria({ estado: "pendiente_pago", reservaVencida: false })).toBe("por_pagar");
    expect(estadoDeMonitoria({ estado: "pendiente_pago", reservaVencida: true })).toBeNull();
    expect(estadoDeMonitoria({ estado: "cancelada", reservaVencida: false })).toBeNull();
  });
});

describe("ocurrenciasPorDia", () => {
  const semana = (franjas: FranjaDeCalendario[], monitorias: MonitoriaParaCalendario[] = [], hoy = HOY) =>
    ocurrenciasPorDia(franjas, monitorias, "2026-11-16", "2026-11-22", hoy);

  it("pone la franja en su día con hora, fin, modalidad, precio y estado libre", () => {
    const dias = semana([franja({ duracion_min: 90, presencial: true })]);
    expect(Object.keys(dias)).toEqual(semanaDe(HOY));
    expect(dias["2026-11-18"]).toEqual([]);
    expect(dias["2026-11-19"]).toEqual([
      {
        clave: "2026-11-19|10:00|f1",
        fecha: "2026-11-19",
        hora: "10:00",
        fin: "11:30",
        minutoInicio: 600,
        duracionMin: 90,
        presencial: true,
        precio: 25000,
        estado: "libre",
        idFranja: "f1",
        estudiante: null,
        materia: null,
      },
    ]);
  });

  it("una confirmada o realizada la deja reservada, con quien agendó y la materia", () => {
    for (const estado of ["confirmada", "realizada"] as const) {
      const [o] = semana([franja()], [monitoria({ estado })])["2026-11-19"];
      expect(o.estado).toBe("reservada");
      expect(o.estudiante).toBe("Valeria");
      expect(o.materia).toBe("Cálculo I");
      expect(o.idFranja).toBe("f1");
    }
  });

  it("una pendiente de pago vigente queda por pagar; vencida o cancelada deja la fecha libre", () => {
    expect(semana([franja()], [monitoria({ estado: "pendiente_pago" })])["2026-11-19"][0].estado).toBe("por_pagar");
    const vencida = semana([franja()], [monitoria({ estado: "pendiente_pago", reservaVencida: true })])["2026-11-19"][0];
    expect([vencida.estado, vencida.estudiante]).toEqual(["libre", null]);
    expect(semana([franja()], [monitoria({ estado: "cancelada" })])["2026-11-19"][0].estado).toBe("libre");
  });

  it("solo cuenta la monitoría de esa fecha y de esa hora", () => {
    const dias = semana([franja()], [monitoria({ fecha: "2026-11-26" }), monitoria({ hora: "11:00:00", idMonitoria: "m2" })]);
    expect(dias["2026-11-19"][0].estado).toBe("libre");
    // La de las 11:00 no la cubre ninguna franja de ese día: sale construida desde la monitoría.
    expect(dias["2026-11-19"].map((o) => [o.hora, o.estado])).toEqual([
      ["10:00", "libre"],
      ["11:00", "reservada"],
    ]);
  });

  it("si hay una reservada y otra por pagar para la misma hora, gana la reservada", () => {
    const [o] = semana(
      [franja()],
      [monitoria({ idMonitoria: "a", estado: "pendiente_pago", nombreEstudiante: "Ana" }), monitoria({ idMonitoria: "b", nombreEstudiante: "Beto" })],
    )["2026-11-19"];
    expect([o.estado, o.estudiante]).toEqual(["reservada", "Beto"]);
  });

  it("respeta abierta_desde y cerrada_desde", () => {
    const dias = ocurrenciasPorDia(
      [franja({ abierta_desde: "2026-11-26", cerrada_desde: "2026-12-10" })],
      [],
      "2026-11-16",
      "2026-12-13",
      HOY,
    );
    const con = Object.entries(dias).filter(([, v]) => v.length > 0).map(([f]) => f);
    expect(con).toEqual(["2026-11-26", "2026-12-03"]);
  });

  it("no muestra una libre en una fecha pasada, pero sí la de hoy", () => {
    const f = franja({ dia: 1, abierta_desde: "2026-11-01" });
    const dias = semana([f]);
    expect(dias["2026-11-16"]).toHaveLength(1);
    const despues = ocurrenciasPorDia([f], [], "2026-11-09", "2026-11-22", HOY);
    expect(despues["2026-11-09"]).toEqual([]);
    expect(despues["2026-11-16"]).toHaveLength(1);
  });

  it("una reservada o por pagar en fecha pasada sí se muestra", () => {
    const dias = ocurrenciasPorDia(
      [franja({ dia: 1 })],
      [monitoria({ fecha: "2026-11-09", estado: "realizada" })],
      "2026-11-09",
      "2026-11-15",
      HOY,
    );
    expect(dias["2026-11-09"].map((o) => o.estado)).toEqual(["reservada"]);
  });

  it("una monitoría cuya franja se cerró después se muestra construida desde la monitoría", () => {
    const cerrada = franja({ cerrada_desde: "2026-11-20" });
    // El 26 ya no hay franja, pero la monitoría de ese día sigue en pie.
    const dias = ocurrenciasPorDia([cerrada], [monitoria({ fecha: "2026-11-26", duracionMin: 90, presencial: true })], "2026-11-23", "2026-11-29", HOY);
    expect(dias["2026-11-26"]).toEqual([
      {
        clave: "2026-11-26|10:00|m1",
        fecha: "2026-11-26",
        hora: "10:00",
        fin: "11:30",
        minutoInicio: 600,
        duracionMin: 90,
        presencial: true,
        // Tomó el precio de la franja con el mismo día y hora.
        precio: 25000,
        estado: "reservada",
        idFranja: null,
        estudiante: "Valeria",
        materia: "Cálculo I",
      },
    ]);
    expect(rutaDeOcurrencia(dias["2026-11-26"][0])).toBe("/monitor/agenda");
  });

  it("sin franja de origen no sabe el precio", () => {
    const dias = ocurrenciasPorDia([], [monitoria()], "2026-11-16", "2026-11-22", HOY);
    expect(dias["2026-11-19"][0].precio).toBeNull();
  });

  it("ordena por hora y funciona al cruzar el cambio de año", () => {
    const franjas = [franja({ id: "tarde", hora: "15:00:00" }), franja({ id: "manana", hora: "08:30:00", duracion_min: 60 }), franja({ id: "noche", dia: 5, hora: "18:00" })];
    const dias = ocurrenciasPorDia(franjas, [], "2026-12-28", "2027-01-03", "2026-12-01");
    expect(dias["2026-12-31"].map((o) => o.idFranja)).toEqual(["manana", "tarde"]);
    expect(dias["2027-01-01"].map((o) => o.idFranja)).toEqual(["noche"]);
    expect(Object.keys(dias)).toHaveLength(7);
  });

  it("la ruta: libre a su página, reservada y por pagar a la agenda", () => {
    expect(rutaDeOcurrencia({ estado: "libre", idFranja: "abc" })).toBe("/monitor/franjas/abc");
    expect(rutaDeOcurrencia({ estado: "reservada", idFranja: "abc" })).toBe("/monitor/agenda");
    expect(rutaDeOcurrencia({ estado: "por_pagar", idFranja: "abc" })).toBe("/monitor/agenda");
  });
});

describe("rangoDeHoras", () => {
  it("de 8:00 a 18:00 como mínimo", () => {
    expect(rangoDeHoras([])).toEqual({ desde: 8, hasta: 18 });
    expect(rangoDeHoras([{ minutoInicio: 600, duracionMin: 60 }])).toEqual({ desde: 8, hasta: 18 });
  });

  it("se amplía a horas completas para las franjas fuera de ese rango", () => {
    expect(rangoDeHoras([{ minutoInicio: 6 * 60 + 30, duracionMin: 60 }])).toEqual({ desde: 6, hasta: 18 });
    expect(rangoDeHoras([{ minutoInicio: 17 * 60 + 30, duracionMin: 90 }])).toEqual({ desde: 8, hasta: 19 });
    expect(rangoDeHoras([{ minutoInicio: 20 * 60, duracionMin: 120 }])).toEqual({ desde: 8, hasta: 22 });
    expect(rangoDeHoras([{ minutoInicio: 22 * 60, duracionMin: 120 }])).toEqual({ desde: 8, hasta: 24 });
  });
});

describe("marcas y resumen del día", () => {
  const de = (...estados: ("libre" | "reservada" | "por_pagar")[]) => estados.map((estado) => ({ estado }));

  it("una marca por franja, hasta tres, y un «+» si hay más", () => {
    expect(marcasDelDia([])).toEqual({ estados: [], hayMas: false });
    expect(marcasDelDia(de("libre", "reservada", "por_pagar"))).toEqual({ estados: ["libre", "reservada", "por_pagar"], hayMas: false });
    expect(marcasDelDia(de("libre", "libre", "libre", "reservada"))).toEqual({ estados: ["libre", "libre", "libre"], hayMas: true });
  });

  it("el resumen cuenta franjas y libres", () => {
    expect(resumenDelDia([])).toBe("Sin franjas este día");
    expect(resumenDelDia(de("libre", "reservada", "por_pagar"))).toBe("3 franjas · 1 libre");
    expect(resumenDelDia(de("libre", "libre"))).toBe("2 franjas · 2 libres");
    expect(resumenDelDia(de("reservada"))).toBe("1 franja · ninguna libre");
  });
});

describe("la repetición", () => {
  it("lee las semanas: enteros de 2 a 16", () => {
    expect(leerSemanas("2")).toBe(2);
    expect(leerSemanas(16)).toBe(16);
    expect(leerSemanas("1")).toBeNull();
    expect(leerSemanas("17")).toBeNull();
    expect(leerSemanas("4.5")).toBeNull();
    expect(leerSemanas("")).toBeNull();
    expect(leerSemanas("abc")).toBeNull();
  });

  it("las fechas: una, N semanas o las cuatro primeras de «todas»", () => {
    expect(fechasDeRepeticion("2026-11-19", "una", 4)).toEqual(["2026-11-19"]);
    expect(fechasDeRepeticion("2026-11-19", "semanas", 3)).toEqual(["2026-11-19", "2026-11-26", "2026-12-03"]);
    expect(fechasDeRepeticion("2026-11-19", "siempre", 4)).toEqual(["2026-11-19", "2026-11-26", "2026-12-03", "2026-12-10"]);
    expect(fechasDeRepeticion("2026-11-19", "semanas", 1)).toEqual([]);
    expect(fechasDeRepeticion("2026-12-24", "semanas", 4)).toEqual(["2026-12-24", "2026-12-31", "2027-01-07", "2027-01-14"]);
  });

  it("el texto de la repetición", () => {
    expect(textoDeRepeticion("2026-11-19", "una", 4)).toBe("Quedará abierta solo el 19 de noviembre.");
    expect(textoDeRepeticion("2026-11-19", "semanas", 4)).toBe("Quedará abierta el 19 y el 26 de noviembre, y el 3 y el 10 de diciembre.");
    expect(textoDeRepeticion("2026-11-19", "semanas", 3)).toBe("Quedará abierta el 19 y el 26 de noviembre, y el 3 de diciembre.");
    expect(textoDeRepeticion("2026-11-19", "siempre", 4)).toBe(
      "Quedará abierta el 19 y el 26 de noviembre, y el 3 y el 10 de diciembre, y así cada jueves, sin fecha final.",
    );
    expect(textoDeRepeticion("2026-11-19", "semanas", 8)).toBe("Quedará abierta cada jueves, desde el 19 de noviembre hasta el 7 de enero de 2027 (8 semanas).");
    expect(textoDeRepeticion("2026-11-19", "semanas", 1)).toBe("Elige entre 2 y 16 semanas.");
  });

  it("al cruzar el año pone el año de las fechas que ya no son el del primero", () => {
    expect(textoDeRepeticion("2026-12-24", "semanas", 4)).toBe("Quedará abierta el 24 y el 31 de diciembre, y el 7 y el 14 de enero de 2027.");
    expect(textoDeRepeticion("2026-11-28", "semanas", 3)).toBe("Quedará abierta el 28 de noviembre, y el 5 y el 12 de diciembre.");
    expect(textoDeRepeticion("2026-11-14", "semanas", 3)).toBe("Quedará abierta el 14, el 21 y el 28 de noviembre.");
  });
});
