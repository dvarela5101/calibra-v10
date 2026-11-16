import { describe, expect, it } from "vitest";
import { SECCIONES_DEL_MENU, seccionActual } from "./menu-reglas";

describe("SECCIONES_DEL_MENU", () => {
  it("lleva las nueve secciones, en orden y sin repetir rutas", () => {
    expect(SECCIONES_DEL_MENU.map((s) => s.etiqueta)).toEqual([
      "Bandeja",
      "Citas",
      "Monitores",
      "Certificados",
      "Materias",
      "Franjas",
      "Solicitudes",
      "Leads",
      "Equipo",
    ]);
    expect(new Set(SECCIONES_DEL_MENU.map((s) => s.href)).size).toBe(9);
  });
});

describe("seccionActual", () => {
  it.each(SECCIONES_DEL_MENU.map((s) => [s.href]))("marca %s en su propia ruta", (href) => {
    expect(seccionActual(href)).toBe(href);
  });

  it("cuenta una subruta como su sección", () => {
    expect(seccionActual("/admin/citas/123")).toBe("/admin/citas");
    expect(seccionActual("/admin/materias/abc/evaluaciones")).toBe("/admin/materias");
    expect(seccionActual("/admin/leads/exportar")).toBe("/admin/leads");
  });

  it("marca la bandeja en las páginas que se abren desde ella", () => {
    for (const ruta of ["/admin/pagos/1", "/admin/reembolsos/2", "/admin/desembolsos/3", "/admin/reportes/4"]) {
      expect(seccionActual(ruta)).toBe("/admin");
    }
  });

  it("ignora la barra final", () => {
    expect(seccionActual("/admin/")).toBe("/admin");
    expect(seccionActual("/admin/citas/")).toBe("/admin/citas");
  });

  it("no confunde rutas que solo comparten el comienzo", () => {
    expect(seccionActual("/admin/citasX")).toBeNull();
    expect(seccionActual("/admin/pagosX/1")).toBeNull();
    expect(seccionActual("/administrador")).toBeNull();
  });

  it("no marca nada fuera del panel o sin ruta", () => {
    expect(seccionActual("/")).toBeNull();
    expect(seccionActual("/monitor")).toBeNull();
    expect(seccionActual("/admins/registro")).toBeNull();
    expect(seccionActual("/admin/desconocida")).toBeNull();
    expect(seccionActual(null)).toBeNull();
    expect(seccionActual(undefined)).toBeNull();
    expect(seccionActual("")).toBeNull();
  });
});
