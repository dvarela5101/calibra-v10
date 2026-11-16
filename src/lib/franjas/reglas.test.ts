import { describe, expect, it } from "vitest";
import {
  SEMANAS_MAX,
  SEMANAS_MIN,
  esEnlaceDeVideollamada,
  fechasDeLaRepeticion,
  horaCorta,
  horaDe,
  horaDeFin,
  leerCierre,
  leerEntero,
  leerFranja,
  leerRepeticion,
  mensajeDeErrorDeFranja,
  minutosDe,
  nombreDelDia,
} from "./reglas";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

const PRESENCIAL = { dia: "1", hora: "14:00", duracion_min: "90", precio: "25.000", modalidad: "presencial", lugar: "  Edificio ML,  salón 101 " };
const VIRTUAL = { dia: "3", hora: "18:30", duracion_min: "60", precio: "30000", modalidad: "virtual", enlace: " https://meet.example.com/abc-defg " };

describe("días y horas", () => {
  it("los días son ISO: 1 es lunes y 7 domingo", () => {
    expect(nombreDelDia(1)).toBe("Lunes");
    expect(nombreDelDia(7)).toBe("Domingo");
    expect(() => nombreDelDia(0)).toThrow(RangeError);
    expect(() => nombreDelDia(8)).toThrow(RangeError);
  });

  it.each([
    ["00:00", 0],
    ["09:05", 545],
    ["23:59", 1439],
    ["14:00:00", 840],
  ])("%s son %i minutos", (hora, minutos) => {
    expect(minutosDe(hora)).toBe(minutos);
  });

  it.each(["24:00", "9:00", "12:60", "14:00:30", "", "mediodía"])("%j no es una hora", (hora) => {
    expect(minutosDe(hora)).toBeNull();
  });

  it("arma la hora de fin, incluida la medianoche", () => {
    expect(horaDe(545)).toBe("09:05");
    expect(horaDeFin("14:00", 90)).toBe("15:30");
    expect(horaDeFin("23:00:00", 60)).toBe("24:00");
  });

  it("una hora de la base con segundos no rompe la pantalla: se recorta", () => {
    expect(horaCorta("10:59:59")).toBe("10:59");
    expect(horaDeFin("10:59:59", 60)).toBe("11:59");
    expect(horaDeFin("10:00:00.000123", 30)).toBe("10:30");
  });
});

describe("leerEntero", () => {
  it.each([
    ["25000", 25000],
    ["25.000", 25000],
    ["25 000", 25000],
    [" 60 ", 60],
  ])("%j es %i", (valor, esperado) => {
    expect(leerEntero(valor)).toBe(esperado);
  });

  it.each(["", "25,5", "-10", "25k", "1e3", "1234567890", "25000.00", "25.5", "1.5", "2.50", "25.0000", ".500", "25..000", "25 00"])(
    "%j no es un entero válido",
    (valor) => {
      expect(leerEntero(valor)).toBeNull();
    },
  );

  it("un precio con decimales no se convierte en otro precio (25000.00 no son 2.500.000)", () => {
    expect(leerFranja(formulario({ ...PRESENCIAL, precio: "25000.00" }))).toEqual({
      ok: false,
      error: "Escribe el precio en pesos, sin decimales, por ejemplo 25000.",
    });
  });

  it("acepta millones con dos separadores", () => {
    expect(leerEntero("1.250.000")).toBe(1_250_000);
  });
});

describe("esEnlaceDeVideollamada", () => {
  it("acepta https con dominio", () => {
    expect(esEnlaceDeVideollamada("https://meet.google.com/abc-defg-hij")).toBe(true);
  });

  it.each(["http://meet.example.com/x", "meet.example.com", "https://localhost/x", "https://a b.com", "javascript:alert(1)", `https://x.co/${"a".repeat(500)}`])(
    "rechaza %j",
    (enlace) => {
      expect(esEnlaceDeVideollamada(enlace)).toBe(false);
    },
  );
});

describe("leerFranja (RN-30, RN-31, P-31)", () => {
  it("lee una franja presencial con el precio sin separadores, sin lugar (D-76: es de cada monitoría)", () => {
    expect(leerFranja(formulario(PRESENCIAL))).toEqual({
      ok: true,
      datos: { dia: 1, hora: "14:00", presencial: true, precio: 25000, duracionMin: 90 },
    });
  });

  it("lee una franja virtual sin enlace (D-76), aunque el formulario traiga uno", () => {
    expect(leerFranja(formulario({ ...VIRTUAL, lugar: "ignorado" }))).toEqual({
      ok: true,
      datos: { dia: 3, hora: "18:30", presencial: false, precio: 30000, duracionMin: 60 },
    });
  });

  it("ya no pide lugar ni enlace (D-76)", () => {
    expect(leerFranja(formulario({ ...PRESENCIAL, lugar: "" })).ok).toBe(true);
    expect(leerFranja(formulario({ ...VIRTUAL, enlace: "" })).ok).toBe(true);
  });

  it.each([
    ["sin día", { dia: "" }, "Elige el día de la semana."],
    ["con día 8", { dia: "8" }, "Elige el día de la semana."],
    ["sin hora", { hora: "" }, "Escribe la hora de inicio, por ejemplo 14:00."],
    ["sin duración", { duracion_min: "0" }, "Escribe la duración en minutos, por ejemplo 60."],
    ["que pasa la medianoche", { hora: "23:30", duracion_min: "60" }, "La franja debe terminar el mismo día: revisa la hora y la duración."],
    ["con precio cero", { precio: "0" }, "Escribe el precio en pesos, sin decimales, por ejemplo 25000."],
    ["con precio con decimales", { precio: "25000,50" }, "Escribe el precio en pesos, sin decimales, por ejemplo 25000."],
    ["sin modalidad", { modalidad: "" }, "Elige si es presencial o virtual."],
  ])("rechaza una franja %s", (_caso, cambios, error) => {
    expect(leerFranja(formulario({ ...PRESENCIAL, ...cambios }))).toEqual({ ok: false, error });
  });

  it("una franja que termina justo a la medianoche sí sirve", () => {
    expect(leerFranja(formulario({ ...PRESENCIAL, hora: "23:00", duracion_min: "60" })).ok).toBe(true);
  });
});

describe("leerCierre (P-30)", () => {
  const HOY = "2026-09-30";

  it("acepta hoy o una fecha futura", () => {
    expect(leerCierre(formulario({ cerrada_desde: HOY }), HOY)).toEqual({ ok: true, datos: { cerradaDesde: HOY } });
    expect(leerCierre(formulario({ cerrada_desde: "2026-10-15" }), HOY)).toEqual({ ok: true, datos: { cerradaDesde: "2026-10-15" } });
  });

  it("no cierra hacia atrás", () => {
    expect(leerCierre(formulario({ cerrada_desde: "2026-09-29" }), HOY)).toEqual({
      ok: false,
      error: "La franja se cierra desde hoy o desde una fecha futura.",
    });
  });

  it.each(["", "2026-02-30", "30/09/2026", "mañana"])("%j no es una fecha", (valor) => {
    expect(leerCierre(formulario({ cerrada_desde: valor }), HOY)).toEqual({ ok: false, error: "Elige la fecha desde la que se cierra." });
  });
});

describe("mensajeDeErrorDeFranja", () => {
  it("muestra tal cual los mensajes de las reglas de la base (P0001)", () => {
    expect(mensajeDeErrorDeFranja({ code: "P0001", message: "Se cruza con otra de tus franjas abiertas el mismo día." })).toBe(
      "Se cruza con otra de tus franjas abiertas el mismo día.",
    );
  });

  it("no muestra mensajes técnicos de otros errores", () => {
    expect(mensajeDeErrorDeFranja({ code: "23514", message: 'new row violates check constraint "franja_enlace_https"' })).toBe(
      "Revisa los datos de la franja: alguno no es válido.",
    );
    expect(mensajeDeErrorDeFranja({ code: "42501", message: "permission denied" })).toBe("No puedes hacer ese cambio en esta franja.");
    expect(mensajeDeErrorDeFranja({ code: "08006", message: "connection failure" })).toBe("No pudimos guardar la franja. Intenta de nuevo.");
    expect(mensajeDeErrorDeFranja(null)).toBe("No pudimos guardar la franja. Intenta de nuevo.");
  });
});

describe("repetición de la franja (D-94)", () => {
  const HOY = "2026-11-16"; // lunes

  it("sin fecha, el formulario de siempre: repetición nula", () => {
    expect(leerRepeticion(formulario({}), HOY)).toEqual({ ok: true, repeticion: null });
    expect(leerRepeticion(formulario({ fecha: "  ", repite: "una" }), HOY)).toEqual({ ok: true, repeticion: null });
  });

  it("solo ese día: cierra al día siguiente", () => {
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "una" }), HOY)).toEqual({
      ok: true,
      repeticion: { abiertaDesde: "2026-11-19", cerradaDesde: "2026-11-20", dia: 4 },
    });
  });

  it("sin fecha final es lo que se asume si no llega `repite`", () => {
    const esperado = { ok: true, repeticion: { abiertaDesde: "2026-11-19", cerradaDesde: null, dia: 4 } };
    expect(leerRepeticion(formulario({ fecha: "2026-11-19" }), HOY)).toEqual(esperado);
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "siempre" }), HOY)).toEqual(esperado);
  });

  it("cuatro jueves desde el 19 cierran el 11 de diciembre", () => {
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "semanas", semanas: "4" }), HOY)).toEqual({
      ok: true,
      repeticion: { abiertaDesde: "2026-11-19", cerradaDesde: "2026-12-11", dia: 4 },
    });
  });

  it("hoy sí vale; el día sale de la fecha (domingo es 7)", () => {
    expect(leerRepeticion(formulario({ fecha: HOY, repite: "una" }), HOY)).toMatchObject({ repeticion: { dia: 1 } });
    expect(leerRepeticion(formulario({ fecha: "2026-11-22", repite: "una" }), HOY)).toMatchObject({ repeticion: { dia: 7 } });
  });

  it("cruza el cambio de año", () => {
    expect(leerRepeticion(formulario({ fecha: "2026-12-28", repite: "semanas", semanas: "2" }), HOY)).toEqual({
      ok: true,
      repeticion: { abiertaDesde: "2026-12-28", cerradaDesde: "2027-01-05", dia: 1 },
    });
  });

  it("cruza el 29 de febrero de un año bisiesto", () => {
    expect(leerRepeticion(formulario({ fecha: "2028-02-29", repite: "una" }), HOY)).toEqual({
      ok: true,
      repeticion: { abiertaDesde: "2028-02-29", cerradaDesde: "2028-03-01", dia: 2 },
    });
    expect(leerRepeticion(formulario({ fecha: "2028-02-22", repite: "semanas", semanas: "2" }), HOY)).toMatchObject({
      repeticion: { cerradaDesde: "2028-03-01" },
    });
  });

  it("rechaza fechas que no existen y fechas pasadas", () => {
    for (const fecha of ["2027-02-29", "2026-13-01", "2026-11-31", "19/11/2026", "hoy"]) {
      expect(leerRepeticion(formulario({ fecha }), HOY).ok).toBe(false);
    }
    expect(leerRepeticion(formulario({ fecha: "2026-11-15" }), HOY)).toEqual({
      ok: false,
      error: "No puedes abrir una franja en una fecha que ya pasó.",
    });
  });

  it(`las semanas van de ${SEMANAS_MIN} a ${SEMANAS_MAX}`, () => {
    expect(SEMANAS_MIN).toBe(2);
    expect(SEMANAS_MAX).toBe(16);
    for (const semanas of ["", "1", "0", "17", "-3", "2.5", "dos"]) {
      expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "semanas", semanas }), HOY).ok).toBe(false);
    }
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "semanas", semanas: "16" }), HOY).ok).toBe(true);
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "semanas", semanas: "2" }), HOY).ok).toBe(true);
  });

  it("rechaza una repetición desconocida", () => {
    expect(leerRepeticion(formulario({ fecha: "2026-11-19", repite: "diario" }), HOY).ok).toBe(false);
  });

  it("lista las fechas concretas cuando hay cierre y ninguna cuando no", () => {
    expect(fechasDeLaRepeticion({ abiertaDesde: "2026-11-19", cerradaDesde: "2026-11-20", dia: 4 })).toEqual(["2026-11-19"]);
    expect(fechasDeLaRepeticion({ abiertaDesde: "2026-11-19", cerradaDesde: "2026-12-11", dia: 4 })).toEqual([
      "2026-11-19",
      "2026-11-26",
      "2026-12-03",
      "2026-12-10",
    ]);
    expect(fechasDeLaRepeticion({ abiertaDesde: "2026-12-28", cerradaDesde: "2027-01-05", dia: 1 })).toEqual(["2026-12-28", "2027-01-04"]);
    expect(fechasDeLaRepeticion({ abiertaDesde: "2028-02-22", cerradaDesde: "2028-03-01", dia: 2 })).toEqual(["2028-02-22", "2028-02-29"]);
    expect(fechasDeLaRepeticion({ abiertaDesde: "2026-11-19", cerradaDesde: null, dia: 4 })).toEqual([]);
  });

  it("16 semanas dan 16 fechas", () => {
    const r = leerRepeticion(formulario({ fecha: "2026-11-19", repite: "semanas", semanas: "16" }), HOY);
    if (!r.ok || !r.repeticion) throw new Error("debía leerse");
    expect(fechasDeLaRepeticion(r.repeticion)).toHaveLength(16);
  });
});
