import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bandeja, PagoPorCobrarOAsumir, PagoPorRevisar, PagoVencidoDeOtro, ReembolsoCerrado, ReembolsoDeOtro } from "@/lib/admin/bandeja";
import { BandejaAdmin } from "./BandejaAdmin";

// La acción de reabrir (HU-025) vive en el servidor: aquí solo se pinta el formulario que la usa.
vi.mock("./acciones", () => ({ reabrir: async () => {} }));

// Sin navegador ni base: se pinta la pantalla con una bandeja inventada y se lee el HTML. Lo que
// necesita datos reales (orden, estados, políticas) lo cubren integracion/bandeja.test.ts y
// e2e/bandeja.spec.ts.

const VACIA: Bandeja = {
  pagos: [],
  pagosVencidosDeOtros: [],
  pagosPorCobrarOAsumir: [],
  reembolsos: { esperandoLlave: [], pendientes: [], pendientesDeOtros: [] },
  reembolsosCerrados: [],
  reportes: [],
  desembolsos: [],
  correosSinEnviar: [],
  contadores: {
    pagos: 0,
    pagosVencidosDeOtros: 0,
    pagosPorCobrarOAsumir: 0,
    reembolsos: 0,
    reembolsosEsperandoLlave: 0,
    reembolsosPendientes: 0,
    reembolsosPendientesDeOtros: 0,
    reembolsosCerrados: 0,
    reportes: 0,
    desembolsos: 0,
    correosSinEnviar: 0,
  },
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
    expect(t).toContain("No hay pagos por cobrar ni por asumir.");
    expect(t).toContain("No tienes reembolsos por atender.");
    expect(t).toContain("No tienes reportes en revisión.");
    expect(t).toContain("No hay desembolsos listos para ejecutar.");
    expect(t).toContain("Todos los correos salieron.");
  });

  it("los seis contadores están arriba, en un nav con nombre, y cada uno lleva a su sección", () => {
    const html = pintar({
      ...VACIA,
      contadores: { ...VACIA.contadores, pagos: 3, pagosPorCobrarOAsumir: 6, reembolsos: 2, reportes: 1, desembolsos: 5, correosSinEnviar: 4 },
    });
    expect(html).toContain('<nav aria-label="Resumen de tu bandeja">');
    // Ni uno más ni uno menos.
    expect(html.match(/<a href="#/g)).toHaveLength(6);
    for (const [id, cifra, rotulo] of [
      ["pagos", 3, "Pagos por revisar"],
      ["por-cobrar", 6, "Pagos por cobrar o asumir"],
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
        reembolsos: { esperandoLlave: filas(3, "e"), pendientes: filas(2, "p"), pendientesDeOtros: [] },
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
        reembolsos: { esperandoLlave: [], pendientes: [reembolso], pendientesDeOtros: [] },
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
        reembolsos: { esperandoLlave: [reembolso], pendientes: [], pendientesDeOtros: [] },
        contadores: { ...VACIA.contadores, reembolsos: 1, reembolsosEsperandoLlave: 1 },
      }),
    );
    expect(t).toContain("Ninguno está listo para transferir.");
    expect(t).not.toContain("Ninguno espera una llave.");
  });

  it("cada reembolso de los dos estados lleva a su gestión, con el monto y el motivo dentro del enlace (HU-026)", () => {
    const html = pintar({
      ...VACIA,
      reembolsos: {
        esperandoLlave: [{ id: "r-1", monto: 25_000, motivo: "Motivo uno" }],
        pendientes: [{ id: "r-2", monto: 32_000, motivo: "Motivo dos" }],
        pendientesDeOtros: [],
      },
      contadores: { ...VACIA.contadores, reembolsos: 2, reembolsosEsperandoLlave: 1, reembolsosPendientes: 1 },
    });
    for (const [id, monto, motivo] of [
      ["r-1", "$ 25.000", "Motivo uno"],
      ["r-2", "$ 32.000", "Motivo dos"],
    ] as const) {
      const enlace = html.match(new RegExp(`<a href="/admin/reembolsos/${id}"[^>]*>(.*?)</a>`))?.[1] ?? "";
      expect(texto(enlace)).toContain(monto);
      expect(texto(enlace)).toContain(motivo);
    }
    // Un enlace por reembolso y ninguno más; los de la bandeja de cada estado van en el suyo.
    expect(html.match(/href="\/admin\/reembolsos\//g)).toHaveLength(2);
    const t = texto(html);
    expect(t.indexOf("Esperando la llave del pagador")).toBeLessThan(t.indexOf("Motivo uno"));
    expect(t.indexOf("Motivo uno")).toBeLessThan(t.indexOf("Listos para transferir"));
    expect(t.indexOf("Listos para transferir")).toBeLessThan(t.indexOf("Motivo dos"));
  });

  it("los cerrados sin llave no enlazan a la gestión: se reabren desde la bandeja (HU-025)", () => {
    const html = pintar({
      ...VACIA,
      reembolsosCerrados: [
        {
          id: "c-1",
          nombrePagador: "Pagador",
          contacto: "pagador@uniandes.edu.co",
          monto: 25_000,
          motivo: "Motivo",
          cerradoEn: new Date("2026-10-10T15:00:00.000Z"),
        },
      ],
      contadores: { ...VACIA.contadores, reembolsosCerrados: 1 },
    });
    expect(html).not.toContain("/admin/reembolsos/");
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

  it("cada pago lleva a su revisión, con el pagador, el monto y el tiempo dentro del enlace (HU-020)", () => {
    const html = pintar({ ...VACIA, pagos: [pago(1), pago(2)], contadores: { ...VACIA.contadores, pagos: 2 } });
    for (const n of [1, 2]) {
      const enlace = html.match(new RegExp(`<a href="/admin/pagos/pago-${n}"[^>]*>(.*?)</a>`))?.[1] ?? "";
      expect(texto(enlace)).toContain(`Pagador ${n} · $ 25.000`);
      expect(enlace).toContain("<time");
    }
    // Un enlace por pago y ninguno más dentro de la lista de pagos.
    expect(html.match(/href="\/admin\/pagos\//g)).toHaveLength(2);
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

  it("HU-030: cada reporte enlaza a su resolución, con su texto dentro del enlace", () => {
    const fechaReporte = new Date("2026-09-29T07:09:00.000Z");
    const html = pintar({
      ...VACIA,
      reportes: [
        { id: "reporte-1", fechaReporte, fechaSesion: "2020-01-13" },
        { id: "reporte-2", fechaReporte, fechaSesion: null },
      ],
      contadores: { ...VACIA.contadores, reportes: 2 },
    });
    const enlace = (id: string) => html.match(new RegExp(`<a href="/admin/reportes/${id}"[^>]*>(.*?)</a>`))?.[1] ?? "";
    expect(texto(enlace("reporte-1"))).toContain("Sesión del 13 de enero de 2020");
    expect(texto(enlace("reporte-1"))).toContain("Reportado el martes, 29 de septiembre de 2026, 2:09 a. m.");
    expect(texto(enlace("reporte-2"))).toContain("Sesión sin fecha");
    // Un enlace por reporte y ninguno más hacia las páginas de reportes.
    expect(html.match(/href="\/admin\/reportes\//g)).toHaveLength(2);
    expect(texto(html)).toContain("Abre cada uno para aceptarlo o rechazarlo.");
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

  it("cada desembolso lleva a su ejecución, con el neto y la fecha dentro del enlace (HU-028)", () => {
    const desembolso = (id: string) => ({
      id,
      montoNeto: 22_500,
      desembolsableDesde: new Date("2020-01-07T16:00:00.000Z"),
      fechaSesion: "2020-01-06",
    });
    const html = pintar({ ...VACIA, desembolsos: [desembolso("d-1"), desembolso("d-2")], contadores: { ...VACIA.contadores, desembolsos: 2 } });
    for (const id of ["d-1", "d-2"]) {
      const enlace = html.match(new RegExp(`<a href="/admin/desembolsos/${id}"[^>]*>(.*?)</a>`))?.[1] ?? "";
      expect(texto(enlace)).toContain("Transferir $ 22.500");
      expect(texto(enlace)).toContain("Sesión del 6 de enero de 2020");
    }
    // Un enlace por desembolso y ninguno más.
    expect(html.match(/href="\/admin\/desembolsos\//g)).toHaveLength(2);
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

describe("BandejaAdmin: pagos vencidos de otros admins (HU-077, supuesto 2)", () => {
  const deOtro = (n: number, nombreAdmin = "Admin Dos"): PagoVencidoDeOtro => ({
    ...pago(n, { restante: { texto: "Vencido hace 30 min", vencido: true } }),
    nombreAdmin,
  });

  it("van en Pagos por revisar, después de los propios, con de quién son y desde cuándo están vencidos", () => {
    const html = pintar({
      ...VACIA,
      pagos: [pago(1)],
      pagosVencidosDeOtros: [deOtro(2), deOtro(3, "Admin Tres")],
      contadores: { ...VACIA.contadores, pagos: 1, pagosVencidosDeOtros: 2 },
    });
    const t = texto(html);
    // Dentro de la sección de pagos, y antes de la siguiente.
    const seccion = html.slice(html.indexOf('<section id="pagos"'), html.indexOf('<section id="reembolsos"'));
    expect(seccion).toContain('<ul aria-label="Asignados a ti"');
    expect(texto(seccion)).toContain("Vencidos de otros admins (2)");
    expect(seccion).toMatch(/<h3 id="pagos-de-otros-titulo"[^>]*>/);
    expect(seccion).toContain('<ul aria-labelledby="pagos-de-otros-titulo"');
    expect(t.indexOf("Pagador 1")).toBeLessThan(t.indexOf("Vencidos de otros admins"));
    expect(t.indexOf("Vencidos de otros admins")).toBeLessThan(t.indexOf("Pagador 2"));
    // Cada uno lleva a su revisión, con el asignado y el vencimiento dentro del enlace.
    for (const [n, admin] of [
      [2, "Admin Dos"],
      [3, "Admin Tres"],
    ] as const) {
      const enlace = html.match(new RegExp(`<a href="/admin/pagos/pago-${n}"[^>]*>(.*?)</a>`))?.[1] ?? "";
      expect(texto(enlace)).toContain(`Pagador ${n} · $ 25.000`);
      expect(texto(enlace)).toContain(`De ${admin} · Vencido hace 30 min`);
      expect(enlace).toContain('<time dateTime="2026-10-05T15:00:00.000Z">Vencido hace 30 min</time>');
    }
    expect(t).toContain("Al admin asignado se le pasó la hora para revisarlos: ya puedes aprobarlos o rechazarlos tú.");
  });

  it("el contador de arriba y el de la sección cuentan solo los asignados al admin", () => {
    const html = pintar({
      ...VACIA,
      pagos: [pago(1)],
      pagosVencidosDeOtros: [deOtro(2)],
      contadores: { ...VACIA.contadores, pagos: 1, pagosVencidosDeOtros: 1 },
    });
    expect(html).toMatch(/<a href="#pagos"[^>]*><span[^>]*>1<\/span><span[^>]*>Pagos por revisar<\/span><\/a>/);
    expect(texto(html)).toContain("Pagos por revisar (1)");
    expect(texto(html)).toContain("Vencidos de otros admins (1)");
  });

  it("sin pagos propios dice que no tiene, y aun así muestra los vencidos de otros", () => {
    const t = texto(pintar({ ...VACIA, pagosVencidosDeOtros: [deOtro(2)], contadores: { ...VACIA.contadores, pagosVencidosDeOtros: 1 } }));
    expect(t).toContain("No tienes pagos por revisar.");
    expect(t).toContain("Vencidos de otros admins (1)");
    expect(t).toContain("De Admin Dos · Vencido hace 30 min");
  });

  it("sin vencidos de otros no aparece nada de ellos", () => {
    const html = pintar({ ...VACIA, pagos: [pago(1)], contadores: { ...VACIA.contadores, pagos: 1 } });
    expect(html).not.toContain("pagos-de-otros-titulo");
    expect(texto(html)).not.toContain("otros admins");
  });

  it("su lista se corta por su cuenta y lo avisa", () => {
    const t = texto(
      pintar({
        ...VACIA,
        pagos: [pago(1)],
        pagosVencidosDeOtros: [deOtro(2)],
        contadores: { ...VACIA.contadores, pagos: 1, pagosVencidosDeOtros: 3 },
      }),
    );
    expect(t).toContain("Vencidos de otros admins (3)");
    expect(t).toContain("Se muestran los primeros 1 de 3.");
  });

  it("escapa el nombre del admin asignado", () => {
    const html = pintar({
      ...VACIA,
      pagosVencidosDeOtros: [deOtro(2, '<img src=x onerror="alert(1)">')],
      contadores: { ...VACIA.contadores, pagosVencidosDeOtros: 1 },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("De &lt;img");
  });
});

describe("BandejaAdmin: pagos por cobrar o asumir (HU-078)", () => {
  const caso = (n: number, extra: Partial<PagoPorCobrarOAsumir> = {}): PagoPorCobrarOAsumir => ({
    id: `caso-${n}`,
    nombrePagador: `Pagador ${n}`,
    contacto: `pagador${n}@uniandes.edu.co`,
    monto: 32_000,
    observaciones: "Se cobra por fuera.\nLlamar el lunes.",
    rechazadoEn: new Date("2026-10-02T15:00:00.000Z"),
    monitoria: { fecha: "2026-10-01", nombreMateria: "Cálculo Diferencial", nombreMonitor: "Andrés Gómez" },
    ...extra,
  });
  const conCasos = (casos: PagoPorCobrarOAsumir[], total = casos.length) =>
    pintar({ ...VACIA, pagosPorCobrarOAsumir: casos, contadores: { ...VACIA.contadores, pagosPorCobrarOAsumir: total } });
  const seccion = (html: string) => html.slice(html.indexOf('<section id="por-cobrar"'), html.indexOf('<section id="reembolsos"'));

  it("criterio 1: cada caso lleva a la página de su pago, con el pagador, su contacto, el monto, la monitoría y las observaciones dentro del enlace", () => {
    const html = conCasos([caso(1), caso(2, { observaciones: null })]);
    // [\s\S] y no `.`: las observaciones traen saltos de línea.
    const enlace = html.match(/<a href="\/admin\/pagos\/caso-1"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    const t = texto(enlace);
    expect(t).toContain("Pagador 1 · $ 32.000");
    expect(t).toContain("pagador1@uniandes.edu.co");
    expect(t).toContain("Cálculo Diferencial con Andrés Gómez · Sesión del 1 de octubre de 2026");
    // 10:00 en Bogotá: la fecha sale en la zona del negocio.
    expect(t).toContain("Rechazado el viernes, 2 de octubre de 2026, 10:00 a. m.");
    expect(enlace).toContain('<time dateTime="2026-10-02T15:00:00.000Z">');
    // Los saltos de línea se conservan (la clase lleva white-space: pre-line).
    expect(enlace).toContain("Observaciones: Se cobra por fuera.\nLlamar el lunes.");
    // Sin observaciones no inventa el rótulo.
    const sinObservaciones = html.match(/<a href="\/admin\/pagos\/caso-2"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    expect(sinObservaciones).not.toContain("Observaciones");
    // Un enlace por caso, en la sección, en el orden que trae la base (el más antiguo primero).
    expect(seccion(html).match(/href="\/admin\/pagos\//g)).toHaveLength(2);
    expect(seccion(html).indexOf("caso-1")).toBeLessThan(seccion(html).indexOf("caso-2"));
  });

  it("va en su propia sección, con su contador, después de los pagos por revisar, y dice que es de todos los admins", () => {
    const html = conCasos([caso(1)]);
    const s = seccion(html);
    expect(s).toContain('<section id="por-cobrar" aria-labelledby="por-cobrar-titulo"');
    expect(texto(s)).toContain("Pagos por cobrar o asumir (1)");
    expect(texto(s)).toContain("ciérralo como cobrado si el pagador pagó por fuera, o asumido si Calibra no lo cobra");
    expect(texto(s)).toContain("El más antiguo va arriba. Son los mismos para todos los admins.");
    expect(html.indexOf('<section id="pagos"')).toBeLessThan(html.indexOf('<section id="por-cobrar"'));
    // No se mezcla con los pagos por revisar.
    expect(texto(html.slice(html.indexOf('<section id="pagos"'), html.indexOf('<section id="por-cobrar"')))).not.toContain("Pagador 1");
  });

  it("su lista se corta por su cuenta y lo avisa", () => {
    const t = texto(conCasos([caso(1)], 4));
    expect(t).toContain("Pagos por cobrar o asumir (4)");
    expect(t).toContain("Se muestran los primeros 1 de 4.");
  });

  it("nunca habla de bruto ni de comisión", () => {
    const html = conCasos([caso(1)]).toLowerCase();
    expect(html).not.toContain("comisi");
    expect(html).not.toContain("bruto");
  });

  it("escapa lo que viene de la base", () => {
    const html = conCasos([
      caso(1, {
        nombrePagador: '<img src=x onerror="alert(1)">',
        contacto: "<b>contacto</b>",
        observaciones: "<script>alert(2)</script>",
        monitoria: { fecha: "2026-10-01", nombreMateria: "<i>Materia</i>", nombreMonitor: "<u>Monitor</u>" },
      }),
    ]);
    for (const etiqueta of ["<img", "<script", "<b>", "<i>", "<u>"]) expect(html).not.toContain(etiqueta);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("BandejaAdmin: reembolsos listos de otros admins (HU-082, pregunta 1)", () => {
  const deOtro = (n: number, nombreAdmin: string | null = "Admin Dos"): ReembolsoDeOtro => ({
    id: `otro-${n}`,
    monto: 25_000 + n,
    motivo: `Motivo ${n}`,
    nombreAdmin,
  });
  const con = (otros: ReembolsoDeOtro[], total = otros.length) =>
    pintar({
      ...VACIA,
      reembolsos: { ...VACIA.reembolsos, pendientesDeOtros: otros },
      contadores: { ...VACIA.contadores, reembolsosPendientesDeOtros: total },
    });
  const seccion = (html: string) => html.slice(html.indexOf('<section id="reembolsos"'), html.indexOf('<section id="reportes"'));

  it("van en Reembolsos, después de Listos para transferir, con De <nombre> o De nadie todavía y enlace a su gestión", () => {
    const html = con([deOtro(1), deOtro(2, null)]);
    const s = seccion(html);
    expect(s).toMatch(/<h3 id="reembolsos-de-otros-titulo"[^>]*>/);
    expect(s).toContain('<ul aria-labelledby="reembolsos-de-otros-titulo"');
    const t = texto(s);
    expect(t).toContain("De otros admins (2)");
    expect(t).toContain("Los tiene asignados otra persona. Si quien pagó ya envió su llave, puedes registrar tú la transferencia.");
    expect(t.indexOf("Listos para transferir")).toBeLessThan(t.indexOf("De otros admins"));
    const enlace = (id: string) => html.match(new RegExp(`<a href="/admin/reembolsos/${id}"[^>]*>(.*?)</a>`))?.[1] ?? "";
    expect(texto(enlace("otro-1"))).toContain("$ 25.001 De Admin Dos Motivo 1");
    expect(texto(enlace("otro-2"))).toContain("De nadie todavía");
  });

  it("no suman a la tarjeta ni al total de Reembolsos, y sin propios dice que no tiene pero los muestra", () => {
    const html = con([deOtro(1)]);
    expect(html).toMatch(/<a href="#reembolsos"[^>]*><span[^>]*>0<\/span><span[^>]*>Reembolsos<\/span><\/a>/);
    expect(texto(html)).toContain("Reembolsos (0)");
    expect(texto(html)).toContain("No tienes reembolsos por atender.");
    expect(texto(html)).toContain("De otros admins (1)");
  });

  it("sin ninguno no aparece nada de ellos", () => {
    const html = con([]);
    expect(html).not.toContain("reembolsos-de-otros-titulo");
    expect(texto(html)).not.toContain("De otros admins");
  });

  it("su lista se corta por su cuenta y lo avisa", () => {
    const t = texto(con([deOtro(1)], 4));
    expect(t).toContain("De otros admins (4)");
    expect(t).toContain("Se muestran los primeros 1 de 4.");
  });

  it("escapa el nombre del admin asignado", () => {
    const html = con([deOtro(1, '<img src=x onerror="alert(1)">')]);
    expect(html).not.toContain("<img");
    expect(html).toContain("De &lt;img");
  });
});

describe("BandejaAdmin: reembolsos cerrados sin llave (HU-025, supuesto 4)", () => {
  const cerrado = (n: number, extra: Partial<ReembolsoCerrado> = {}): ReembolsoCerrado => ({
    id: `0000000${n}-0000-4000-8000-000000000025`,
    nombrePagador: `Pagador ${n}`,
    contacto: `pagador${n}@uniandes.edu.co`,
    monto: 25_000,
    motivo: "Cancelaste la monitoría dentro del plazo.",
    cerradoEn: new Date("2026-10-10T15:00:00.000Z"),
    ...extra,
  });
  const conCerrados = (cerrados: ReembolsoCerrado[], total = cerrados.length, extra: Partial<Bandeja> = {}) =>
    pintar({ ...VACIA, reembolsosCerrados: cerrados, ...extra, contadores: { ...VACIA.contadores, ...extra.contadores, reembolsosCerrados: total } });
  const seccion = (html: string) => html.slice(html.indexOf('<section id="reembolsos"'), html.indexOf('<section id="reportes"'));

  it("sin cerrados no aparece nada de ellos", () => {
    const html = pintar(VACIA);
    expect(html).not.toContain("reembolsos-cerrados-titulo");
    expect(texto(html)).not.toContain("Cerrados sin llave");
    expect(html).not.toContain("<form");
  });

  it("van en Reembolsos, después de los propios, con su contador, el pagador, su correo, el motivo y cuándo se cerró", () => {
    const propio = { id: "r", monto: 10_000, motivo: "Motivo propio" };
    const html = conCerrados([cerrado(1)], 1, {
      reembolsos: { esperandoLlave: [propio], pendientes: [], pendientesDeOtros: [] },
      contadores: { ...VACIA.contadores, reembolsos: 1, reembolsosEsperandoLlave: 1 },
    });
    const s = seccion(html);
    expect(s).toMatch(/<h3 id="reembolsos-cerrados-titulo"[^>]*>/);
    expect(s).toContain('<ul aria-labelledby="reembolsos-cerrados-titulo"');
    const t = texto(s);
    expect(t).toContain("Cerrados sin llave (1)");
    expect(t.indexOf("Motivo propio")).toBeLessThan(t.indexOf("Cerrados sin llave"));
    expect(t).toContain("Pagador 1 · $ 25.000");
    expect(t).toContain("pagador1@uniandes.edu.co");
    expect(t).toContain("Cancelaste la monitoría dentro del plazo.");
    // 10:00 en Bogotá: la fecha sale en la zona del negocio.
    expect(t).toContain("Se cerró el sábado, 10 de octubre de 2026, 10:00 a. m.");
    expect(s).toContain('<time dateTime="2026-10-10T15:00:00.000Z">');
    expect(t).toContain("Son los mismos para todos los admins");
  });

  it("cada uno tiene su formulario para reabrirlo, con su id oculto y un botón que nombra el caso", () => {
    const html = conCerrados([cerrado(1), cerrado(2)]);
    expect(html.match(/<form/g)).toHaveLength(2);
    for (const n of [1, 2]) {
      const id = cerrado(n).id;
      expect(html).toMatch(new RegExp(`<input type="hidden" name="reembolso" value="${id}"/>`));
      // El botón dice a qué caso se refiere: lo describe la línea con el pagador y el monto.
      expect(html).toMatch(new RegExp(`<button type="submit" aria-describedby="cerrado-${id}"[^>]*>Reabrir y reenviar el enlace</button>`));
      expect(html).toContain(`id="cerrado-${id}"`);
    }
  });

  it("no cuentan en el contador de reembolsos por atender, y sin reembolsos propios igual se muestran", () => {
    const html = conCerrados([cerrado(1)], 1);
    expect(html).toMatch(/<a href="#reembolsos"[^>]*><span[^>]*>0<\/span><span[^>]*>Reembolsos<\/span><\/a>/);
    const t = texto(seccion(html));
    expect(t).toContain("Reembolsos (0)");
    expect(t).toContain("No tienes reembolsos por atender.");
    expect(t).toContain("Cerrados sin llave (1)");
  });

  it("su lista se corta por su cuenta y lo avisa", () => {
    const t = texto(conCerrados([cerrado(1)], 5));
    expect(t).toContain("Cerrados sin llave (5)");
    expect(t).toContain("Se muestran los primeros 1 de 5.");
  });

  it("escapa lo que viene de la base", () => {
    const html = conCerrados([cerrado(1, { nombrePagador: '<img src=x onerror="alert(1)">', contacto: "<b>c</b>", motivo: "<script>alert(2)</script>" })]);
    // Solo la sección: con un formulario, React agrega al final su propio <script> para reenviar lo que se envíe antes de
    // hidratar.
    const s = seccion(html);
    for (const etiqueta of ["<img", "<script", "<b>"]) expect(s).not.toContain(etiqueta);
    expect(s).toContain("&lt;img");
    expect(s).toContain("&lt;script&gt;");
  });
});

describe("BandejaAdmin: lo que viene de la base no se interpreta como HTML", () => {
  it("escapa un nombre de pagador con etiquetas y un motivo con comillas", () => {
    const html = pintar({
      ...VACIA,
      pagos: [pago(1, { nombrePagador: '<img src=x onerror="alert(1)">' })],
      reembolsos: { esperandoLlave: [{ id: "r", monto: 25_000, motivo: '"><script>alert(2)</script>' }], pendientes: [], pendientesDeOtros: [] },
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

