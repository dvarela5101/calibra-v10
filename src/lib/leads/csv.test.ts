import { describe, expect, it } from "vitest";
import { ENCABEZADOS_CSV, csvDeLeads, nombreDelArchivoCsv, type LeadParaCsv } from "./csv";

const ENCABEZADO = "Nombre;Correo;Teléfono;Estado;Origen;Materias;Dejó su contacto";

function lead(cambios: Partial<LeadParaCsv> = {}): LeadParaCsv {
  return {
    nombre: "Ana",
    correo: "ana@correo.co",
    telefono: "+573001234567",
    estado: "nuevo",
    origen: "landing",
    materias: ["Cálculo"],
    fechaCreacion: new Date("2026-10-05T15:30:00Z"),
    ...cambios,
  };
}

/** Las filas de datos (sin BOM ni encabezado ni la línea vacía final). */
function filas(csv: string): string[] {
  return csv.slice(1).split("\r\n").slice(1, -1);
}

describe("csvDeLeads", () => {
  it("empieza con BOM y los encabezados, y cierra cada fila con CRLF", () => {
    const csv = csvDeLeads([lead()]);
    expect(csv.startsWith("﻿" + ENCABEZADO + "\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toHaveLength(3);
    expect(csv).not.toMatch(/(?<!\r)\n/);
    expect(ENCABEZADOS_CSV).toHaveLength(7);
  });

  it("sin leads trae solo el BOM y los encabezados", () => {
    expect(csvDeLeads([])).toBe("﻿" + ENCABEZADO + "\r\n");
  });

  it("escribe la fila completa", () => {
    expect(filas(csvDeLeads([lead()]))).toEqual(["Ana;ana@correo.co;+573001234567;Nuevo;landing;Cálculo;2026-10-05 10:30"]);
  });

  it("deja la coma sin comillas y encierra el punto y coma", () => {
    expect(filas(csvDeLeads([lead({ nombre: "Pérez, Ana" })]))[0]).toMatch(/^Pérez, Ana;/);
    expect(filas(csvDeLeads([lead({ nombre: "Ana;Pérez" })]))[0]).toMatch(/^"Ana;Pérez";/);
  });

  it("duplica las comillas y encierra el campo", () => {
    expect(filas(csvDeLeads([lead({ nombre: 'Ana "la Mona" Pérez' })]))[0]).toMatch(/^"Ana ""la Mona"" Pérez";/);
  });

  it("encierra los saltos de línea del nombre", () => {
    const csv = csvDeLeads([lead({ nombre: "Ana\nPérez" })]);
    expect(csv).toContain('"Ana\nPérez";ana@correo.co');
  });

  it.each([
    ["=", "=1+1"],
    ["+", "+1"],
    ["-", "-2"],
    ["@", "@SUMA(A1)"],
    ["tab", "\tx"],
    ["CR", "\rx"],
  ])("antepone comilla simple al prefijo %s en nombre y origen", (_n, valor) => {
    const csv = csvDeLeads([lead({ nombre: valor, origen: valor })]);
    const esperado = ["\r", "\n"].some((c) => valor.includes(c)) ? `"'${valor}"` : `'${valor}`;
    expect(csv).toContain(`${esperado};ana@correo.co;`);
    expect(csv).toContain(`;Nuevo;${esperado};Cálculo;`);
  });

  it("deja el teléfono internacional tal cual", () => {
    expect(filas(csvDeLeads([lead({ telefono: "+573001234567" })]))[0].split(";")[2]).toBe("+573001234567");
  });

  it("neutraliza el teléfono que no calza con el formato internacional", () => {
    expect(filas(csvDeLeads([lead({ telefono: "+57 300" })]))[0].split(";")[2]).toBe("'+57 300");
    expect(filas(csvDeLeads([lead({ telefono: "=1+1" })]))[0].split(";")[2]).toBe("'=1+1");
  });

  it("deja vacías las celdas de correo, teléfono y origen nulos", () => {
    expect(filas(csvDeLeads([lead({ correo: null, telefono: null, origen: null })]))).toEqual(["Ana;;;Nuevo;;Cálculo;2026-10-05 10:30"]);
  });

  it("une varias materias con ' / ' y usa la etiqueta del estado", () => {
    const fila = filas(csvDeLeads([lead({ materias: ["Cálculo", "Física"], estado: "contactado" })]))[0];
    expect(fila).toContain(";Contactado;");
    expect(fila).toContain(";Cálculo / Física;");
  });

  it("escribe la fecha en la hora de Bogotá", () => {
    // 02:30 UTC del 6 de octubre son las 21:30 del 5 en Bogotá.
    expect(filas(csvDeLeads([lead({ fechaCreacion: new Date("2026-10-06T02:30:00Z") })]))[0]).toMatch(/;2026-10-05 21:30$/);
    // 05:00 UTC es la medianoche de Bogotá: 00:00 y no 24:00.
    expect(filas(csvDeLeads([lead({ fechaCreacion: new Date("2026-10-06T05:00:00Z") })]))[0]).toMatch(/;2026-10-06 00:00$/);
  });
});

describe("nombreDelArchivoCsv", () => {
  it("usa el día de Bogotá", () => {
    expect(nombreDelArchivoCsv(new Date("2026-10-06T02:00:00Z"))).toBe("leads-para-contactar-2026-10-05.csv");
    expect(nombreDelArchivoCsv(new Date("2026-10-06T15:00:00Z"))).toBe("leads-para-contactar-2026-10-06.csv");
  });
});
