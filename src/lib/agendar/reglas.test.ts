import { describe, expect, it } from "vitest";
import { inicioDeSesion } from "@/lib/plazos/motor";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import {
  esFechaDeCalendario,
  esResultadoDeAgendar,
  leerPedidoDeAgendar,
  MENSAJES,
  requiereAvisoSinCancelacion,
  rutaDeAgendar,
  rutaDeContactoParaAgendar,
  rutaDeReserva,
  RESULTADOS,
} from "./reglas";
import { rutaSiguiente } from "@/lib/leads/reglas";

const FRANJA = "0f8b2c1e-4a5d-4c3b-9e2f-1a2b3c4d5e6f";

describe("leerPedidoDeAgendar (HU-017)", () => {
  it("lee la franja, la fecha y la materia del enlace", () => {
    expect(leerPedidoDeAgendar({ franja: FRANJA, fecha: "2026-10-05", materia: " MATE-1214 " })).toEqual({
      idFranja: FRANJA,
      fecha: "2026-10-05",
      codigoMateria: "MATE-1214",
    });
  });

  it("con varios valores toma el primero y normaliza el uuid a minúsculas", () => {
    expect(leerPedidoDeAgendar({ franja: [FRANJA.toUpperCase(), "otro"], fecha: ["2026-10-05"], materia: ["FISI-1018"] })).toEqual({
      idFranja: FRANJA,
      fecha: "2026-10-05",
      codigoMateria: "FISI-1018",
    });
  });

  it.each([
    ["sin franja", { fecha: "2026-10-05", materia: "MATE-1214" }],
    ["franja que no es uuid", { franja: "123", fecha: "2026-10-05", materia: "MATE-1214" }],
    ["sin fecha", { franja: FRANJA, materia: "MATE-1214" }],
    ["fecha que no existe", { franja: FRANJA, fecha: "2026-02-30", materia: "MATE-1214" }],
    ["fecha con hora", { franja: FRANJA, fecha: "2026-10-05T10:00", materia: "MATE-1214" }],
    ["sin materia", { franja: FRANJA, fecha: "2026-10-05", materia: "  " }],
    ["materia demasiado larga", { franja: FRANJA, fecha: "2026-10-05", materia: "M".repeat(51) }],
    ["materia con caracteres de control", { franja: FRANJA, fecha: "2026-10-05", materia: "MATE\n1214" }],
  ])("%s da null", (_caso, valores) => {
    expect(leerPedidoDeAgendar(valores)).toBeNull();
  });
});

describe("esFechaDeCalendario", () => {
  it("acepta días que existen, bisiestos incluidos, y rechaza los demás", () => {
    expect(esFechaDeCalendario("2028-02-29")).toBe(true);
    expect(esFechaDeCalendario("2026-02-29")).toBe(false);
    expect(esFechaDeCalendario("2026-13-01")).toBe(false);
    expect(esFechaDeCalendario("5/10/2026")).toBe(false);
  });
});

describe("rutas de agendar", () => {
  const pedido = { idFranja: FRANJA, fecha: "2026-10-05", codigoMateria: "A&B C" };

  it("la de confirmar lleva la franja, la fecha y la materia escapadas, y se lee igual", () => {
    const ruta = rutaDeAgendar(pedido);
    expect(ruta).toBe(`/agendar?franja=${FRANJA}&fecha=2026-10-05&materia=A%26B+C`);
    const consulta = new URL(ruta, "https://calibra.invalid").searchParams;
    expect(leerPedidoDeAgendar(Object.fromEntries(consulta))).toEqual(pedido);
  });

  it("la del contacto vuelve a confirmar la misma fecha, y HU-068 la acepta como destino interno", () => {
    const ruta = rutaDeContactoParaAgendar(pedido);
    const siguiente = new URL(ruta, "https://calibra.invalid").searchParams.get("siguiente");
    expect(ruta.startsWith("/agendar/contacto?siguiente=")).toBe(true);
    expect(siguiente).toBe(rutaDeAgendar(pedido));
    expect(rutaSiguiente(siguiente)).toBe(rutaDeAgendar(pedido));
  });

  it("la de la reserva lleva su id", () => {
    expect(rutaDeReserva(FRANJA)).toBe(`/agendar/reserva/${FRANJA}`);
  });
});

describe("requiereAvisoSinCancelacion (RN-37, P-40, D-10)", () => {
  const p = { cancelacionIndividualMin: 720 } as ParametrosNegocio;
  // Lunes 5 de octubre de 2026 a las 10:00 en Bogotá = 15:00 UTC.
  const inicio = inicioDeSesion("2026-10-05", "10:00:00");

  it("con 12 h exactas todavía se puede cancelar: no hay aviso", () => {
    expect(requiereAvisoSinCancelacion(inicio, new Date("2026-10-05T03:00:00Z"), p)).toBe(false);
  });

  it("un segundo después ya no se podrá cancelar: hay aviso", () => {
    expect(requiereAvisoSinCancelacion(inicio, new Date("2026-10-05T03:00:01Z"), p)).toBe(true);
  });

  it("con días de antelación no hay aviso", () => {
    expect(requiereAvisoSinCancelacion(inicio, new Date("2026-10-01T15:00:00Z"), p)).toBe(false);
  });
});

describe("resultados de la base", () => {
  it("reconoce los de public.agendar_monitoria y nada más", () => {
    for (const r of RESULTADOS) expect(esResultadoDeAgendar(r)).toBe(true);
    expect(esResultadoDeAgendar("otro")).toBe(false);
    expect(esResultadoDeAgendar(null)).toBe(false);
  });

  it("cada resultado que no aparta la fecha tiene su mensaje", () => {
    for (const r of RESULTADOS.filter((r) => !["agendada", "ya_agendada", "no_es_lead"].includes(r))) {
      expect(MENSAJES[r as keyof typeof MENSAJES]).toMatch(/\S/);
    }
  });
});
