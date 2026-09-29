import { describe, expect, it } from "vitest";
import { describirTiempoRestante } from "./restante";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const LIMITE = new Date("2026-10-05T15:00:00.000Z");
const antes = (ms: number) => new Date(LIMITE.getTime() - ms);
const despues = (ms: number) => new Date(LIMITE.getTime() + ms);

describe("describirTiempoRestante: lo que falta", () => {
  it.each([
    [42 * MINUTO, "Quedan 42 min"],
    [HORA, "Quedan 1 h"],
    [HORA + 5 * MINUTO, "Quedan 1 h 5 min"],
    [3 * HORA + 30 * MINUTO, "Quedan 3 h 30 min"],
    [23 * HORA + 59 * MINUTO, "Quedan 23 h 59 min"],
    [DIA, "Quedan 1 d"],
    [DIA + 2 * HORA, "Quedan 1 d 2 h"],
    [3 * DIA + 5 * HORA + 40 * MINUTO, "Quedan 3 d 5 h"],
    [MINUTO, "Quedan 1 min"],
  ])("faltan %i ms: %s", (falta, texto) => {
    expect(describirTiempoRestante(LIMITE, antes(falta))).toEqual({ texto, vencido: false });
  });

  it("el minuto incompleto no se redondea hacia arriba", () => {
    expect(describirTiempoRestante(LIMITE, antes(59 * MINUTO + 59_999)).texto).toBe("Quedan 59 min");
    expect(describirTiempoRestante(LIMITE, antes(59_999)).texto).toBe("Queda menos de 1 min");
  });
});

describe("describirTiempoRestante: el borde es inclusivo (P-40)", () => {
  it("con ahora igual al límite todavía queda tiempo: no está vencido", () => {
    expect(describirTiempoRestante(LIMITE, LIMITE)).toEqual({ texto: "Queda menos de 1 min", vencido: false });
  });

  it("un milisegundo después ya venció", () => {
    expect(describirTiempoRestante(LIMITE, despues(1))).toEqual({ texto: "Venció hace menos de 1 min", vencido: true });
  });

  it("un minuto antes, en el borde y un minuto después", () => {
    expect([-MINUTO, 0, MINUTO].map((desfase) => describirTiempoRestante(LIMITE, despues(desfase)).vencido)).toEqual([false, false, true]);
  });
});

describe("describirTiempoRestante: lo vencido", () => {
  it.each([
    [MINUTO, "Vencido hace 1 min"],
    [12 * MINUTO, "Vencido hace 12 min"],
    [HORA + 5 * MINUTO, "Vencido hace 1 h 5 min"],
    [2 * DIA + 3 * HORA, "Vencido hace 2 d 3 h"],
  ])("venció hace %i ms: %s", (hace, texto) => {
    expect(describirTiempoRestante(LIMITE, despues(hace))).toEqual({ texto, vencido: true });
  });
});

describe("describirTiempoRestante: entradas inválidas", () => {
  it("rechaza fechas inválidas en vez de mostrar NaN", () => {
    expect(() => describirTiempoRestante(new Date(Number.NaN), LIMITE)).toThrow(/limite/);
    expect(() => describirTiempoRestante(LIMITE, new Date(Number.NaN))).toThrow(/ahora/);
  });
});
