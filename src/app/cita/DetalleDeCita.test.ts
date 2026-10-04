import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Cita } from "@/lib/citas/reglas";
import { DetalleDeCita, EnlaceQueNoSirve, NoPudimosCargar } from "./DetalleDeCita";

// Sin navegador ni base: se pinta cada vista de la cita con la hora que fija la prueba y se lee el HTML. El recorrido
// con el enlace del correo y con la sesión, con datos reales, lo cubre e2e/cita.spec.ts.

const HORA = 3_600_000;
const INICIO = new Date("2026-10-07T15:00:00.000Z"); // miércoles 7 de octubre, 10:00 a. m. en Bogotá
const AHORA = new Date("2026-10-05T15:00:00.000Z"); // 2 días antes

const PRESENCIAL: Cita = {
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
  observacionesReporte: null,
};

const VIRTUAL: Cita = { ...PRESENCIAL, presencial: false, lugar: null, enlace: "https://meet.example/abc-defg-hij" };

const pintar = (cita: Cita, ahora: Date = AHORA, extra: { conLista?: boolean; acciones?: string; contactoSoporte?: string | null } = {}) =>
  renderToStaticMarkup(
    createElement(DetalleDeCita, {
      cita,
      ahora,
      conLista: extra.conLista,
      contactoSoporte: extra.contactoSoporte,
      acciones: extra.acciones ? createElement("button", { type: "button" }, extra.acciones) : undefined,
    }),
  );

/** El texto visible: sin etiquetas, con los espacios duros y los repetidos normalizados (y sin el que deja una etiqueta antes de un punto). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\xa0 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1");

const titulo = (html: string) => texto(/<h1[^>]*>.*?<\/h1>/.exec(html)?.[0] ?? "").trim();

describe("DetalleDeCita (HU-019): confirmada antes del inicio, con plazo", () => {
  const html = pintar(PRESENCIAL);
  const t = texto(html);

  it("dice que está confirmada y muestra el resumen con el lugar", () => {
    expect(titulo(html)).toBe("Tu monitoría está confirmada");
    expect(t).toContain("Cálculo Diferencial");
    expect(t).toContain("Laura Gómez");
    expect(t).toContain("Miércoles, 7 de octubre");
    expect(t).toContain("10:00 a 11:00 (60 min)");
    expect(t).toContain("Presencial");
    expect(t).toContain("Lugar Edificio Santo Domingo, salón 301");
    expect(t).toContain("$ 32.000");
  });

  it("dice hasta cuándo puede cancelarla, en hora de Bogotá, y cuánto queda", () => {
    expect(t).toContain("Puedes cancelarla hasta el martes, 6 de octubre de 2026, 10:00 p. m. Quedan 1 d 12 h.");
    expect(t).not.toContain("..");
  });

  it("explica el pago con la frase de D-22, sin prometer que está aprobado", () => {
    expect(t).toContain("Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos por correo.");
    expect(t).not.toContain("aprobado");
  });

  it("sin acciones que pasarle no pone botones, ni cifras de comisión, y no ofrece la lista sin sesión", () => {
    expect(html).not.toContain("<button");
    expect(t).not.toMatch(/comisi/i);
    expect(t).not.toContain("Ver mis citas");
  });

  it("con el pago aprobado lo dice", () => {
    expect(texto(pintar({ ...PRESENCIAL, estadoPago: "aprobado" }))).toContain("Tu pago está aprobado.");
  });

  it("el hueco de las acciones muestra lo que le pasan y la lista aparece con la sesión", () => {
    const conAcciones = pintar(PRESENCIAL, AHORA, { acciones: "Cancelar mi cita", conLista: true });
    expect(conAcciones).toContain("<button");
    expect(texto(conAcciones)).toContain("Cancelar mi cita");
    expect(conAcciones).toMatch(/<a[^>]*href="\/cita"[^>]*>Ver mis citas<\/a>/);
  });
});

describe("DetalleDeCita (HU-019): confirmada virtual", () => {
  it("muestra el enlace de la videollamada como enlace seguro y no el lugar", () => {
    const html = pintar(VIRTUAL);
    expect(texto(html)).toContain("Virtual");
    expect(texto(html)).toContain("Enlace de la videollamada");
    expect(html).toMatch(/<a[^>]*href="https:\/\/meet\.example\/abc-defg-hij"[^>]*>Abrir la videollamada<\/a>/);
    expect(html).toMatch(/<a[^>]*rel="noopener noreferrer"/);
    expect(texto(html)).not.toContain("Lugar");
  });

  it("un enlace que no es https no se vuelve enlace", () => {
    for (const enlace of ["javascript:alert(1)", "http://meet.example/a", "data:text/html,hola"]) {
      const html = pintar({ ...VIRTUAL, enlace });
      expect(html, enlace).not.toContain(enlace);
      expect(texto(html), enlace).not.toContain("Enlace de la videollamada");
    }
  });
});

describe("DetalleDeCita (HU-019): confirmada antes del inicio, sin plazo", () => {
  it("con el límite exacto todavía se puede cancelar; un instante después ya no (P-40)", () => {
    const exacto = texto(pintar(PRESENCIAL, PRESENCIAL.cancelableHasta));
    expect(exacto).toContain("Puedes cancelarla hasta el martes, 6 de octubre de 2026, 10:00 p. m.");

    const pasado = pintar(PRESENCIAL, new Date(PRESENCIAL.cancelableHasta.getTime() + 1));
    expect(texto(pasado)).toContain("El plazo para cancelarla terminó el martes, 6 de octubre de 2026, 10:00 p. m.");
    expect(texto(pasado)).not.toContain("..");
    expect(texto(pasado)).not.toContain("Puedes cancelarla");
    // Aún no empieza: se sigue mostrando dónde es.
    expect(texto(pasado)).toContain("Lugar Edificio Santo Domingo, salón 301");
  });

  it("una cita agendada con menos de 12 horas (RN-37) nace sin plazo", () => {
    const tarde = { ...PRESENCIAL, cancelableHasta: new Date(AHORA.getTime() - HORA) };
    expect(texto(pintar(tarde))).toContain("El plazo para cancelarla terminó el");
  });
});

describe("DetalleDeCita (HU-024, criterio 3): sin plazo para cancelar", () => {
  const SIN_PLAZO = new Date(PRESENCIAL.cancelableHasta.getTime() + 1);
  const FUERZA_MAYOR = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";

  it("explica que los casos de fuerza mayor los resuelve un admin y da el correo de soporte", () => {
    const html = pintar(PRESENCIAL, SIN_PLAZO, { contactoSoporte: "soporte@calibra.example" });
    expect(texto(html)).toContain(`${FUERZA_MAYOR}: escríbenos a soporte@calibra.example.`);
    expect(texto(html)).not.toContain("..");
    // Es una explicación, no una acción: sin botones.
    expect(html).not.toContain("<button");
  });

  it("sin correo de soporte no promete un canal que no existe", () => {
    for (const contactoSoporte of [null, undefined, "  "]) {
      const t = texto(pintar(PRESENCIAL, SIN_PLAZO, { contactoSoporte }));
      expect(t, String(contactoSoporte)).toContain(`${FUERZA_MAYOR}.`);
      expect(t, String(contactoSoporte)).not.toContain("escríbenos");
    }
  });

  it("también lo dice la cita agendada con menos de 12 horas (RN-37)", () => {
    const tarde = { ...PRESENCIAL, cancelableHasta: new Date(AHORA.getTime() - HORA) };
    expect(texto(pintar(tarde))).toContain(`${FUERZA_MAYOR}.`);
  });

  it("con plazo no habla de fuerza mayor, y el límite exacto todavía cuenta como con plazo (P-40)", () => {
    expect(texto(pintar(PRESENCIAL, AHORA, { contactoSoporte: "soporte@calibra.example" }))).not.toContain("fuerza mayor");
    expect(texto(pintar(PRESENCIAL, PRESENCIAL.cancelableHasta, { contactoSoporte: "soporte@calibra.example" }))).not.toContain("fuerza mayor");
  });

  it("cuando ya empezó, terminó, se realizó o se canceló ya no hay nada que explicar del plazo", () => {
    const soporte = { contactoSoporte: "soporte@calibra.example" };
    const casos = [
      pintar(PRESENCIAL, new Date(INICIO.getTime() + 30 * 60_000), soporte),
      pintar(PRESENCIAL, new Date(PRESENCIAL.finProgramado.getTime() + 1), soporte),
      pintar({ ...PRESENCIAL, estado: "realizada" }, new Date(INICIO.getTime() + 2 * HORA), soporte),
      pintar({ ...PRESENCIAL, estado: "cancelada", motivoCancelacion: "estudiante" }, SIN_PLAZO, soporte),
    ];
    for (const html of casos) expect(texto(html)).not.toContain("fuerza mayor");
  });
});

describe("DetalleDeCita (HU-019): en curso y terminada", () => {
  it("en curso dice que ya empezó, muestra el lugar y ya no habla del plazo ni del pago", () => {
    const html = pintar(PRESENCIAL, new Date(INICIO.getTime() + 30 * 60_000));
    expect(titulo(html)).toBe("Tu monitoría ya empezó");
    expect(texto(html)).toContain("Lugar Edificio Santo Domingo, salón 301");
    expect(texto(html)).not.toContain("cancelarla");
  });

  it("al empezar (borde inclusivo) ya está en curso", () => {
    expect(titulo(pintar(PRESENCIAL, INICIO))).toBe("Tu monitoría ya empezó");
  });

  it("terminada dice que el monitor la marcará como realizada y no muestra lugar ni enlace (D-21)", () => {
    for (const cita of [PRESENCIAL, VIRTUAL]) {
      const html = pintar(cita, new Date(cita.finProgramado.getTime() + 1));
      expect(titulo(html)).toBe("Tu monitoría ya terminó");
      expect(texto(html)).toContain("El monitor la marcará como realizada.");
      expect(texto(html)).not.toContain("Lugar");
      expect(texto(html)).not.toContain("Enlace de la videollamada");
      expect(html).not.toContain("meet.example");
      expect(html).not.toContain("<a href=\"https");
    }
  });
});

describe("DetalleDeCita (HU-029): el reporte de que el monitor no llegó", () => {
  const EN_CURSO = new Date(INICIO.getTime() + 30 * 60_000);
  const VENCIDA = new Date(PRESENCIAL.reporteHasta.getTime() + 1);

  it("sin reporte y dentro de la ventana avisa hasta cuándo se puede reportar, en hora de Bogotá, y el botón va en el hueco de las acciones", () => {
    const html = pintar(PRESENCIAL, EN_CURSO, { acciones: "El monitor no llegó" });
    const t = texto(html);
    expect(t).toContain(
      "¿El monitor no llegó? Puedes reportarlo hasta el jueves, 8 de octubre de 2026, 11:00 a. m. Un admin revisa el caso. Si lo acepta, la monitoría se cancela y te devolvemos el dinero de tu pago.",
    );
    expect(t).not.toContain("..");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>El monitor no llegó<\/button>/);
    // El aviso va antes del hueco de las acciones.
    expect(html.indexOf("Puedes reportarlo")).toBeLessThan(html.indexOf("<button"));
  });

  it("sin reporte y sin ventana (todavía no empieza, o ya pasó) no sale nada del reporte", () => {
    for (const ahora of [AHORA, VENCIDA]) {
      const html = pintar(PRESENCIAL, ahora);
      expect(texto(html)).not.toMatch(/reportar|reporte|Observaciones/);
      expect(html).not.toContain("<button");
    }
  });

  it("el texto del plazo de cancelar no cambia por el reporte", () => {
    expect(texto(pintar(PRESENCIAL, AHORA))).toContain("Puedes cancelarla hasta el martes, 6 de octubre de 2026, 10:00 p. m. Quedan 1 d 12 h.");
  });

  it("en revisión dice que se recibió y que aquí verá la decisión, y ya no ofrece reportar", () => {
    const t = texto(pintar({ ...PRESENCIAL, estadoReporte: "en_revision" }, EN_CURSO));
    expect(t).toContain("Recibimos tu reporte. Un admin lo está revisando y aquí verás su decisión.");
    expect(t).not.toContain("Puedes reportarlo");
  });

  it("terminada con un reporte hecho no dice que el monitor la marcará como realizada", () => {
    const ahora = new Date(PRESENCIAL.finProgramado.getTime() + 1);
    expect(texto(pintar(PRESENCIAL, ahora))).toContain("El monitor la marcará como realizada.");
    const conReporte = texto(pintar({ ...PRESENCIAL, estadoReporte: "en_revision" }, ahora));
    expect(conReporte).not.toContain("El monitor la marcará como realizada.");
    expect(conReporte).toContain("Recibimos tu reporte.");
  });

  it("aceptado dice que un admin lo aceptó; si la cita ya se canceló por eso, el motivo lo dice y no se repite", () => {
    expect(texto(pintar({ ...PRESENCIAL, estado: "realizada", estadoReporte: "aceptado" }, EN_CURSO))).toContain("Un admin aceptó tu reporte.");
    const cancelada = texto(
      pintar({ ...PRESENCIAL, estado: "cancelada", motivoCancelacion: "monitor_no_asistio", estadoReporte: "aceptado", estadoReembolso: "esperando_llave" }, EN_CURSO),
    );
    expect(cancelada).toContain("El monitor no asistió y se aceptó tu reporte.");
    expect(cancelada).not.toContain("Un admin aceptó tu reporte.");
    expect(cancelada).toContain("Vamos a devolverte el dinero.");
  });

  it("rechazado dice que la monitoría sigue como estaba y muestra las observaciones del admin", () => {
    const html = pintar({ ...PRESENCIAL, estadoReporte: "rechazado", observacionesReporte: "El monitor sí estuvo en el salón." }, EN_CURSO);
    const t = texto(html);
    expect(t).toContain("Un admin revisó tu reporte y no lo aceptó: la monitoría sigue como estaba.");
    expect(t).toContain("Observaciones del admin El monitor sí estuvo en el salón.");
    expect(html).toMatch(/<p[^>]*>Observaciones del admin<\/p>/);
  });

  it("las observaciones se pintan como texto: el HTML que traigan se escapa y no se interpreta", () => {
    const html = pintar(
      { ...PRESENCIAL, estadoReporte: "rechazado", observacionesReporte: '<script>alert(1)</script> <img src=x onerror="y">' },
      EN_CURSO,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("rechazado sin observaciones (nulas o en blanco) no pone el bloque; sin rechazar, tampoco", () => {
    for (const observacionesReporte of [null, "", "   "]) {
      const t = texto(pintar({ ...PRESENCIAL, estadoReporte: "rechazado", observacionesReporte }, EN_CURSO));
      expect(t, String(observacionesReporte)).not.toContain("Observaciones del admin");
    }
    for (const estadoReporte of ["en_revision", "aceptado", null] as const) {
      const t = texto(pintar({ ...PRESENCIAL, estadoReporte, observacionesReporte: "Un texto" }, EN_CURSO));
      expect(t, String(estadoReporte)).not.toContain("Observaciones del admin");
    }
  });

  it("no habla de comisión ni del contacto del monitor", () => {
    for (const estadoReporte of [null, "en_revision", "aceptado", "rechazado"] as const) {
      const t = texto(pintar({ ...PRESENCIAL, estadoReporte, observacionesReporte: "Texto" }, EN_CURSO));
      expect(t, String(estadoReporte)).not.toMatch(/comisi|neto|tel[eé]fono|whatsapp|@/i);
    }
  });
});

describe("DetalleDeCita (HU-019): realizada", () => {
  const html = pintar({ ...PRESENCIAL, estado: "realizada" }, new Date(INICIO.getTime() + 2 * HORA));

  it("dice que se realizó, sin lugar ni enlace", () => {
    expect(titulo(html)).toBe("Tu monitoría se realizó");
    expect(texto(html)).toContain("Cálculo Diferencial");
    expect(texto(html)).not.toContain("Lugar");
    expect(html).not.toContain("Santo Domingo, salón 301");
  });

  it("lleva a los monitores de la materia", () => {
    expect(html).toMatch(/<a[^>]*href="\/monitores\?materia=MATE-1203"[^>]*>Ver monitores de Cálculo Diferencial<\/a>/);
  });
});

describe("DetalleDeCita (HU-019): cancelada", () => {
  const cancelada = (cambios: Partial<Cita>) => pintar({ ...PRESENCIAL, estado: "cancelada", ...cambios });

  it("dice el motivo en palabras, sin lugar ni enlace, y lleva a los monitores", () => {
    const html = cancelada({ motivoCancelacion: "pago_rechazado", estadoPago: "rechazado" });
    expect(titulo(html)).toBe("Esta monitoría se canceló");
    expect(texto(html)).toContain("No pudimos verificar tu pago, así que la monitoría se canceló y no hay reembolso.");
    expect(texto(html)).not.toContain("Lugar");
    expect(html).not.toContain("Santo Domingo, salón 301");
    expect(html).toContain('href="/monitores?materia=MATE-1203"');
  });

  it.each([
    ["estudiante", "La cancelaste tú."],
    ["monitor_no_asistio", "El monitor no asistió y se aceptó tu reporte."],
    ["diferencia_no_cubierta", "No se cubrió a tiempo la diferencia del pago."],
  ] as const)("el motivo %s", (motivo, frase) => {
    expect(texto(cancelada({ motivoCancelacion: motivo }))).toContain(frase);
  });

  it.each([
    ["esperando_llave", "Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave."],
    ["pendiente", "Recibimos tu llave. Estamos haciendo la devolución del dinero."],
    ["reembolsado", "Ya te devolvimos el dinero."],
  ] as const)("el reembolso %s", (estadoReembolso, frase) => {
    expect(texto(cancelada({ motivoCancelacion: "estudiante", estadoReembolso }))).toContain(frase);
  });

  it("sin reembolso no dice nada de devolver dinero", () => {
    expect(texto(cancelada({ motivoCancelacion: "pago_rechazado" }))).not.toContain("devol");
  });

  it("la cancelaste con el pago todavía en revisión (P-07): dice que si se aprueba te piden la llave y si no, no hay reembolso", () => {
    const t = texto(cancelada({ motivoCancelacion: "estudiante", estadoPago: "en_revision", estadoReembolso: null }));
    expect(t).toContain("La cancelaste tú.");
    expect(t).toContain("Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.");
  });

  it("la cancelaste con el pago rechazado: no hay reembolso", () => {
    const t = texto(cancelada({ motivoCancelacion: "estudiante", estadoPago: "rechazado", estadoReembolso: null }));
    expect(t).toContain("Tu pago no se aprobó, así que no hay reembolso.");
    expect(t).not.toContain("Vamos a devolverte");
  });

  it("la cancelaste con el reembolso ya creado: solo dice del reembolso, no del pago en revisión", () => {
    const t = texto(cancelada({ motivoCancelacion: "estudiante", estadoPago: "aprobado", estadoReembolso: "esperando_llave" }));
    expect(t).toContain("Vamos a devolverte el dinero.");
    expect(t).not.toContain("todavía está en revisión");
    expect(t).not.toContain("no se aprobó");
  });
});

describe("DetalleDeCita (HU-019, D-21): el pago rechazado", () => {
  it("mientras la cita siga confirmada deja de mostrar el lugar", () => {
    const html = pintar({ ...PRESENCIAL, estadoPago: "rechazado" });
    expect(texto(html)).toContain("No pudimos verificar tu pago.");
    expect(texto(html)).not.toContain("Lugar");
    expect(html).not.toContain("Santo Domingo, salón 301");
  });
});

describe("DetalleDeCita (HU-019): reserva sin pagar", () => {
  it("de respaldo lleva a la reserva, que es donde se paga", () => {
    const html = pintar({ ...PRESENCIAL, estado: "pendiente_pago" });
    expect(titulo(html)).toBe("Tu reserva espera el comprobante de pago");
    expect(html).toMatch(/<a[^>]*href="\/agendar\/reserva\/5a5a5a5a-0000-4000-8000-000000000019"[^>]*>Ir a mi reserva<\/a>/);
  });
});

describe("EnlaceQueNoSirve (HU-019, criterio 3)", () => {
  const html = renderToStaticMarkup(createElement(EnlaceQueNoSirve));

  it("no dice nada de ninguna cita: solo que el enlace no sirve y cómo seguir", () => {
    expect(titulo(html)).toBe("Este enlace no sirve");
    expect(texto(html)).toContain("Está incompleto o no lo reconocemos. Abre de nuevo el enlace del correo que te mandamos.");
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Ir al inicio<\/a>/);
    for (const ausente of ["Cálculo", "Laura", "Lugar", "$ "]) expect(texto(html)).not.toContain(ausente);
  });
});

describe("NoPudimosCargar", () => {
  it("avisa sin dar detalles y con role=alert", () => {
    const html = renderToStaticMarkup(createElement(NoPudimosCargar, { titulo: "No pudimos cargar tu cita" }));
    expect(titulo(html)).toBe("No pudimos cargar tu cita");
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain("Recarga la página; si sigue igual, inténtalo más tarde.");
  });
});
