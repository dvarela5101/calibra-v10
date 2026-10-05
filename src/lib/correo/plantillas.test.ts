import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { armarHtml, armarTexto, enlaceSeguro, escaparHtml, protocoloAdmitido } from "./html";
import { PLANTILLAS, renderizar, type DatosPorPlantilla, type Plantilla } from "./plantillas";

const ENLACE = "https://calibra.example/resultados?token=abc123";

/** Datos de ejemplo de cada plantilla, con todos sus campos. */
const EJEMPLOS: { [P in Plantilla]: DatosPorPlantilla[P] } = {
  recuperacion_diagnostico: { nombre: "Ana", materia: "Cálculo Integral", enlace: ENLACE },
  resena_individual: { nombre: "Ana", monitor: "Camilo Rojas", enlace: ENLACE },
  solicitud_llave_reembolso: {
    nombre: "Ana",
    monto: 25_000,
    motivo: "Cancelaste la monitoría a tiempo",
    enlace: ENLACE,
    venceEn: "2020-01-13T15:00:00.000Z",
    reporteAceptado: false,
    contactoSoporte: "ayuda@calibra.example",
  },
  recordatorio_llave_reembolso: {
    nombre: "Ana",
    monto: 25_000,
    motivo: "Cancelaste la monitoría a tiempo",
    enlace: ENLACE,
    venceEn: "2020-01-13T15:00:00.000Z",
    contactoSoporte: "ayuda@calibra.example",
  },
  pago_rechazado_individual: { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte: "ayuda@calibra.example" },
  pago_rechazado_grupal: { nombre: "Ana", monto: 20_000, fechaSesion: "2020-01-13", enlace: ENLACE },
  escalamiento_pago: { nombreAdmin: "Admin Uno", nombrePagador: "Ana Pérez", monto: 25_000, enlace: "https://calibra.example/admin" },
  invitacion_monitor: { enlace: ENLACE, venceEn: "2020-01-13T15:00:00.000Z" },
  verificacion_lead: { nombre: "Ana", enlace: ENLACE, venceEn: "2020-01-13T15:00:00.000Z" },
  aviso_monitor_confirmada: {
    nombreMonitor: "Camilo Rojas",
    nombreEstudiante: "Ana",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    duracionMin: 90,
    presencial: true,
    enlace: "https://calibra.example/monitor/agenda",
  },
  aviso_monitor_cancelada: {
    nombreMonitor: "Camilo Rojas",
    nombreEstudiante: "Ana",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    enlace: "https://calibra.example/monitor/agenda",
  },
  confirmacion_cita: {
    nombre: "Ana",
    nombreMonitor: "Camilo Rojas",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    duracionMin: 90,
    presencial: true,
    valorTotal: 25_000,
    lugar: "Edificio Principal, salón 301",
    enlaceSesion: null,
    cancelableHasta: "2020-01-13T03:00:00.000Z",
    enlace: "https://calibra.example/cita?token=abc123",
  },
  cancelacion_cita: {
    nombre: "Ana",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    reembolsos: [{ monto: 25_000, enlace: "https://calibra.example/reembolso?token=abc123" }],
    conPagoEnRevision: false,
    reembolsoAOtroContacto: false,
    enlaceCita: "https://calibra.example/cita?token=abc123",
  },
  aviso_monitor_pago_rechazado: {
    nombreMonitor: "Camilo Rojas",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    enlace: "https://calibra.example/monitor/agenda",
  },
  pago_rechazado_sin_reembolso: { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte: "ayuda@calibra.example" },
  aviso_monitor_inasistencia_aceptada: {
    nombreMonitor: "Camilo Rojas",
    materia: "Cálculo Integral",
    inicio: "2020-01-13T15:00:00.000Z",
    enlace: "https://calibra.example/monitor/agenda",
  },
};

const render = <P extends Plantilla>(plantilla: P, cambios: Partial<DatosPorPlantilla[P]> = {}) =>
  renderizar(plantilla, { ...EJEMPLOS[plantilla], ...cambios });

describe("las plantillas de correo", () => {
  it("son las que salen por correo: diagnóstico, reseña, llave y su recordatorio, dos rechazos, escalamiento, invitación de monitor, verificación del correo del Lead, cuatro avisos al monitor (confirmada, cancelada, pago rechazado y reporte de inasistencia aceptado), la confirmación y la cancelación de la cita y el pago rechazado con la cita ya cancelada", () => {
    expect([...PLANTILLAS].sort()).toEqual(Object.keys(EJEMPLOS).sort());
    expect(PLANTILLAS).toHaveLength(16);
  });

  it.each(PLANTILLAS)("%s sale en español con HTML y texto plano", (plantilla) => {
    const { asunto, html, texto } = render(plantilla);

    expect(asunto.length).toBeGreaterThan(0);
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<h1");
    expect(texto.length).toBeGreaterThan(0);
    expect(texto).not.toMatch(/<[a-z][^>]*>/i);
    // El texto plano trae lo mismo que el HTML: el saludo y el título están en las dos versiones.
    const titulo = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)![1];
    expect(texto).toContain(titulo.replaceAll("&amp;", "&"));
  });

  it.each(PLANTILLAS)("%s no lleva emojis, rayas largas, comisión ni marcadores sin llenar", (plantilla) => {
    const { asunto, html, texto } = render(plantilla);
    for (const contenido of [asunto, html, texto]) {
      expect(contenido).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(contenido).not.toMatch(/[—–]/);
      expect(contenido).not.toMatch(/comisi/i);
      expect(contenido).not.toMatch(/undefined|null|NaN|\{\{|TODO/);
    }
  });

  it.each(PLANTILLAS)("%s es determinista: los mismos datos dan el mismo correo (la Idempotency-Key lo exige)", (plantilla) => {
    expect(render(plantilla)).toEqual(render(plantilla));
  });

  it.each(PLANTILLAS)("%s no baja de 14 px en ningún texto del HTML", (plantilla) => {
    const tamanos = [...render(plantilla).html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(tamanos.length).toBeGreaterThan(0);
    expect(Math.min(...tamanos)).toBeGreaterThanOrEqual(14);
  });
});

describe("el contenido de cada plantilla", () => {
  it("recuperación del diagnóstico: la materia en el asunto y el enlace con token en el HTML y el texto", () => {
    const { asunto, html, texto } = render("recuperacion_diagnostico");
    expect(asunto).toBe("Tus resultados del diagnóstico de Cálculo Integral");
    expect(html).toContain(`href="${ENLACE}"`);
    expect(texto).toContain(`Ver mis resultados: ${ENLACE}`);
    expect(texto).toContain("Hola, Ana.");
  });

  it("reseña individual: dice el monitor y que el enlace no vence (RN-72)", () => {
    const { asunto, texto } = render("resena_individual");
    expect(asunto).toBe("¿Cómo te fue con Camilo Rojas?");
    expect(texto).toContain("Tu monitoría con Camilo Rojas ya terminó.");
    expect(texto).toContain("El enlace no vence");
  });

  it("solicitud de llave: el monto en pesos, el motivo con su punto y el enlace para dar la llave", () => {
    const { asunto, texto } = render("solicitud_llave_reembolso");
    expect(asunto.replace(/ /g, " ")).toBe("Necesitamos tu llave para devolverte $ 25.000");
    expect(texto.replace(/ /g, " ")).toContain("Vamos a devolverte $ 25.000 de tu pago en Calibra. Motivo: Cancelaste la monitoría a tiempo.");
    expect(texto).toContain(`Enviar mi llave: ${ENLACE}`);
    expect(texto).toContain("Calibra nunca te pide claves del banco");
  });

  it("solicitud de llave: un motivo que ya trae punto no queda con dos", () => {
    const { texto } = render("solicitud_llave_reembolso", { motivo: "El monitor no asistió." });
    expect(texto).toContain("Motivo: El monitor no asistió.");
    expect(texto).not.toContain("asistió..");
  });

  it("pago rechazado en una individual: la cita cancelada, sin reembolso (RN-43) y sin enlace de pago", () => {
    const { texto, html } = render("pago_rechazado_individual");
    expect(texto).toContain("la monitoría del 6 de enero de 2020 quedó cancelada");
    expect(texto).toContain("no hay reembolso");
    expect(texto).toContain("escríbenos a ayuda@calibra.example");
    expect(html).not.toContain("<a href");
  });

  it("pago rechazado en una individual: sin contacto de soporte no promete uno", () => {
    const { texto } = renderizar("pago_rechazado_individual", { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06" });
    expect(texto).not.toContain("escríbenos");
  });

  it("pago rechazado en una grupal: solo ese cupo, y el enlace del grupo para volver a intentar (RN-43)", () => {
    const { texto } = render("pago_rechazado_grupal");
    expect(texto).toContain("tu cupo en la sesión grupal del 13 de enero de 2020 quedó anulado");
    expect(texto).toContain("Los demás cupos siguen como estaban.");
    expect(texto).toContain(`Volver a pagar: ${ENLACE}`);
  });

  it("escalamiento: al admin, con el pagador y el monto, y el enlace a su bandeja (RN-42)", () => {
    const { asunto, texto } = render("escalamiento_pago");
    expect(asunto).toBe("Pago pendiente de revisión: Ana Pérez");
    expect(texto.replace(/ /g, " ")).toContain("El pago de $ 25.000 de Ana Pérez no se revisó a tiempo y ahora te toca a ti.");
    expect(texto).toContain("Abrir mi bandeja: https://calibra.example/admin");
  });

  it("no lleva plazos escritos: viven en la base (HU-003)", () => {
    for (const plantilla of PLANTILLAS) {
      // La duración de la sesión (avisos al monitor) es un dato de la franja, no un plazo.
      const texto = render(plantilla).texto.replace(/^Duración: .*$/m, "");
      expect(texto).not.toMatch(/\b\d+\s?(horas?|minutos?|min|h)\b/);
    }
  });
});

describe("avisos al monitor (HU-051, D-16)", () => {
  it("confirmada: fecha y hora en Bogotá, duración, materia, modalidad y el nombre del estudiante, con el enlace a su agenda", () => {
    const { asunto, texto } = render("aviso_monitor_confirmada");
    expect(asunto).toBe("Tienes una monitoría confirmada de Cálculo Integral");
    const plano = texto.replace(/[\u00a0\u202f]/g, " ");
    expect(plano).toContain("Hola, Camilo Rojas.");
    expect(plano).toContain("Ana tiene una monitoría contigo y ya quedó confirmada.");
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(plano).toContain("Cuándo: lunes, 13 de enero de 2020, 10:00 a. m.");
    expect(plano).toContain("Duración: 90 minutos.");
    expect(plano).toContain("Materia: Cálculo Integral.");
    expect(plano).toContain("Modalidad: presencial.");
    expect(plano).toContain("Ver mi agenda: https://calibra.example/monitor/agenda");
    expect(render("aviso_monitor_confirmada", { presencial: false }).texto).toContain("Modalidad: virtual.");
  });

  it("cancelada: quién la canceló, la materia, la fecha y la hora", () => {
    const { asunto, texto } = render("aviso_monitor_cancelada");
    expect(asunto).toBe("Se canceló tu monitoría de Cálculo Integral");
    expect(texto.replace(/[\u00a0\u202f]/g, " ")).toContain("Ana canceló la monitoría de Cálculo Integral del lunes, 13 de enero de 2020, 10:00 a. m.");
  });

  it("no lleva el contacto del estudiante: sus datos no lo incluyen (P-37)", () => {
    for (const plantilla of [
      "aviso_monitor_confirmada",
      "aviso_monitor_cancelada",
      "aviso_monitor_pago_rechazado",
      "aviso_monitor_inasistencia_aceptada",
    ] as const) {
      expect(Object.keys(EJEMPLOS[plantilla]).filter((campo) => /correo|telefono|contacto/i.test(campo))).toEqual([]);
    }
  });

  it("rechaza un inicio que no es un instante o una duración que no es un entero positivo", () => {
    expect(() => render("aviso_monitor_confirmada", { inicio: "mañana" })).toThrow(RangeError);
    expect(() => render("aviso_monitor_cancelada", { inicio: "" })).toThrow(RangeError);
    expect(() => render("aviso_monitor_confirmada", { duracionMin: 0 })).toThrow(RangeError);
    expect(() => render("aviso_monitor_confirmada", { duracionMin: 1.5 })).toThrow(RangeError);
  });
});

describe("aviso al monitor por un pago rechazado (HU-076, D-16, D-38, P-37)", () => {
  const plano = (cambios: Partial<DatosPorPlantilla["aviso_monitor_pago_rechazado"]> = {}) =>
    render("aviso_monitor_pago_rechazado", cambios).texto.replace(/[  ]/g, " ");

  it("dice qué monitoría se cayó, cuándo era y por qué, con el enlace a su agenda", () => {
    const { asunto, texto } = render("aviso_monitor_pago_rechazado");
    expect(asunto).toBe("Se canceló tu monitoría de Cálculo Integral");
    expect(texto).toContain("Se canceló una de tus monitorías");
    const llano = plano();
    expect(llano).toContain("Hola, Camilo Rojas.");
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(llano).toContain("Se canceló la monitoría de Cálculo Integral del lunes, 13 de enero de 2020, 10:00 a. m.");
    expect(llano).toContain("Fue porque no se pudo verificar el pago.");
    expect(llano).toContain("No tienes que hacer nada: ya no aparece entre tus próximas monitorías.");
    expect(llano).toContain("Ver mi agenda: https://calibra.example/monitor/agenda");
    expect(render("aviso_monitor_pago_rechazado").html).toContain('href="https://calibra.example/monitor/agenda"');
  });

  it("no tiene pie: el botón es lo último", () => {
    expect(plano().trimEnd().endsWith("Ver mi agenda: https://calibra.example/monitor/agenda")).toBe(true);
  });

  it("no lleva el nombre ni el contacto del estudiante ni montos: sus datos no los incluyen (P-37)", () => {
    expect(Object.keys(EJEMPLOS.aviso_monitor_pago_rechazado).sort()).toEqual(["enlace", "inicio", "materia", "nombreMonitor"]);
    const { asunto, html, texto } = render("aviso_monitor_pago_rechazado");
    for (const contenido of [asunto, html, texto]) {
      expect(contenido).not.toMatch(/\$|@|comisi|neto|reembolso/i);
      expect(contenido).not.toContain("Ana");
    }
  });

  it("no lee el reloj: el mismo dato da el mismo cuerpo hoy y dentro de un año (la Idempotency-Key lo exige)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const antes = render("aviso_monitor_pago_rechazado");
      vi.setSystemTime(new Date("2021-01-01T00:00:00Z"));
      expect(render("aviso_monitor_pago_rechazado")).toEqual(antes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escapa en el HTML lo que viene de fuera: nombre del monitor y materia", () => {
    const { html, texto } = render("aviso_monitor_pago_rechazado", { nombreMonitor: "<b>Camilo</b> & Co", materia: "Cálculo <script>" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Camilo&lt;/b&gt; &amp; Co");
    expect(html).toContain("Cálculo &lt;script&gt;");
    expect(texto).toContain("Hola, <b>Camilo</b> & Co.");
  });

  it("un salto de línea en la materia no parte el asunto ni cuela una cabecera", () => {
    const salto = String.fromCharCode(13, 10);
    const { asunto } = render("aviso_monitor_pago_rechazado", { materia: `Cálculo${salto}Bcc: alguien@otro.co` });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("Se canceló tu monitoría de Cálculo Bcc: alguien@otro.co");
  });

  it("un enlace peligroso falla en vez de armar el correo", () => {
    expect(() => render("aviso_monitor_pago_rechazado", { enlace: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it.each<[string, Partial<DatosPorPlantilla["aviso_monitor_pago_rechazado"]>]>([
    ["nombreMonitor", { nombreMonitor: "  " }],
    ["materia", { materia: " \n " }],
    ["inicio", { inicio: "mañana" }],
    ["inicio", { inicio: "" }],
  ])("%s inválido es un error de quien llama, no un correo con hueco", (_campo, cambios) => {
    expect(() => render("aviso_monitor_pago_rechazado", cambios)).toThrow(RangeError);
  });
});

describe("aviso al monitor por un reporte de inasistencia aceptado (HU-030, D-37, P-37)", () => {
  const plano = (cambios: Partial<DatosPorPlantilla["aviso_monitor_inasistencia_aceptada"]> = {}) =>
    render("aviso_monitor_inasistencia_aceptada", cambios).texto.replace(/[  ]/g, " ");

  it("dice qué monitoría se canceló, cuándo era, por qué y que no se desembolsa, con el enlace a su agenda", () => {
    const { asunto, texto } = render("aviso_monitor_inasistencia_aceptada");
    expect(asunto).toBe("Se aceptó un reporte de inasistencia en tu monitoría de Cálculo Integral");
    expect(texto).toContain("Se aceptó un reporte de inasistencia\n");
    const llano = plano();
    expect(llano).toContain("Hola, Camilo Rojas.");
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(llano).toContain("La monitoría de Cálculo Integral del lunes, 13 de enero de 2020, 10:00 a. m.");
    expect(llano).toContain("Quedó cancelada porque un admin aceptó un reporte de inasistencia.");
    expect(llano).toContain("Por eso no se te desembolsa.");
    expect(llano).toContain("Ver mi agenda: https://calibra.example/monitor/agenda");
    expect(render("aviso_monitor_inasistencia_aceptada").html).toContain('href="https://calibra.example/monitor/agenda"');
  });

  it("no tiene pie: el botón es lo último", () => {
    expect(plano().trimEnd().endsWith("Ver mi agenda: https://calibra.example/monitor/agenda")).toBe(true);
    expect(plano({ desembolsado: true }).trimEnd().endsWith("Ver mi agenda: https://calibra.example/monitor/agenda")).toBe(true);
  });

  it("si el desembolso ya se le transfirió al monitor no dice que no se le desembolsa: es falso, y la decisión no lo anula", () => {
    const llano = plano({ desembolsado: true });
    expect(llano).toContain("Quedó cancelada porque un admin aceptó un reporte de inasistencia.");
    expect(llano).not.toContain("Por eso no se te desembolsa.");
    const { asunto, html, texto } = render("aviso_monitor_inasistencia_aceptada", { desembolsado: true });
    for (const contenido of [asunto, html, texto]) expect(contenido).not.toMatch(/desembols/i);
    // Sin la marca, o con `false`, es el correo de siempre.
    for (const cambios of [{}, { desembolsado: false }]) {
      expect(plano(cambios), JSON.stringify(cambios)).toContain("Por eso no se te desembolsa.");
    }
  });

  it("no lleva el nombre ni el contacto del estudiante, ni montos, ni las observaciones del admin: sus datos tienen solo cuatro claves (P-37)", () => {
    expect(Object.keys(EJEMPLOS.aviso_monitor_inasistencia_aceptada).sort()).toEqual(["enlace", "inicio", "materia", "nombreMonitor"]);
    const { asunto, html, texto } = render("aviso_monitor_inasistencia_aceptada");
    for (const contenido of [asunto, html, texto]) {
      expect(contenido).not.toMatch(/\$|@|comisi|neto|reembolso|observaci/i);
      expect(contenido).not.toContain("Ana");
    }
  });

  it("no lee el reloj: el mismo dato da el mismo cuerpo hoy y dentro de un año (la Idempotency-Key lo exige)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const antes = render("aviso_monitor_inasistencia_aceptada");
      vi.setSystemTime(new Date("2021-01-01T00:00:00Z"));
      expect(render("aviso_monitor_inasistencia_aceptada")).toEqual(antes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escapa en el HTML lo que viene de fuera: nombre del monitor y materia", () => {
    const { html, texto } = render("aviso_monitor_inasistencia_aceptada", { nombreMonitor: "<b>Camilo</b> & Co", materia: "Cálculo <script>" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Camilo&lt;/b&gt; &amp; Co");
    expect(html).toContain("Cálculo &lt;script&gt;");
    expect(texto).toContain("Hola, <b>Camilo</b> & Co.");
  });

  it("un salto de línea en la materia no parte el asunto ni cuela una cabecera", () => {
    const salto = String.fromCharCode(13, 10);
    const { asunto } = render("aviso_monitor_inasistencia_aceptada", { materia: `Cálculo${salto}Bcc: alguien@otro.co` });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("Se aceptó un reporte de inasistencia en tu monitoría de Cálculo Bcc: alguien@otro.co");
  });

  it("un enlace peligroso falla en vez de armar el correo", () => {
    expect(() => render("aviso_monitor_inasistencia_aceptada", { enlace: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it.each<[string, Partial<DatosPorPlantilla["aviso_monitor_inasistencia_aceptada"]>]>([
    ["nombreMonitor", { nombreMonitor: "  " }],
    ["materia", { materia: " \n " }],
    ["inicio", { inicio: "mañana" }],
    ["inicio", { inicio: "" }],
  ])("%s inválido es un error de quien llama, no un correo con hueco", (_campo, cambios) => {
    expect(() => render("aviso_monitor_inasistencia_aceptada", cambios)).toThrow(RangeError);
  });
});

describe("pago rechazado con la cita ya cancelada (HU-076, D-39 d)", () => {
  const plano = (cambios: Partial<DatosPorPlantilla["pago_rechazado_sin_reembolso"]> = {}) =>
    render("pago_rechazado_sin_reembolso", cambios).texto.replace(/[  ]/g, " ");

  it("dice que no se pudo verificar el comprobante, que la cita ya estaba cancelada y que no hay reembolso", () => {
    const { asunto, texto } = render("pago_rechazado_sin_reembolso");
    expect(asunto).toBe("No pudimos verificar tu pago y no hay reembolso");
    expect(texto).toContain("No pudimos verificar tu pago\n");
    const llano = plano();
    expect(llano).toContain("Hola, Ana.");
    expect(llano).toContain("No pudimos verificar tu comprobante de $ 25.000 para la monitoría del 6 de enero de 2020, que ya estaba cancelada.");
    expect(llano).toContain("Como el pago no se aprobó, no hay reembolso.");
    expect(llano).toContain("Si crees que fue un error, escríbenos a ayuda@calibra.example.");
    expect(llano.trimEnd().endsWith("Puedes agendar otra monitoría cuando quieras.")).toBe(true);
  });

  it("no tiene botón ni enlaces", () => {
    const { html, texto } = render("pago_rechazado_sin_reembolso");
    expect(html).not.toContain("<a ");
    expect(texto).not.toContain("https://");
  });

  it.each([undefined, "", "   "])("con %j de soporte no se promete ningún canal", (contactoSoporte) => {
    const { texto } = renderizar("pago_rechazado_sin_reembolso", { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte });
    expect(texto).not.toContain("escríbenos");
    expect(texto).toContain("Puedes agendar otra monitoría cuando quieras.");
  });

  it("el contacto de soporte se escribe sin espacios sobrantes", () => {
    expect(plano({ contactoSoporte: "  ayuda@calibra.example  " })).toContain("escríbenos a ayuda@calibra.example.");
  });

  it("no lleva comisión", () => {
    const { asunto, html, texto } = render("pago_rechazado_sin_reembolso");
    for (const contenido of [asunto, html, texto]) expect(contenido).not.toMatch(/comisi|neto/i);
    expect(Object.keys(EJEMPLOS.pago_rechazado_sin_reembolso).filter((campo) => /comisi|neto/i.test(campo))).toEqual([]);
  });

  it("es determinista y no lee el reloj", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const antes = render("pago_rechazado_sin_reembolso");
      vi.setSystemTime(new Date("2021-01-01T00:00:00Z"));
      expect(render("pago_rechazado_sin_reembolso")).toEqual(antes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escapa en el HTML lo que viene de fuera: el nombre y el soporte", () => {
    const { html, texto } = render("pago_rechazado_sin_reembolso", { nombre: '<img src=x onerror="alert(1)"> & Co', contactoSoporte: "a<b>@x.co" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
    expect(texto).toContain('Hola, <img src=x onerror="alert(1)"> & Co.');
  });

  it("un nombre vacío o una fecha inválida es un error de quien llama, no un correo con hueco", () => {
    expect(() => render("pago_rechazado_sin_reembolso", { nombre: "  " })).toThrow(RangeError);
    expect(() => render("pago_rechazado_sin_reembolso", { fechaSesion: "2020-02-30" })).toThrow(RangeError);
  });
});

describe("confirmación de la cita (HU-019, P-04, D-19 a D-23)", () => {
  const plano = (plantilla: Plantilla, cambios: Partial<DatosPorPlantilla[typeof plantilla]> = {}) =>
    render(plantilla, cambios).texto.replace(/[  ]/g, " ");

  it("dice qué monitoría es: asunto con la materia, el monitor, la fecha y hora en Bogotá, duración, materia, modalidad y valor", () => {
    const { asunto } = render("confirmacion_cita");
    expect(asunto).toBe("Tu monitoría de Cálculo Integral está confirmada");
    const texto = plano("confirmacion_cita");
    expect(texto).toContain("Hola, Ana.");
    expect(texto).toContain("Tu monitoría con Camilo Rojas quedó confirmada.");
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(texto).toContain("Cuándo: lunes, 13 de enero de 2020, 10:00 a. m.");
    expect(texto).toContain("Duración: 90 minutos.");
    expect(texto).toContain("Materia: Cálculo Integral.");
    expect(texto).toContain("Modalidad: presencial.");
    expect(texto).toContain("Valor: $ 25.000.");
  });

  it("lleva el enlace de gestión en el botón y como texto para copiar, y dice que es solo del Lead", () => {
    const { html, texto } = render("confirmacion_cita");
    expect(html).toContain('href="https://calibra.example/cita?token=abc123"');
    expect(texto).toContain("Ver o gestionar mi cita: https://calibra.example/cita?token=abc123");
    expect(texto).toContain("Este enlace es solo tuyo. No lo compartas.");
  });

  it("una presencial trae el lugar (D-5) y no el enlace de la videollamada", () => {
    const texto = plano("confirmacion_cita");
    expect(texto).toContain("Lugar: Edificio Principal, salón 301.");
    expect(texto).not.toContain("videollamada");
    // Aunque el dato traiga un enlace, una presencial no lo muestra.
    expect(plano("confirmacion_cita", { enlaceSesion: "https://meet.example/abc" })).not.toContain("meet.example");
  });

  it("una virtual trae el enlace de la videollamada y no el lugar", () => {
    const texto = plano("confirmacion_cita", { presencial: false, lugar: null, enlaceSesion: "https://meet.example/abc-def" });
    expect(texto).toContain("Modalidad: virtual.");
    expect(texto).toContain("Enlace de la videollamada: https://meet.example/abc-def");
    expect(texto).not.toContain("Lugar:");
    expect(plano("confirmacion_cita", { presencial: false, lugar: "Edificio Principal", enlaceSesion: null })).not.toContain("Edificio Principal");
  });

  it("sin lugar o sin enlace no inventa la línea: el dato puede faltar", () => {
    expect(plano("confirmacion_cita", { lugar: null })).not.toContain("Lugar:");
    expect(plano("confirmacion_cita", { presencial: false, enlaceSesion: null })).not.toContain("videollamada");
  });

  it("dice hasta cuándo se puede cancelar, y si ya no se podía al confirmar lo dice sin escribir un plazo", () => {
    // 03:00 UTC son las 10:00 p. m. del día anterior en Bogotá.
    expect(plano("confirmacion_cita")).toContain("Puedes cancelarla hasta el domingo, 12 de enero de 2020, 10:00 p. m.");
    const sin = plano("confirmacion_cita", { cancelableHasta: null });
    expect(sin).toContain("No podrás cancelarla: cuando la agendaste ya había pasado el plazo para hacerlo.");
    expect(sin).not.toContain("Puedes cancelarla");
  });

  it("del pago dice lo que fija D-22: se recibió el comprobante y un admin lo revisa, sin prometer que está aprobado", () => {
    const texto = plano("confirmacion_cita");
    expect(texto).toContain("Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos a este correo.");
    expect(texto).not.toMatch(/aprobad/i);
  });

  it("dice que la página siempre muestra el lugar o el enlace actual (D-23)", () => {
    expect(plano("confirmacion_cita")).toContain("Si el lugar o el enlace cambian, la página de tu monitoría siempre muestra el dato actual.");
  });

  it("no lleva comisión ni el contacto del monitor ni del Lead: sus datos no los incluyen (P-37, P-32)", () => {
    expect(Object.keys(EJEMPLOS.confirmacion_cita).filter((campo) => /comisi|correo|telefono|contacto|neto/i.test(campo))).toEqual([]);
    const { asunto, html, texto } = render("confirmacion_cita");
    for (const contenido of [asunto, html, texto]) expect(contenido).not.toMatch(/comisi|neto/i);
  });

  it("no lee el reloj: el mismo dato da el mismo cuerpo hoy y dentro de un año (la Idempotency-Key lo exige)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const antes = render("confirmacion_cita");
      vi.setSystemTime(new Date("2021-01-01T00:00:00Z"));
      expect(render("confirmacion_cita")).toEqual(antes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escapa en el HTML lo que viene de fuera: nombres, materia y lugar", () => {
    const nombre = '<img src=x onerror="alert(1)">';
    const { html, texto } = render("confirmacion_cita", { nombre, nombreMonitor: "<b>Camilo</b>", lugar: "Salón <script>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(texto).toContain(`Hola, ${nombre}.`);
  });

  it("un salto de línea en la materia no parte el asunto ni cuela una cabecera", () => {
    const salto = String.fromCharCode(13, 10);
    const { asunto } = render("confirmacion_cita", { materia: `Cálculo${salto}Bcc: alguien@otro.co` });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("Tu monitoría de Cálculo Bcc: alguien@otro.co está confirmada");
  });

  it("un enlace de videollamada que no es https o un enlace de gestión peligroso fallan en vez de armar el correo", () => {
    expect(() => render("confirmacion_cita", { presencial: false, enlaceSesion: "javascript:alert(1)" })).toThrow(RangeError);
    expect(() => render("confirmacion_cita", { enlace: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it.each([
    ["nombre", { nombre: "  " }],
    ["nombreMonitor", { nombreMonitor: "" }],
    ["materia", { materia: " \n " }],
    ["lugar", { lugar: "   " }],
    ["inicio", { inicio: "mañana" }],
    ["cancelableHasta", { cancelableHasta: "pronto" }],
    ["duracionMin", { duracionMin: 0 }],
    ["duracionMin", { duracionMin: 1.5 }],
    ["valorTotal", { valorTotal: -1 }],
    ["valorTotal", { valorTotal: 25_000.5 }],
  ] as const)("%s inválido es un error de quien llama, no un correo con hueco", (_campo, cambios) => {
    expect(() => render("confirmacion_cita", cambios)).toThrow(RangeError);
  });
});

describe("cancelación de la cita (HU-024, D-26 a D-28, P-07)", () => {
  const plano = (cambios: Partial<DatosPorPlantilla["cancelacion_cita"]> = {}) =>
    render("cancelacion_cita", cambios).texto.replace(/[  ]/g, " ");
  const LLAVE = (n: number) => `https://calibra.example/reembolso?token=${String(n).repeat(64)}`;
  const SIN_REEMBOLSOS = { reembolsos: [] };

  it("dice qué cancelaste: asunto con la materia, título, saludo, la fecha y hora en Bogotá y que la fecha quedó libre", () => {
    const { asunto, texto } = render("cancelacion_cita");
    expect(asunto).toBe("Cancelaste tu monitoría de Cálculo Integral");
    const llano = plano();
    expect(texto).toContain("Tu monitoría quedó cancelada");
    expect(llano).toContain("Hola, Ana.");
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(llano).toContain("Cancelaste tu monitoría de Cálculo Integral del lunes, 13 de enero de 2020, 10:00 a. m. La fecha quedó libre.");
  });

  it("con un reembolso: devuelve el valor, pide la llave con el botón «Enviar mi llave» y el pie solo habla de la llave", () => {
    const { html } = render("cancelacion_cita");
    const llano = plano();
    expect(llano).toContain(
      "Vamos a devolverte $ 25.000. Para hacer la transferencia necesitamos tu llave, por ejemplo tu celular o tu correo registrado en el banco.",
    );
    expect(llano).toContain("Enviar mi llave: https://calibra.example/reembolso?token=abc123");
    expect(html).toContain('href="https://calibra.example/reembolso?token=abc123"');
    expect(llano).toContain("Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.");
    // El enlace de la cita no compite con el de la llave: el botón es uno solo.
    expect(llano).not.toContain("Ver mi cita");
    expect(llano).not.toContain("Puedes agendar otra monitoría");
  });

  it("con varios reembolsos: suma el total, el botón lleva el primero y cada otro pago tiene su línea con su enlace", () => {
    const llano = plano({
      reembolsos: [
        { monto: 15_000, enlace: LLAVE(1) },
        { monto: 6_000, enlace: LLAVE(2) },
        { monto: 4_000, enlace: LLAVE(3) },
      ],
    });
    expect(llano).toContain("Vamos a devolverte $ 25.000.");
    expect(llano).toContain(`Enviar mi llave: ${LLAVE(1)}`);
    expect(llano).toContain(`La llave del otro pago de $ 6.000: ${LLAVE(2)}`);
    expect(llano).toContain(`La llave del otro pago de $ 4.000: ${LLAVE(3)}`);
    expect(llano.match(/La llave del otro pago/g)).toHaveLength(2);
  });

  it("con el pago de otra persona (otro correo): avisa que se le escribe a quien pagó, sin pedirle nada a este destinatario", () => {
    const llano = plano({ ...SIN_REEMBOLSOS, reembolsoAOtroContacto: true });
    expect(llano).toContain("Le escribimos a quien pagó, a su correo, para pedirle la llave y devolverle el dinero.");
    expect(llano).not.toContain("Vamos a devolverte");
    expect(llano).not.toContain("Enviar mi llave");
    expect(plano()).not.toContain("Le escribimos a quien pagó");
  });

  it("con un pago en revisión: el texto exacto de D-27, con o sin reembolsos", () => {
    const texto = "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.";
    expect(plano({ ...SIN_REEMBOLSOS, conPagoEnRevision: true })).toContain(texto);
    expect(plano({ conPagoEnRevision: true })).toContain(texto);
    expect(plano()).not.toContain("todavía está en revisión");
  });

  it("sin reembolsos y con enlace de la cita: botón «Ver mi cita» y el pie de agendar otra", () => {
    const { html } = render("cancelacion_cita", SIN_REEMBOLSOS);
    const llano = plano(SIN_REEMBOLSOS);
    expect(llano).toContain("Ver mi cita: https://calibra.example/cita?token=abc123");
    expect(html).toContain('href="https://calibra.example/cita?token=abc123"');
    expect(llano).toContain("Puedes agendar otra monitoría cuando quieras.");
    expect(llano).not.toContain("Enviar mi llave");
    expect(llano).not.toContain("Solo te pedimos la llave");
  });

  it("sin reembolsos ni enlace de la cita: sin botón ni enlaces", () => {
    const { html, texto } = render("cancelacion_cita", { ...SIN_REEMBOLSOS, enlaceCita: null });
    expect(html).not.toContain("<a ");
    expect(texto).not.toContain("https://");
    expect(texto).toContain("Puedes agendar otra monitoría cuando quieras.");
  });

  it("no lleva comisión ni el contacto del monitor ni del Lead: sus datos no los incluyen (P-37, P-32)", () => {
    // `reembolsoAOtroContacto` es solo un aviso (booleano): no lleva el correo de nadie.
    const campos = Object.keys(EJEMPLOS.cancelacion_cita).filter((campo) => campo !== "reembolsoAOtroContacto");
    expect(campos.filter((campo) => /comisi|correo|telefono|contacto|neto|monitor/i.test(campo))).toEqual([]);
    expect(typeof EJEMPLOS.cancelacion_cita.reembolsoAOtroContacto).toBe("boolean");
    for (const cambios of [{}, SIN_REEMBOLSOS, { conPagoEnRevision: true, reembolsoAOtroContacto: true }]) {
      const { asunto, html, texto } = render("cancelacion_cita", cambios);
      for (const contenido of [asunto, html, texto]) expect(contenido).not.toMatch(/comisi|neto/i);
    }
  });

  it("no lee el reloj: el mismo dato da el mismo cuerpo hoy y dentro de un año (la Idempotency-Key lo exige)", () => {
    vi.useFakeTimers();
    try {
      for (const cambios of [{}, SIN_REEMBOLSOS, { conPagoEnRevision: true, reembolsoAOtroContacto: true }]) {
        vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
        const antes = render("cancelacion_cita", cambios);
        vi.setSystemTime(new Date("2021-01-01T00:00:00Z"));
        expect(render("cancelacion_cita", cambios)).toEqual(antes);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("escapa en el HTML lo que viene de fuera: nombre y materia", () => {
    const { html, texto } = render("cancelacion_cita", { nombre: '<img src=x onerror="alert(1)">', materia: "Cálculo <script>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Cálculo &lt;script&gt;");
    expect(texto).toContain('Hola, <img src=x onerror="alert(1)">.');
  });

  it("un salto de línea en la materia no parte el asunto ni cuela una cabecera", () => {
    const salto = String.fromCharCode(13, 10);
    const { asunto } = render("cancelacion_cita", { materia: `Cálculo${salto}Bcc: alguien@otro.co` });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("Cancelaste tu monitoría de Cálculo Bcc: alguien@otro.co");
  });

  it("los enlaces pasan por enlaceSeguro: uno peligroso falla en vez de armar el correo, venga del botón o de otra línea", () => {
    expect(() => render("cancelacion_cita", { reembolsos: [{ monto: 25_000, enlace: "javascript:alert(1)" }] })).toThrow(RangeError);
    expect(() =>
      render("cancelacion_cita", {
        reembolsos: [
          { monto: 25_000, enlace: LLAVE(1) },
          { monto: 5_000, enlace: "data:text/html,x" },
        ],
      }),
    ).toThrow(RangeError);
    expect(() => render("cancelacion_cita", { ...SIN_REEMBOLSOS, enlaceCita: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it.each<[string, Partial<DatosPorPlantilla["cancelacion_cita"]>]>([
    ["nombre", { nombre: "  " }],
    ["materia", { materia: " \n " }],
    ["inicio", { inicio: "mañana" }],
    ["monto", { reembolsos: [{ monto: -1, enlace: "https://calibra.example/reembolso?token=abc123" }] }],
    ["monto", { reembolsos: [{ monto: 25_000.5, enlace: "https://calibra.example/reembolso?token=abc123" }] }],
  ])("%s inválido es un error de quien llama, no un correo con hueco", (_campo, cambios) => {
    expect(() => render("cancelacion_cita", cambios)).toThrow(RangeError);
  });
});

describe("lo que viene de fuera no se interpreta como HTML", () => {
  it("escapa etiquetas y comillas de un nombre en el HTML, y las deja tal cual en el texto plano", () => {
    const nombre = '<img src=x onerror="alert(1)"> & compañía';
    const { html, texto } = render("recuperacion_diagnostico", { nombre });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; compañía");
    expect(texto).toContain(`Hola, ${nombre}.`);
  });

  it("un valor con salto de línea no parte el asunto ni cuela una cabecera", () => {
    const { asunto } = render("resena_individual", { monitor: "Camilo\r\nBcc: alguien@otro.co" });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("¿Cómo te fue con Camilo Bcc: alguien@otro.co?");
  });

  it.each(["", "   ", "\n\t"])("un nombre vacío (%j) es un error de quien llama, no un correo con hueco", (nombre) => {
    expect(() => render("recuperacion_diagnostico", { nombre })).toThrow(RangeError);
    expect(() => render("escalamiento_pago", { nombreAdmin: nombre })).toThrow(/nombreAdmin/);
  });

  it("una fecha de sesión inválida es un error", () => {
    expect(() => render("pago_rechazado_individual", { fechaSesion: "2020-02-30" })).toThrow(RangeError);
  });
});

describe("enlaces", () => {
  it("acepta https y http y los devuelve normalizados", () => {
    expect(enlaceSeguro("https://calibra.example/a?x=1&y=2")).toBe("https://calibra.example/a?x=1&y=2");
    expect(enlaceSeguro("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp:", "ftp://calibra.example/a"],
    ["sin protocolo", "calibra.example/a"],
    ["ruta relativa", "/admin"],
    ["con espacio", "https://calibra.example/a b"],
    ["con salto de línea", "https://calibra.example/a\nBcc: x@y.co"],
    ["vacío", ""],
  ])("rechaza %s", (_nombre, enlace) => {
    expect(() => enlaceSeguro(enlace)).toThrow(RangeError);
  });

  describe("https en producción (HU-064)", () => {
    const PRODUCCION = { NODE_ENV: "production" };

    it("en producción solo acepta https: un enlace http a otro host falla", () => {
      expect(enlaceSeguro("https://calibra.example/r?token=abc", PRODUCCION)).toBe("https://calibra.example/r?token=abc");
      expect(() => enlaceSeguro("http://calibra.example/r?token=abc", PRODUCCION)).toThrow("En producción el enlace debe ser https.");
      expect(() => enlaceSeguro("http://127.0.0.1.evil.com/", PRODUCCION)).toThrow(RangeError);
      expect(() => enlaceSeguro("http://localhost.evil.com/", PRODUCCION)).toThrow(RangeError);
    });

    it("en producción, http sigue sirviendo hacia esta misma máquina (la e2e corre el build contra localhost)", () => {
      expect(enlaceSeguro("http://localhost:3000/r", PRODUCCION)).toBe("http://localhost:3000/r");
      expect(enlaceSeguro("http://127.0.0.1:3000/r", PRODUCCION)).toBe("http://127.0.0.1:3000/r");
      expect(enlaceSeguro("http://[::1]:3000/r", PRODUCCION)).toBe("http://[::1]:3000/r");
    });

    it.each([
      ["un host que solo parece local (usuario localhost y host real)", "http://localhost@evil.com/"],
      ["0.0.0.0, que no es esta máquina para un correo", "http://0.0.0.0/"],
      ["localhost con punto final", "http://localhost./"],
      ["IPv6 mapeada a IPv4, que la URL normaliza a otro texto", "http://[::ffff:127.0.0.1]/"],
    ])("en producción rechaza http hacia %s", (_nombre, enlace) => {
      expect(() => enlaceSeguro(enlace, PRODUCCION)).toThrow(RangeError);
    });

    it("fuera de producción, http se acepta hacia cualquier host", () => {
      expect(enlaceSeguro("http://calibra.example/r", { NODE_ENV: "development" })).toBe("http://calibra.example/r");
      expect(enlaceSeguro("http://calibra.example/r", {})).toBe("http://calibra.example/r");
    });

    it("ningún entorno acepta otro protocolo", () => {
      for (const entorno of [PRODUCCION, { NODE_ENV: "development" }]) {
        expect(protocoloAdmitido(new URL("ftp://calibra.example"), entorno)).toBe(false);
        expect(protocoloAdmitido(new URL("javascript:alert(1)"), entorno)).toBe(false);
      }
    });

    it("el mensaje del error no repite el enlace, que puede traer un token", () => {
      let mensaje = "";
      try {
        enlaceSeguro("http://calibra.example/r?token=SECRETO123", PRODUCCION);
      } catch (error) {
        mensaje = (error as Error).message;
      }
      expect(mensaje).toBe("En producción el enlace debe ser https.");
      expect(mensaje).not.toContain("SECRETO123");
    });

    describe("con NODE_ENV=production de verdad (la ruta que sigue una plantilla al armar el correo)", () => {
      afterEach(() => vi.unstubAllEnvs());

      it("una plantilla con un enlace http a otro host falla con RangeError", () => {
        vi.stubEnv("NODE_ENV", "production");
        expect(() => render("recuperacion_diagnostico", { enlace: "http://calibra.example/resultados?token=abc123" })).toThrow(RangeError);
        expect(() => render("recuperacion_diagnostico", { enlace: "http://calibra.example/resultados?token=abc123" })).toThrow(
          "En producción el enlace debe ser https.",
        );
      });

      it("con https arma el correo, y con http hacia localhost también", () => {
        vi.stubEnv("NODE_ENV", "production");
        expect(render("recuperacion_diagnostico").texto).toContain(`Ver mis resultados: ${ENLACE}`);
        expect(render("recuperacion_diagnostico", { enlace: "http://localhost:3000/r" }).texto).toContain("http://localhost:3000/r");
      });
    });
  });

  it("una plantilla con un enlace peligroso falla en vez de armar el correo", () => {
    expect(() => render("recuperacion_diagnostico", { enlace: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it("el enlace del botón va escapado en el href y también como texto para copiar", () => {
    const enlace = "https://calibra.example/r?a=1&b=2";
    const { html } = render("recuperacion_diagnostico", { enlace });
    expect(html).toContain('href="https://calibra.example/r?a=1&amp;b=2"');
    expect(html).toContain("Si el botón no abre, copia este enlace en tu navegador: https://calibra.example/r?a=1&amp;b=2");
  });
});

describe("escaparHtml y el armado", () => {
  it("escapa los cinco caracteres que abren una etiqueta o un atributo", () => {
    expect(escaparHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escaparHtml("sin nada raro: ñ, á, ¿?")).toBe("sin nada raro: ñ, á, ¿?");
  });

  it("sin botón no hay enlace ni el aviso de copiarlo; sin pie no hay pie", () => {
    const contenido = { titulo: "Hola", parrafos: ["Un párrafo."] };
    const html = armarHtml(contenido);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("copia este enlace");
    expect(armarTexto(contenido)).toBe("Calibra\n\nHola\n\nUn párrafo.\n");
  });

  it("el texto plano separa los bloques con una línea en blanco y termina con salto de línea", () => {
    const texto = armarTexto({ titulo: "T", parrafos: ["A", "B"], boton: { texto: "Ir", enlace: "https://x.co/" }, pie: "P" });
    expect(texto).toBe("Calibra\n\nT\n\nA\n\nB\n\nIr: https://x.co/\n\nP\n");
  });
});

describe("todo texto libre que llega al asunto se limpia de saltos de línea, y ninguno puede venir vacío", () => {
  const salto = String.fromCharCode(13, 10);

  it.each([
    ["recuperacion_diagnostico", "materia"],
    ["resena_individual", "monitor"],
    ["escalamiento_pago", "nombrePagador"],
  ] as const)("%s: un salto de línea en %s no parte el asunto ni cuela una cabecera", (plantilla, campo) => {
    const { asunto } = render(plantilla, { [campo]: `X${salto}Bcc: a@b.co` } as Partial<DatosPorPlantilla[typeof plantilla]>);
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toContain("X Bcc: a@b.co");
  });

  it.each([
    ["recuperacion_diagnostico", "materia"],
    ["resena_individual", "monitor"],
    ["escalamiento_pago", "nombrePagador"],
    ["solicitud_llave_reembolso", "motivo"],
    ["recordatorio_llave_reembolso", "motivo"],
    ["recordatorio_llave_reembolso", "nombre"],
  ] as const)("%s: %s vacío o en blanco es un error, no un correo con hueco", (plantilla, campo) => {
    for (const vacio of ["", "   ", String.fromCharCode(10, 9)]) {
      const cambios = { [campo]: vacio } as Partial<DatosPorPlantilla[typeof plantilla]>;
      expect(() => render(plantilla, cambios), `${campo}=${JSON.stringify(vacio)}`).toThrow(new RegExp(campo));
    }
  });
});

describe("el contacto de soporte es opcional", () => {
  it.each([undefined, "", "   "])("con %j no se promete ningún canal de soporte", (contactoSoporte) => {
    const { texto } = renderizar("pago_rechazado_individual", { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte });
    expect(texto).not.toContain("escríbenos");
  });

  it("con uno informado lo escribe, sin espacios sobrantes", () => {
    const { texto } = render("pago_rechazado_individual", { contactoSoporte: "  ayuda@calibra.example  " });
    expect(texto).toContain("escríbenos a ayuda@calibra.example.");
  });
});

describe("la puntuación no se duplica cuando el dato ya termina en punto", () => {
  it("un nombre con punto final no deja dos puntos, y uno sin punto recibe el suyo", () => {
    expect(render("recuperacion_diagnostico", { nombre: "Ana M." }).texto).toContain("Hola, Ana M.\n");
    expect(render("recuperacion_diagnostico", { nombre: "Ana" }).texto).toContain("Hola, Ana.\n");
    expect(render("escalamiento_pago", { nombreAdmin: "Admin S." }).texto).toContain("Hola, Admin S.\n");
    expect(render("recuperacion_diagnostico", { nombre: "Ana M." }).texto).not.toContain("..");
  });

  it("un motivo con interrogación o exclamación no termina en ?. ni !.", () => {
    expect(render("solicitud_llave_reembolso", { motivo: "¿El monitor no llegó?" }).texto).toContain("Motivo: ¿El monitor no llegó?\n");
    expect(render("solicitud_llave_reembolso", { motivo: "Cancelaste a tiempo" }).texto).toContain("Motivo: Cancelaste a tiempo.\n");
    expect(render("solicitud_llave_reembolso", { motivo: "El monitor no asistió." }).texto).toContain("Motivo: El monitor no asistió.\n");
  });

  it("una materia con punto final no deja dos puntos antes de la frase siguiente", () => {
    const { texto } = render("recuperacion_diagnostico", { materia: "Cálculo I." });
    expect(texto).toContain("diagnóstico de Cálculo I. Con este enlace");
    expect(texto).not.toContain("..");
  });
});

describe("los errores de validación no repiten un enlace que puede traer un token", () => {
  it("enlaceSeguro no copia el enlace inválido en el mensaje", () => {
    for (const enlace of ["no es una url?token=SECRETO123", "https://calibra.example/a b?token=SECRETO123"]) {
      try {
        enlaceSeguro(enlace);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain("SECRETO123");
      }
    }
  });
});

describe("el HTML respeta las reglas de diseño del producto", () => {
  const html = render("recuperacion_diagnostico").html;

  it("usa los mismos colores que src/styles/tokens.css: si el token cambia, el correo también", () => {
    const tokens = readFileSync(join(__dirname, "../../styles/tokens.css"), "utf8");
    const valorDe = (token: string) => new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1].toLowerCase();
    const enHtml = html.toLowerCase();
    for (const token of ["bg", "text", "primary", "muted"]) {
      expect(enHtml, `--${token}`).toContain(valorDe(token));
    }
  });

  it("el botón mide 44 px o más de alto: el interlineado de 24 px más el relleno de arriba y de abajo", () => {
    const boton = /<a href=[^>]*style="([^"]*)"/.exec(html)![1];
    const relleno = Number(/padding:(\d+)px/.exec(boton)![1]);
    const interlineado = 16 * 1.5; // font-size y line-height que hereda del body
    expect(2 * relleno + interlineado).toBeGreaterThanOrEqual(44);
  });
});

describe("verificación del correo del Lead (HU-068, P-23)", () => {
  it("saluda al dueño del correo, explica qué pasa al confirmar y cuándo vence, y avisa que puede ignorarlo", () => {
    const { asunto, texto } = render("verificacion_lead");
    expect(asunto).toBe("Confirma tu correo para agendar en Calibra");
    expect(texto).toContain("Hola, Ana.");
    expect(texto).toContain("el navegador donde lo abras queda con tus datos");
    expect(texto).toContain("El enlace sirve una sola vez y vence el");
    expect(texto).toContain(`Confirmar mi correo: ${ENLACE}`);
    expect(texto).toContain("Si no fuiste tú, ignora este correo");
  });

  it("un nombre vacío o una fecha inválida es un error", () => {
    expect(() => render("verificacion_lead", { nombre: "  " })).toThrow(RangeError);
    expect(() => render("verificacion_lead", { venceEn: "mañana" })).toThrow(RangeError);
  });
});

describe("el pedido de la llave y su recordatorio (HU-025, P-10, D-37)", () => {
  const plano = (texto: string) => texto.replace(/[\u00a0\u202f]/g, " ");

  it.each(["solicitud_llave_reembolso", "recordatorio_llave_reembolso"] as const)(
    "%s dice hasta cuándo se puede enviar la llave, en Bogotá, y qué pasa si no llega, con el correo de soporte",
    (plantilla) => {
      const texto = plano(render(plantilla).texto);
      // 15:00 UTC son las 10:00 a. m. en Bogotá.
      expect(texto).toContain(
        "Tienes hasta el lunes, 13 de enero de 2020, 10:00 a. m. para enviarla. Si no nos llega a tiempo, cerramos el caso; para reabrirlo, escríbenos a ayuda@calibra.example.",
      );
      expect(texto).toContain(`Enviar mi llave: ${ENLACE}`);
      expect(texto).toContain("Calibra nunca te pide claves del banco");
    },
  );

  it.each(["solicitud_llave_reembolso", "recordatorio_llave_reembolso"] as const)("%s sin contacto de soporte no promete ningún canal", (plantilla) => {
    for (const contactoSoporte of [undefined, "", "   "]) {
      const texto = plano(render(plantilla, { contactoSoporte }).texto);
      expect(texto, JSON.stringify(contactoSoporte)).toContain("Si no nos llega a tiempo, cerramos el caso.\n");
      expect(texto).not.toContain("escríbenos");
    }
  });

  it.each(["solicitud_llave_reembolso", "recordatorio_llave_reembolso"] as const)("%s: una fecha de vencimiento inválida es un error", (plantilla) => {
    expect(() => render(plantilla, { venceEn: "en una semana" })).toThrow(/venceEn/);
  });

  it("el pedido de una inasistencia dice que se aceptó el reporte (D-37), y el de una cancelación no", () => {
    const aceptado = render("solicitud_llave_reembolso", { reporteAceptado: true, motivo: "El monitor no asistió a la monitoría." }).texto;
    expect(aceptado).toContain("Revisamos el reporte de que el monitor no asistió a la monitoría y lo aceptamos: la monitoría quedó cancelada.");
    expect(aceptado).toContain("Motivo: El monitor no asistió a la monitoría.");
    // El aviso del reporte va antes del monto.
    expect(aceptado.indexOf("Revisamos el reporte")).toBeLessThan(aceptado.indexOf("Vamos a devolverte"));
    expect(render("solicitud_llave_reembolso").texto).not.toContain("reporte");
  });

  it("el recordatorio dice que la llave todavía no llega, con el monto y el motivo", () => {
    const { asunto, texto } = render("recordatorio_llave_reembolso");
    expect(plano(asunto)).toBe("Todavía necesitamos tu llave para devolverte $ 25.000");
    expect(plano(texto)).toContain(
      "Te pedimos tu llave para devolverte $ 25.000 de tu pago en Calibra y todavía no nos llega. Motivo: Cancelaste la monitoría a tiempo.",
    );
    expect(texto).toContain("Todavía no tenemos tu llave");
    expect(texto).toContain("Si ya nos la enviaste, ignora este correo.");
  });

  it("los dos llevan un solo enlace, el de la página de la llave", () => {
    for (const plantilla of ["solicitud_llave_reembolso", "recordatorio_llave_reembolso"] as const) {
      const { html } = render(plantilla);
      expect([...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]), plantilla).toEqual([ENLACE]);
    }
  });
});
