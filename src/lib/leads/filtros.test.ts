import { describe, expect, it } from "vitest";
import { direccionDeDescarga, direccionDeLeads, leerFiltrosDeLeads, SIN_ORIGEN } from "./filtros";

const MATERIAS = ["MAT1", "FIS2"];

describe("leerFiltrosDeLeads", () => {
  it("sin parámetros: todo en «Todos», contacto si y página 1", () => {
    expect(leerFiltrosDeLeads({}, MATERIAS)).toEqual({
      estado: null,
      origen: null,
      materia: null,
      contacto: "si",
      pagina: 1,
    });
  });

  it("acepta valores válidos", () => {
    expect(
      leerFiltrosDeLeads(
        { estado: "contactado", origen: "tiktok_oct", materia: "FIS2", contacto: "todos", pagina: "3" },
        MATERIAS,
      ),
    ).toEqual({ estado: "contactado", origen: "tiktok_oct", materia: "FIS2", contacto: "todos", pagina: 3 });
    expect(leerFiltrosDeLeads({ contacto: "no" }, MATERIAS).contacto).toBe("no");
  });

  it("ignora lo desconocido", () => {
    const f = leerFiltrosDeLeads({ estado: "x", materia: "NOEXISTE", contacto: "quizas" }, MATERIAS);
    expect(f).toMatchObject({ estado: null, materia: null, contacto: "si" });
  });

  it("toma el primero de un valor repetido", () => {
    const f = leerFiltrosDeLeads({ estado: ["descartado", "nuevo"], contacto: ["no", "si"], pagina: ["2", "5"] }, MATERIAS);
    expect(f).toMatchObject({ estado: "descartado", contacto: "no", pagina: 2 });
  });

  it("acepta SIN_ORIGEN y rechaza orígenes con caracteres inválidos", () => {
    expect(leerFiltrosDeLeads({ origen: SIN_ORIGEN }, MATERIAS).origen).toBe(SIN_ORIGEN);
    expect(leerFiltrosDeLeads({ origen: "a b" }, MATERIAS).origen).toBeNull();
    expect(leerFiltrosDeLeads({ origen: "<x>" }, MATERIAS).origen).toBeNull();
    expect(leerFiltrosDeLeads({ origen: "~~" }, MATERIAS).origen).toBeNull();
  });

  it("la página fuera de rango o no numérica es la primera", () => {
    for (const pagina of ["0", "-2", "abc", "1.5", "9999999", ""]) {
      expect(leerFiltrosDeLeads({ pagina }, MATERIAS).pagina).toBe(1);
    }
  });
});

describe("direccionDeLeads", () => {
  it("sin filtros es la lista simple", () => {
    expect(direccionDeLeads({})).toBe("/admin/leads");
    expect(direccionDeLeads({ contacto: "si", pagina: 1 })).toBe("/admin/leads");
  });

  it("arma los filtros en orden fijo y omite lo nulo", () => {
    expect(
      direccionDeLeads({ pagina: 2, contacto: "todos", materia: "MAT1", origen: SIN_ORIGEN, estado: "nuevo" }),
    ).toBe("/admin/leads?estado=nuevo&origen=%7E&materia=MAT1&contacto=todos&pagina=2");
    expect(direccionDeLeads({ estado: null, contacto: "no" })).toBe("/admin/leads?contacto=no");
  });

  it("es estable en la ida y vuelta", () => {
    const entradas = [
      {},
      { estado: "contactado", contacto: "no" },
      { origen: SIN_ORIGEN, materia: "FIS2", pagina: "4" },
      { estado: "descartado", origen: "tiktok_oct", materia: "MAT1", contacto: "todos", pagina: "2" },
    ];
    for (const entrada of entradas) {
      const filtros = leerFiltrosDeLeads(entrada, MATERIAS);
      const direccion = direccionDeLeads(filtros);
      const consulta = Object.fromEntries(new URL(direccion, "http://x").searchParams);
      expect(leerFiltrosDeLeads(consulta, MATERIAS)).toEqual(filtros);
      expect(direccionDeLeads(leerFiltrosDeLeads(consulta, MATERIAS))).toBe(direccion);
    }
  });
});

describe("direccionDeDescarga", () => {
  it("lleva estado, origen y materia, sin contacto ni página", () => {
    const filtros = { estado: "nuevo", origen: "tiktok_oct", materia: "MAT1", contacto: "no", pagina: 3 } as const;
    const direccion = direccionDeDescarga(filtros);
    expect(direccion).toBe("/admin/leads/exportar?estado=nuevo&origen=tiktok_oct&materia=MAT1");
    expect(direccion).not.toContain("contacto");
    expect(direccion).not.toContain("pagina");
  });

  it("sin filtros es la ruta simple", () => {
    expect(direccionDeDescarga({ estado: null, origen: null, materia: null })).toBe("/admin/leads/exportar");
  });
});
