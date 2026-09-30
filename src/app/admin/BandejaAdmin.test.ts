import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bandeja, PagoPorRevisar } from "@/lib/admin/bandeja";
import { BandejaAdmin } from "./BandejaAdmin";

// Sin navegador ni base: se pinta la pantalla con una bandeja inventada y se lee el HTML. Lo que
// necesita datos reales (orden, estados, políticas) lo cubren integracion/bandeja.test.ts y
// e2e/bandeja.spec.ts.

const VACIA: Bandeja = {
  pagos: [],
  reembolsos: { esperandoLlave: [], pendientes: [] },
  reportes: [],
  desembolsos: [],
  correosSinEnviar: [],
  contadores: { pagos: 0, reembolsos: 0, reembolsosEsperandoLlave: 0, reembolsosPendientes: 0, reportes: 0, desembolsos: 0, correosSinEnviar: 0 },
};

const pintar = (bandeja: Bandeja) => renderToStaticMarkup(createElement(BandejaAdmin, { bandeja }));
/** El texto visible: sin etiquetas, con los espacios duros y los repetidos normalizados. */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\xa0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const pago = (n: number, extra: Partial<PagoPorRevisar> = {}): PagoPorRevisar => ({
  id: `pago-${n}`,
  nombrePagador: `Pagador ${n}`,
  monto: 25_000,
  revisionHasta: new Date("2026-10-05T15:00:00.000Z"),
  restante: { texto: "Quedan 30 min", vencido: false },
  ...extra,
});

describe("BandejaAdmin: secciones vacías", () => {
  it("cada sección dice que no hay nada en vez de quedar en blanco", () => {
    const t = texto(pintar(VACIA));
    expect(t).toContain("No tienes pagos por revisar.");
    expect(t).toContain("No tienes reembolsos por atender.");
    expect(t).toContain("No tienes reportes en revisión.");
    expect(t).toContain("No hay desembolsos listos para ejecutar.");
    expect(t).toContain("Todos los correos salieron.");
  });

  it("los cinco contadores están arriba, en un nav con nombre, y cada uno lleva a su sección", () => {
    const html = pintar({
      ...VACIA,
      contadores: { ...VACIA.contadores, pagos: 3, reembolsos: 2, reportes: 1, desembolsos: 5, correosSinEnviar: 4 },
    });
    expect(html).toContain('<nav aria-label="Resumen de tu bandeja">');
    for (const [id, cifra, rotulo] of [
      ["pagos", 3, "Pagos por revisar"],
      ["reembolsos", 2, "Reembolsos"],
      ["reportes", 1, "Reportes en revisión"],
      ["desembolsos", 5, "Desembolsos ejecutables"],
      ["correos", 4, "Correos que no salieron"],
    ] as const) {
      expect(html).toMatch(new RegExp(`<a href="#${id}"[^>]*><span[^>]*>${cifra}</span><span[^>]*>${rotulo}</span></a>`));
      expect(html).toContain(`<section id="${id}" aria-labelledby="${id}-titulo"`);
    }
  });
});

describe("BandejaAdmin: el corte de las listas", () => {
  it("avisa cuando la lista no muestra todo, con cuántos muestra y cuántos hay", () => {
    const pagos = Array.from({ length: 100 }, (_, i) => pago(i));
    const t = texto(pintar({ ...VACIA, pagos, contadores: { ...VACIA.contadores, pagos: 101 } }));
    expect(t).toContain("Pagos por revisar (101)");
    expect(t).toContain("Se muestran los primeros 100 de 101.");
  });

  it("no avisa cuando la lista lo muestra todo", () => {
    const t = texto(pintar({ ...VACIA, pagos: [pago(1), pago(2)], contadores: { ...VACIA.contadores, pagos: 2 } }));
    expect(t).not.toContain("Se muestran los primeros");
  });

  it("cada estado de reembolso avisa su propio corte", () => {
    const filas = (n: number, prefijo: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefijo}${i}`, monto: 25_000, motivo: "Cancelación" }));
    const t = texto(
      pintar({
        ...VACIA,
        reembolsos: { esperandoLlave: filas(3, "e"), pendientes: filas(2, "p") },
        contadores: { ...VACIA.contadores, reembolsos: 9, reembolsosEsperandoLlave: 7, reembolsosPendientes: 2 },
      }),
    );
    expect(t).toContain("Esperando la llave del pagador (7)");
    expect(t).toContain("Se muestran los primeros 3 de 7.");
    expect(t).toContain("Listos para transferir (2)");
    expect(t).not.toContain("Se muestran los primeros 2 de 2");
  });
});

describe("BandejaAdmin: reembolsos por estado", () => {
  const reembolso = { id: "r", monto: 25_000, motivo: "Cancelación a tiempo" };

  it("con solo reembolsos listos, el otro estado dice que ninguno espera la llave", () => {
    const t = texto(
      pintar({
        ...VACIA,
        reembolsos: { esperandoLlave: [], pendientes: [reembolso] },
        contadores: { ...VACIA.contadores, reembolsos: 1, reembolsosPendientes: 1 },
      }),
    );
    expect(t).toContain("Esperando la llave del pagador (0)");
    expect(t).toContain("Ninguno espera una llave.");
    expect(t).toContain("Listos para transferir (1)");
    expect(t).not.toContain("Ninguno está listo para transferir.");
  });

  it("con solo reembolsos que esperan la llave, el otro estado dice que ninguno está listo", () => {
    const t = texto(
      pintar({
        ...VACIA,
        reembolsos: { esperandoLlave: [reembolso], pendientes: [] },
        contadores: { ...VACIA.contadores, reembolsos: 1, reembolsosEsperandoLlave: 1 },
      }),
    );
    expect(t).toContain("Ninguno está listo para transferir.");
    expect(t).not.toContain("Ninguno espera una llave.");
  });
});

describe("BandejaAdmin: lo que se ve en cada ítem", () => {
  it("un pago vencido dice Vencido con palabras, no solo con color, y lleva su hora de vencimiento", () => {
    const html = pintar({
      ...VACIA,
      pagos: [pago(1, { restante: { texto: "Vencido hace 30 min", vencido: true } })],
      contadores: { ...VACIA.contadores, pagos: 1 },
    });
    expect(texto(html)).toContain("Vencido hace 30 min");
    expect(html).toContain('<time dateTime="2026-10-05T15:00:00.000Z">Vencido hace 30 min</time>');
  });

  it("muestra el monto en pesos", () => {
    const t = texto(pintar({ ...VACIA, pagos: [pago(1, { monto: 150_000 })], contadores: { ...VACIA.contadores, pagos: 1 } }));
    expect(t).toContain("Pagador 1 · $ 150.000");
  });

  it("un reporte sin monitoría legible dice Sesión sin fecha; con fecha la escribe en español", () => {
    const fechaReporte = new Date("2026-09-29T07:09:00.000Z");
    const t = texto(
      pintar({
        ...VACIA,
        reportes: [
          { id: "a", fechaReporte, fechaSesion: null },
          { id: "b", fechaReporte, fechaSesion: "2020-01-13" },
        ],
        contadores: { ...VACIA.contadores, reportes: 2 },
      }),
    );
    expect(t).toContain("Sesión sin fecha");
    expect(t).toContain("Sesión del 13 de enero de 2020");
    expect(t).toContain("Reportado el martes, 29 de septiembre de 2026, 2:09 a. m.");
  });

  it("un desembolso muestra el neto y después de cuándo es ejecutable, y nada de bruto ni comisión", () => {
    const html = pintar({
      ...VACIA,
      desembolsos: [
        { id: "d", montoNeto: 22_500, desembolsableDesde: new Date("2020-01-07T16:00:00.000Z"), fechaSesion: "2020-01-06" },
      ],
      contadores: { ...VACIA.contadores, desembolsos: 1 },
    });
    const t = texto(html);
    expect(t).toContain("Transferir $ 22.500");
    // Es ejecutable después de ese instante, no desde él: en el instante exacto el reporte sigue abierto (N-6, HU-064).
    expect(t).toContain("Sesión del 6 de enero de 2020 · ejecutable después del martes, 7 de enero de 2020, 11:00 a. m.");
    expect(t).not.toContain("ejecutable desde");
    expect(html.toLowerCase()).not.toContain("comisi");
    expect(html.toLowerCase()).not.toContain("bruto");
  });

  it("los textos de ayuda no llevan plazos escritos a mano: viven en la base (HU-003)", () => {
    const t = texto(pintar(VACIA));
    expect(t).not.toMatch(/\b\d+ horas?\b/);
    expect(t).not.toMatch(/\b\d+ min/);
  });

  it("no promete lo que aún no existe: el orden por vencimiento es solo de los pagos y no hay escalamiento (HU-064)", () => {
    const t = texto(pintar(VACIA));
    expect(t).toContain("Cada pago tiene un plazo para revisarse: el que vence primero va arriba y en cada fila ves cuánto le queda.");
    // El paso al siguiente admin llega con HU-034; hasta entonces la bandeja no lo anuncia.
    expect(t).not.toMatch(/siguiente admin/i);
    expect(t.match(/vence primero/g)).toHaveLength(1);
  });
});

describe("BandejaAdmin: lo que viene de la base no se interpreta como HTML", () => {
  it("escapa un nombre de pagador con etiquetas y un motivo con comillas", () => {
    const html = pintar({
      ...VACIA,
      pagos: [pago(1, { nombrePagador: '<img src=x onerror="alert(1)">' })],
      reembolsos: { esperandoLlave: [{ id: "r", monto: 25_000, motivo: '"><script>alert(2)</script>' }], pendientes: [] },
      contadores: { ...VACIA.contadores, pagos: 1, reembolsos: 1, reembolsosEsperandoLlave: 1 },
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("BandejaAdmin: correos que no salieron (HU-065)", () => {
  it("muestra el tipo de correo, a quién, desde cuándo y el último error", () => {
    const t = texto(
      pintar({
        ...VACIA,
        correosSinEnviar: [
          {
            id: "c-1",
            tipo: "Invitación de monitor",
            destinatario: "aspirante@uniandes.edu.co",
            creadoEn: new Date("2026-09-29T15:00:00Z"),
            error: "SMTP 535 EAUTH: credenciales inválidas",
          },
        ],
        contadores: { ...VACIA.contadores, correosSinEnviar: 1 },
      }),
    );
    expect(t).toContain("Correos que no salieron (1)");
    expect(t).toContain("Invitación de monitor · aspirante@uniandes.edu.co");
    expect(t).toContain("SMTP 535 EAUTH: credenciales inválidas");
    // 10:00 en Bogotá: la fecha sale en la zona del negocio.
    expect(t).toMatch(/29 de septiembre de 2026.*10:00/);
  });
});

