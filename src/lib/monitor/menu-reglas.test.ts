import { describe, expect, it } from "vitest";
import { SECCIONES_DEL_MENU, seccionActual, seccionesPara } from "./menu-reglas";

describe("SECCIONES_DEL_MENU", () => {
  it("lleva las cuatro secciones, en orden y sin repetir rutas; «Franjas» ya no está (D-94 c)", () => {
    expect(SECCIONES_DEL_MENU.map((s) => s.etiqueta)).toEqual(["Inicio", "Agenda", "Pagos", "Perfil"]);
    expect(new Set(SECCIONES_DEL_MENU.map((s) => s.href)).size).toBe(4);
  });
});

describe("seccionesPara", () => {
  it("con certificados deja las cuatro", () => {
    expect(seccionesPara(true).map((s) => s.href)).toEqual([
      "/monitor",
      "/monitor/agenda",
      "/monitor/desembolsos",
      "/monitor/perfil",
    ]);
  });

  it("sin certificados deja solo Inicio y Perfil", () => {
    expect(seccionesPara(false).map((s) => s.etiqueta)).toEqual(["Inicio", "Perfil"]);
  });
});

describe("seccionActual", () => {
  it.each(SECCIONES_DEL_MENU.map((s) => [s.href]))("marca %s en su propia ruta", (href) => {
    expect(seccionActual(href)).toBe(href);
  });

  it("cuenta una subruta como su sección", () => {
    expect(seccionActual("/monitor/agenda/123")).toBe("/monitor/agenda");
    expect(seccionActual("/monitor/perfil/llave")).toBe("/monitor/perfil");
  });

  it("las franjas y sus subrutas dejan marcado Inicio", () => {
    expect(seccionActual("/monitor/franjas")).toBe("/monitor");
    expect(seccionActual("/monitor/franjas/")).toBe("/monitor");
    expect(seccionActual("/monitor/franjas/nueva")).toBe("/monitor");
    expect(seccionActual("/monitor/franjas/0b3c1f64-0000-4000-8000-000000000001")).toBe("/monitor");
    expect(seccionActual("/monitor/franjasX")).toBeNull();
  });

  it("ignora la barra final", () => {
    expect(seccionActual("/monitor/")).toBe("/monitor");
    expect(seccionActual("/monitor/agenda/")).toBe("/monitor/agenda");
  });

  it("no confunde rutas que solo comparten el comienzo", () => {
    expect(seccionActual("/monitor/agendaX")).toBeNull();
    expect(seccionActual("/monitor/perfilX/1")).toBeNull();
    expect(seccionActual("/monitores/registro")).toBeNull();
  });

  it("no marca Inicio en una ruta desconocida bajo /monitor", () => {
    expect(seccionActual("/monitor/desconocida")).toBeNull();
  });

  it("no marca nada fuera del panel o sin ruta", () => {
    expect(seccionActual("/")).toBeNull();
    expect(seccionActual("/admin")).toBeNull();
    expect(seccionActual(null)).toBeNull();
    expect(seccionActual(undefined)).toBeNull();
    expect(seccionActual("")).toBeNull();
  });
});
