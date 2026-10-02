import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Cita } from "@/lib/citas/reglas";
import { ListaDeCitas } from "./ListaDeCitas";

// "Mis citas" (HU-019, criterio 4): se lee el HTML sin navegador. Con sesión real lo cubre e2e/cita.spec.ts.

const HORA = 3_600_000;
const INICIO = new Date("2026-10-07T15:00:00.000Z"); // 10:00 a. m. en Bogotá
const AHORA = new Date("2026-10-05T15:00:00.000Z");

const CITA: Cita = {
  idMonitoria: "5a5a5a5a-0000-4000-8000-000000000019",
  estado: "confirmada",
  motivoCancelacion: null,
  nombreMonitor: "Laura Gómez",
  nombreMateria: "Cálculo Diferencial",
  codigoMateria: "MATE-1203",
  fecha: "2026-10-07",
  hora: "10:00:00",
  duracionMin: 60,
  presencial: true,
  valorTotal: 32_000,
  lugar: "Edificio Santo Domingo, salón 301",
  enlace: null,
  inicio: INICIO,
  finProgramado: new Date(INICIO.getTime() + HORA),
  cancelableHasta: new Date(INICIO.getTime() - 12 * HORA),
  reporteHasta: new Date(INICIO.getTime() + 25 * HORA),
  estadoPago: "en_revision",
  estadoReembolso: null,
  estadoReporte: null,
};

const pintar = (citas: Cita[], ahora: Date = AHORA) => renderToStaticMarkup(createElement(ListaDeCitas, { citas, ahora }));

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\xa0 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1");

describe("ListaDeCitas (HU-019, criterio 4, D-24): sin citas", () => {
  const html = pintar([]);

  it("explica cómo abrir una cita agendada desde otro dispositivo", () => {
    expect(texto(html)).toContain("Mis citas");
    expect(texto(html)).toContain("No tienes citas en este navegador. Si agendaste desde otro dispositivo, abre el enlace del correo de confirmación.");
    expect(html).toMatch(/<a[^>]*href="\/monitores"[^>]*>Ver monitores<\/a>/);
    expect(html).not.toContain("<ul");
  });
});

describe("ListaDeCitas (HU-019, criterio 4, D-24): con citas", () => {
  const otra: Cita = {
    ...CITA,
    idMonitoria: "5a5a5a5a-0000-4000-8000-000000000020",
    estado: "cancelada",
    motivoCancelacion: "estudiante",
    nombreMateria: "Física Mecánica",
    nombreMonitor: "Camilo Ruiz",
    fecha: "2026-09-30",
    hora: "14:30:00",
    duracionMin: 90,
  };
  const html = pintar([CITA, otra]);

  it("lista una tarjeta por cita, cada una con un enlace a su detalle", () => {
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toMatch(/<a[^>]*href="\/cita\/5a5a5a5a-0000-4000-8000-000000000019"/);
    expect(html).toMatch(/<a[^>]*href="\/cita\/5a5a5a5a-0000-4000-8000-000000000020"/);
  });

  it("dice materia, monitor, día y hora, y cómo va cada una", () => {
    const t = texto(html);
    expect(t).toContain("Cálculo Diferencial Con Laura Gómez Miércoles, 7 de octubre, 10:00 a 11:00 Confirmada");
    expect(t).toContain("Física Mecánica Con Camilo Ruiz Miércoles, 30 de septiembre, 14:30 a 16:00 Cancelada");
  });

  it("no muestra lugar, enlace de la videollamada, valor ni contacto: eso es del detalle", () => {
    const t = texto(html);
    for (const ausente of ["Santo Domingo", "videollamada", "32.000", "comisi"]) expect(t).not.toContain(ausente);
  });
});

describe("ListaDeCitas: la etiqueta según el momento", () => {
  const etiqueta = (cita: Cita, ahora: Date) => /(Confirmada|En curso|Terminó|Realizada|Cancelada)<\/span>/.exec(pintar([cita], ahora))?.[1];

  it("confirmada antes de empezar, en curso al empezar y terminó al acabar", () => {
    expect(etiqueta(CITA, AHORA)).toBe("Confirmada");
    expect(etiqueta(CITA, INICIO)).toBe("En curso");
    expect(etiqueta(CITA, new Date(CITA.finProgramado.getTime() + 1))).toBe("Terminó");
  });

  it("realizada", () => {
    expect(etiqueta({ ...CITA, estado: "realizada" }, new Date(INICIO.getTime() + 2 * HORA))).toBe("Realizada");
  });
});
