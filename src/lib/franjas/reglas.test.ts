import { describe, expect, it } from "vitest";
import {
  esEnlaceDeVideollamada,
  horaDe,
  horaDeFin,
  leerCierre,
  leerEntero,
  leerFranja,
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

  it.each(["", "25,5", "-10", "25k", "1e3", "1234567890"])("%j no es un entero válido", (valor) => {
    expect(leerEntero(valor)).toBeNull();
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
  it("lee una franja presencial: precio sin separadores y lugar limpio", () => {
    expect(leerFranja(formulario(PRESENCIAL))).toEqual({
      ok: true,
      datos: { dia: 1, hora: "14:00", presencial: true, precio: 25000, duracionMin: 90, lugar: "Edificio ML, salón 101", enlace: null },
    });
  });

  it("lee una franja virtual con su enlace, sin lugar", () => {
    expect(leerFranja(formulario({ ...VIRTUAL, lugar: "ignorado" }))).toEqual({
      ok: true,
      datos: { dia: 3, hora: "18:30", presencial: false, precio: 30000, duracionMin: 60, lugar: null, enlace: "https://meet.example.com/abc-defg" },
    });
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
    ["presencial sin lugar", { lugar: "   " }, "Escribe el lugar de la sesión, por ejemplo el salón o el edificio."],
    ["con un lugar demasiado largo", { lugar: "x".repeat(201) }, "El lugar es demasiado largo."],
  ])("rechaza una franja %s", (_caso, cambios, error) => {
    expect(leerFranja(formulario({ ...PRESENCIAL, ...cambios }))).toEqual({ ok: false, error });
  });

  it("una franja que termina justo a la medianoche sí sirve", () => {
    expect(leerFranja(formulario({ ...PRESENCIAL, hora: "23:00", duracion_min: "60" })).ok).toBe(true);
  });

  it("una virtual necesita un enlace https", () => {
    expect(leerFranja(formulario({ ...VIRTUAL, enlace: "http://meet.example.com/x" }))).toEqual({
      ok: false,
      error: "Escribe el enlace de la videollamada completo, que empiece por https://.",
    });
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
