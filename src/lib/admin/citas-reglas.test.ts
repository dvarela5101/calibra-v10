import { describe, expect, it } from "vitest";
import { formatearPesos } from "@/lib/moneda";
import * as reglas from "./citas-reglas";
import {
  aDevolver,
  avisosDeLaPagina,
  CAMBIOS_DE_LA_CITA,
  CATEGORIAS,
  consecuenciasDeAutorizar,
  contactoDe,
  esCategoria,
  esResultadoDeAutorizacion,
  estadoDePagoDeLaCita,
  LARGO_MAXIMO_NOTA,
  leerAutorizacion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_AUTORIZACION,
  MENSAJES_DEL_FORMULARIO,
  RESULTADOS_DE_AUTORIZACION,
  TEXTOS_DE_CATEGORIA,
  TEXTOS_DEL_REGISTRO,
  textoDePagosEnRevision,
  vistaDeLaCita,
  type AutorizacionRegistrada,
  type PagoDeLaCita,
} from "./citas-reglas";

// HU-052 sin base: lo puro de autorizar una cancelación fuera de plazo. Aquí se fija el orden de los resultados de la
// base, qué se le dice al admin con cada uno, cómo se lee el formulario (la nota se cuenta por caracteres y los saltos de
// línea del navegador cuentan uno), qué muestra la página según el estado y el instante (los dos bordes, que decide el
// motor y no un `<`), lo que se lee antes de confirmar y los avisos de la página. Que la base responda lo mismo lo cubre
// integracion/cancelar-fuera-de-plazo.test.ts y el pgTAP de la migración.

const ID = "52525252-0000-4000-8000-000000000052";
const YO = "a0a0a0a0-0000-4000-8000-000000000052";
const OTRO = "a0a0a0a0-0000-4000-8000-000000005201";

// 10:00 a. m. en Bogotá del lunes 7 de enero de 2030; el plazo de 12 h terminó a las 10:00 p. m. del domingo 6.
const INICIO = new Date("2030-01-07T15:00:00.000Z");
const CANCELABLE_HASTA = new Date("2030-01-07T03:00:00.000Z");
const DESPUES_DEL_PLAZO = new Date("2030-01-07T09:00:00.000Z");

const AUTORIZACION: AutorizacionRegistrada = {
  categoria: "fuerza_mayor",
  nota: "Accidente de tránsito.",
  autorizadaEn: new Date("2030-01-07T09:05:00.000Z"),
  idAdmin: YO,
  nombreAdmin: "Admin Uno",
};

const cita = (cambios: Partial<Parameters<typeof vistaDeLaCita>[0]> = {}) => ({
  estado: "confirmada" as const,
  motivoCancelacion: null,
  grupal: false,
  inicio: INICIO,
  cancelableHasta: CANCELABLE_HASTA,
  autorizacion: null,
  ...cambios,
});

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const PAGO: PagoDeLaCita = { nombrePagador: "Camila Rojas", monto: 32_000, estado: "aprobado" };

describe("los resultados de la base (HU-052)", () => {
  it("son los de la puerta, en el orden en que la base los mira: quién puede, antes que el texto", () => {
    expect([...RESULTADOS_DE_AUTORIZACION]).toEqual([
      "autorizada",
      "sin_sesion",
      "sin_permiso",
      "categoria_invalida",
      "nota_invalida",
      "no_existe",
      "no_individual",
      "ya_cancelada",
      "no_cancelable",
      "dentro_de_plazo",
      "ya_empezo",
    ]);
  });

  it("cada uno se reconoce, y lo que no está en la lista no", () => {
    for (const resultado of RESULTADOS_DE_AUTORIZACION) expect(esResultadoDeAutorizacion(resultado), resultado).toBe(true);
    for (const otro of ["fuera_de_plazo", "cancelada", "AUTORIZADA", "", null, undefined, 3, ["autorizada"]]) {
      expect(esResultadoDeAutorizacion(otro), JSON.stringify(otro)).toBe(false);
    }
  });

  it("todos tienen un mensaje para el admin menos el éxito, que lo dice la página", () => {
    const sinExito = RESULTADOS_DE_AUTORIZACION.filter((resultado) => resultado !== "autorizada");
    expect(Object.keys(MENSAJES_DE_AUTORIZACION).sort()).toEqual([...sinExito].sort());
    for (const resultado of sinExito) expect(MENSAJES_DE_AUTORIZACION[resultado].length, resultado).toBeGreaterThan(10);
  });

  it("los textos exactos que fija la HU", () => {
    expect(MENSAJES_DE_AUTORIZACION).toEqual({
      dentro_de_plazo: "Todavía hay plazo para cancelar: quien agendó la puede cancelar desde su cita, con reembolso. No hace falta autorizar nada.",
      ya_empezo:
        "La sesión ya empezó, así que no se puede cancelar con esta autorización. Si el monitor no llegó, quien agendó puede reportar la inasistencia desde su cita.",
      no_cancelable: "Esta monitoría no está confirmada (está por pagar, realizada o cancelada por otro motivo), así que no se puede cancelar aquí.",
      ya_cancelada: "Esta monitoría ya estaba cancelada (la canceló quien agendó o la autorizó otro admin). No se cambió nada.",
      no_individual: "Las monitorías grupales no se cancelan fuera de plazo desde aquí.",
      no_existe: "No encontramos esta monitoría.",
      categoria_invalida: "Escoge el motivo de la lista.",
      nota_invalida: "La nota puede tener hasta 500 caracteres y, con “Otro”, es obligatoria.",
      sin_permiso: "Solo un admin activo autoriza cancelaciones.",
      sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
    });
    expect(MENSAJES_DEL_FORMULARIO).toEqual({
      nota_larga: "La nota puede tener hasta 500 caracteres.",
      nota_obligatoria: "Con “Otro” la nota es obligatoria: cuenta qué pasó.",
    });
    expect(MENSAJE_DE_FALLO).toBe("No pudimos autorizar la cancelación. Intenta de nuevo; si sigue igual, avisa al equipo.");
    expect(LARGO_MAXIMO_NOTA).toBe(500);
  });

  it("los resultados con los que la cita cambió mientras el admin miraba llevan a la página y no al formulario", () => {
    expect([...CAMBIOS_DE_LA_CITA].sort()).toEqual(["dentro_de_plazo", "no_cancelable", "no_individual", "ya_cancelada", "ya_empezo"]);
    for (const resultado of CAMBIOS_DE_LA_CITA) expect(esResultadoDeAutorizacion(resultado)).toBe(true);
  });
});

describe("los motivos (D-60 a)", () => {
  it("son tres, en este orden, con los textos de la HU", () => {
    expect([...CATEGORIAS]).toEqual(["fuerza_mayor", "falla_de_calibra", "otro"]);
    expect(TEXTOS_DE_CATEGORIA).toEqual({
      fuerza_mayor: "Fuerza mayor de quien agendó (urgencia de salud, accidente o calamidad familiar)",
      falla_de_calibra: "Una falla de Calibra impidió cancelar a tiempo",
      otro: "Otro (la nota es obligatoria)",
    });
    expect(TEXTOS_DEL_REGISTRO).toEqual({
      fuerza_mayor: "Fuerza mayor de quien agendó",
      falla_de_calibra: "Una falla de Calibra impidió cancelar a tiempo",
      otro: "Otro",
    });
  });

  it("solo esos tres se reconocen", () => {
    for (const categoria of CATEGORIAS) expect(esCategoria(categoria)).toBe(true);
    for (const otro of ["", "x", "FUERZA_MAYOR", " otro", "otro ", null, undefined, 1]) expect(esCategoria(otro), JSON.stringify(otro)).toBe(false);
  });
});

describe("leerAutorizacion", () => {
  const BASE = { id_monitoria: ID, categoria: "fuerza_mayor" };

  it("lee la cita, el motivo y la nota recortada", () => {
    expect(leerAutorizacion(formulario({ ...BASE, nota: "  Accidente de tránsito.  \n" }))).toEqual({
      ok: true,
      datos: { idMonitoria: ID, categoria: "fuerza_mayor", nota: "Accidente de tránsito." },
    });
  });

  it("sin nota, o con una de puros espacios y saltos de línea, la nota es ninguna", () => {
    for (const nota of [undefined, "", "   ", " \n\t \r\n "]) {
      const campos = nota === undefined ? BASE : { ...BASE, nota };
      expect(leerAutorizacion(formulario(campos)), JSON.stringify(nota)).toEqual({
        ok: true,
        datos: { idMonitoria: ID, categoria: "fuerza_mayor", nota: null },
      });
    }
  });

  it("el id va en minúscula y con los espacios quitados; si no es un UUID, la cita no existe", () => {
    expect(leerAutorizacion(formulario({ ...BASE, id_monitoria: ` ${ID.toUpperCase()} ` }))).toMatchObject({ ok: true, datos: { idMonitoria: ID } });
    for (const malo of ["", "otro", "1234", `${ID}0`]) {
      expect(leerAutorizacion(formulario({ ...BASE, id_monitoria: malo })), malo).toEqual({ ok: false, error: MENSAJES_DE_AUTORIZACION.no_existe });
    }
    expect(leerAutorizacion(formulario({ categoria: "fuerza_mayor" }))).toEqual({ ok: false, error: MENSAJES_DE_AUTORIZACION.no_existe });
  });

  it("el motivo tiene que ser de la lista, y se mira antes que la nota", () => {
    for (const categoria of ["", "x", "FUERZA_MAYOR", "Otro"]) {
      expect(leerAutorizacion(formulario({ ...BASE, categoria })), categoria).toEqual({ ok: false, error: MENSAJES_DE_AUTORIZACION.categoria_invalida });
    }
    expect(leerAutorizacion(formulario({ id_monitoria: ID }))).toEqual({ ok: false, error: MENSAJES_DE_AUTORIZACION.categoria_invalida });
    // Una categoría inválida con una nota de 501 caracteres recibe lo de la categoría, como en la base.
    expect(leerAutorizacion(formulario({ ...BASE, categoria: "x", nota: "a".repeat(501) }))).toEqual({
      ok: false,
      error: MENSAJES_DE_AUTORIZACION.categoria_invalida,
    });
  });

  it("con «Otro» la nota es obligatoria; con los otros dos motivos no", () => {
    expect(leerAutorizacion(formulario({ ...BASE, categoria: "otro" }))).toEqual({ ok: false, error: MENSAJES_DEL_FORMULARIO.nota_obligatoria });
    // Puros espacios y saltos de línea no son una nota.
    expect(leerAutorizacion(formulario({ ...BASE, categoria: "otro", nota: " \n \r\n\t " }))).toEqual({
      ok: false,
      error: MENSAJES_DEL_FORMULARIO.nota_obligatoria,
    });
    expect(leerAutorizacion(formulario({ ...BASE, categoria: "otro", nota: "Un error nuestro." }))).toMatchObject({ ok: true, datos: { categoria: "otro" } });
    expect(leerAutorizacion(formulario({ ...BASE, categoria: "falla_de_calibra" }))).toMatchObject({ ok: true, datos: { categoria: "falla_de_calibra", nota: null } });
  });

  it("la nota puede tener 500 caracteres y no 501", () => {
    expect(leerAutorizacion(formulario({ ...BASE, nota: "a".repeat(500) }))).toMatchObject({ ok: true });
    expect(leerAutorizacion(formulario({ ...BASE, nota: "a".repeat(501) }))).toEqual({ ok: false, error: MENSAJES_DEL_FORMULARIO.nota_larga });
  });

  it("la nota se cuenta por caracteres, como char_length en la base, no por unidades de JavaScript", () => {
    // U+1D11E ocupa dos unidades de JavaScript y es un solo carácter.
    expect("\u{1D11E}".length).toBe(2);
    expect(leerAutorizacion(formulario({ ...BASE, nota: "\u{1D11E}".repeat(500) }))).toMatchObject({ ok: true });
    expect(leerAutorizacion(formulario({ ...BASE, nota: "\u{1D11E}".repeat(501) }))).toEqual({ ok: false, error: MENSAJES_DEL_FORMULARIO.nota_larga });
  });

  it("los saltos de línea del navegador (CRLF) cuentan uno y la nota llega con LF", () => {
    // 489 letras y 11 saltos: el campo las acepta (maxlength cuenta cada salto como uno) y el formulario envía 511 caracteres.
    const lineas = Array.from({ length: 12 }, (_, i) => "a".repeat(i < 9 ? 41 : 40));
    const lectura = leerAutorizacion(formulario({ ...BASE, nota: lineas.join("\r\n") }));
    expect(lectura).toEqual({ ok: true, datos: { idMonitoria: ID, categoria: "fuerza_mayor", nota: lineas.join("\n") } });
    expect(lectura.ok && lectura.datos.nota?.includes("\r")).toBe(false);
    // Con un carácter más (501 ya normalizados) no pasa.
    expect(leerAutorizacion(formulario({ ...BASE, nota: `${lineas.join("\r\n")}a` }))).toEqual({ ok: false, error: MENSAJES_DEL_FORMULARIO.nota_larga });
    // Un CR suelto también es un salto de línea.
    expect(leerAutorizacion(formulario({ ...BASE, nota: "a\rb" }))).toMatchObject({ ok: true, datos: { nota: "a\nb" } });
  });

  it("un campo que no es texto (un archivo) cuenta como vacío", () => {
    const datos = formulario(BASE);
    datos.set("nota", new File(["x"], "nota.txt"));
    expect(leerAutorizacion(datos)).toMatchObject({ ok: true, datos: { nota: null } });
  });
});

describe("estadoDePagoDeLaCita y aDevolver", () => {
  it("el estado agregado sigue la prioridad de la agenda del monitor (D-11)", () => {
    expect(estadoDePagoDeLaCita([])).toBe("sin_pagar");
    expect(estadoDePagoDeLaCita([{ estado: "aprobado" }])).toBe("aprobado");
    expect(estadoDePagoDeLaCita([{ estado: "aprobado" }, { estado: "en_revision" }])).toBe("en_revision");
    expect(estadoDePagoDeLaCita([{ estado: "aprobado" }, { estado: "en_revision" }, { estado: "rechazado" }])).toBe("rechazado");
    expect(estadoDePagoDeLaCita([{ estado: "en_revision" }, { estado: "rechazado" }])).toBe("rechazado");
  });

  it("lo que se devolvería es la suma de los pagos aprobados: ni los rechazados ni los que siguen en revisión", () => {
    expect(aDevolver([])).toEqual({ cuantos: 0, suma: 0 });
    expect(
      aDevolver([
        { monto: 32_000, estado: "aprobado" },
        { monto: 15_000, estado: "aprobado" },
        { monto: 9_000, estado: "en_revision" },
        { monto: 8_000, estado: "rechazado" },
      ]),
    ).toEqual({ cuantos: 2, suma: 47_000 });
  });
});

describe("contactoDe", () => {
  it("el contacto es el que haya: el correo y el teléfono, solo uno o ninguno", () => {
    expect(contactoDe({ correo: "a@b.co", telefono: "3001234567" })).toBe("a@b.co · 3001234567");
    expect(contactoDe({ correo: "a@b.co", telefono: null })).toBe("a@b.co");
    expect(contactoDe({ correo: null, telefono: "3001234567" })).toBe("3001234567");
    expect(contactoDe({ correo: null, telefono: null })).toBe("Sin datos de contacto");
    expect(contactoDe({ correo: "", telefono: "" })).toBe("Sin datos de contacto");
  });
});

describe("vistaDeLaCita: qué muestra la página según el estado y el instante", () => {
  it("una individual confirmada con el plazo vencido y sin empezar se autoriza", () => {
    expect(vistaDeLaCita(cita(), DESPUES_DEL_PLAZO)).toBe("autorizar");
  });

  it("una cita con la autorización registrada se muestra autorizada, aunque ya esté cancelada", () => {
    expect(vistaDeLaCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante", autorizacion: AUTORIZACION }), DESPUES_DEL_PLAZO)).toBe("autorizada");
  });

  it("el borde del plazo (P-40): con las 12 h exactas todavía hay plazo; un milisegundo después, no", () => {
    const ms = (delta: number) => new Date(CANCELABLE_HASTA.getTime() + delta);
    expect(vistaDeLaCita(cita(), ms(-1))).toEqual({ motivo: "dentro_de_plazo" });
    // Lo que distingue un `<` de un `<=`: el instante exacto sigue dentro del plazo.
    expect(vistaDeLaCita(cita(), ms(0))).toEqual({ motivo: "dentro_de_plazo" });
    expect(vistaDeLaCita(cita(), ms(1))).toBe("autorizar");
  });

  it("el borde del inicio (RN-64): hasta un milisegundo antes se autoriza; en el instante exacto ya empezó", () => {
    const ms = (delta: number) => new Date(INICIO.getTime() + delta);
    expect(vistaDeLaCita(cita(), ms(-1))).toBe("autorizar");
    // Lo que distingue un `>` de un `>=`: desde el instante exacto ya no se autoriza.
    expect(vistaDeLaCita(cita(), ms(0))).toEqual({ motivo: "ya_empezo" });
    expect(vistaDeLaCita(cita(), ms(1))).toEqual({ motivo: "ya_empezo" });
    expect(vistaDeLaCita(cita(), new Date(INICIO.getTime() + 86_400_000))).toEqual({ motivo: "ya_empezo" });
  });

  it("una grupal no se cancela aquí, aunque el plazo haya vencido", () => {
    expect(vistaDeLaCita(cita({ grupal: true }), DESPUES_DEL_PLAZO)).toEqual({ motivo: "no_individual" });
  });

  it("una cancelada por quien agendó ya está cancelada; cancelada por otro motivo, realizada o por pagar no es cancelable", () => {
    expect(vistaDeLaCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), DESPUES_DEL_PLAZO)).toEqual({ motivo: "ya_cancelada" });
    for (const motivoCancelacion of ["monitor_no_asistio", "pago_rechazado", "reserva_expirada", "diferencia_no_cubierta"] as const) {
      expect(vistaDeLaCita(cita({ estado: "cancelada", motivoCancelacion }), DESPUES_DEL_PLAZO), motivoCancelacion).toEqual({ motivo: "no_cancelable" });
    }
    expect(vistaDeLaCita(cita({ estado: "realizada" }), DESPUES_DEL_PLAZO)).toEqual({ motivo: "no_cancelable" });
    expect(vistaDeLaCita(cita({ estado: "pendiente_pago" }), DESPUES_DEL_PLAZO)).toEqual({ motivo: "no_cancelable" });
  });

  it("el orden es el del núcleo de la base: grupal, ya cancelada, no cancelable, dentro del plazo, ya empezó", () => {
    // Una grupal cancelada por el estudiante: gana no_individual.
    expect(vistaDeLaCita(cita({ grupal: true, estado: "cancelada", motivoCancelacion: "estudiante" }), DESPUES_DEL_PLAZO)).toEqual({ motivo: "no_individual" });
    // Una realizada dentro del plazo: gana no_cancelable.
    expect(vistaDeLaCita(cita({ estado: "realizada" }), new Date(CANCELABLE_HASTA.getTime() - 1))).toEqual({ motivo: "no_cancelable" });
    // Una cancelada por el estudiante después del inicio: gana ya_cancelada.
    expect(vistaDeLaCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), new Date(INICIO.getTime() + 1))).toEqual({ motivo: "ya_cancelada" });
  });

  it("no decide con una fecha inválida: el motor lanza y el cargador valida cada instante antes", () => {
    expect(() => vistaDeLaCita(cita({ inicio: new Date("no es una fecha") }), DESPUES_DEL_PLAZO)).toThrow(RangeError);
    expect(() => vistaDeLaCita(cita({ cancelableHasta: new Date("no es una fecha") }), DESPUES_DEL_PLAZO)).toThrow(RangeError);
  });
});

describe("textoDePagosEnRevision (P-07)", () => {
  it("nada si ninguno está en revisión; uno o varios, con su singular y su plural exactos", () => {
    expect(textoDePagosEnRevision(0)).toBeNull();
    expect(textoDePagosEnRevision(1)).toBe("Un pago sigue en revisión: si se aprueba, recibe su reembolso; si se rechaza, no hay reembolso.");
    expect(textoDePagosEnRevision(2)).toBe("2 pagos siguen en revisión: cada uno recibe su reembolso si se aprueba; si se rechaza, no hay reembolso.");
    expect(textoDePagosEnRevision(3)).toContain("3 pagos siguen");
  });
});

describe("consecuenciasDeAutorizar: lo que se lee antes de confirmar", () => {
  const MONITORIA = { nombreMateria: "Cálculo Diferencial", fecha: "2030-01-07", hora: "10:00:00" };
  const SIEMPRE = "Quien agendó y el monitor reciben un correo. Ninguno dice el motivo ni la nota. El monitor no cobra esta sesión.";

  it("con un solo pago aprobado: se cancela, se devuelve ese monto, y los correos y el monitor", () => {
    expect(consecuenciasDeAutorizar({ ...MONITORIA, pagos: [PAGO] })).toBe(
      `La monitoría de Cálculo Diferencial del 7 de enero de 2030 a las 10:00 se cancela. Esto no se puede deshacer. Se devuelven ${formatearPesos(32_000)} a quien pagó y se le pide la llave por correo. ${SIEMPRE}`,
    );
  });

  it("con varios aprobados: cuántos reembolsos y la suma de lo que pagaron", () => {
    const t = consecuenciasDeAutorizar({ ...MONITORIA, pagos: [PAGO, { ...PAGO, nombrePagador: "Luis Pérez", monto: 15_000 }] });
    expect(t).toContain(`Se crean 2 reembolsos por ${formatearPesos(47_000)} en total y se le pide la llave a cada pagador, por correo.`);
    expect(t).not.toContain("Se devuelven");
  });

  it("sin aprobados: no hay nada que devolver", () => {
    expect(consecuenciasDeAutorizar({ ...MONITORIA, pagos: [] })).toContain("No hay pagos aprobados que devolver.");
    expect(consecuenciasDeAutorizar({ ...MONITORIA, pagos: [{ ...PAGO, estado: "rechazado" }] })).toContain("No hay pagos aprobados que devolver.");
  });

  it("los pagos en revisión llevan el aviso de P-07, después del dinero y antes de los correos", () => {
    const t = consecuenciasDeAutorizar({ ...MONITORIA, pagos: [PAGO, { ...PAGO, monto: 15_000, estado: "en_revision" }] });
    const dinero = t.indexOf(`Se devuelven ${formatearPesos(32_000)}`);
    const revision = t.indexOf("Un pago sigue en revisión");
    const correos = t.indexOf("Quien agendó y el monitor reciben un correo");
    expect(dinero).toBeGreaterThan(-1);
    expect(revision).toBeGreaterThan(dinero);
    expect(correos).toBeGreaterThan(revision);
    // Solo aprobados cuentan para lo que se devuelve.
    expect(t).not.toContain(formatearPesos(15_000));
    expect(consecuenciasDeAutorizar({ ...MONITORIA, pagos: [{ ...PAGO, estado: "en_revision" }] })).toContain("No hay pagos aprobados que devolver. Un pago sigue en revisión");
    expect(consecuenciasDeAutorizar({ ...MONITORIA, pagos: [PAGO] })).not.toContain("en revisión");
  });

  it("siempre dice que no se deshace, que los correos no llevan el motivo ni la nota, y que el monitor no cobra", () => {
    for (const pagos of [[], [PAGO], [PAGO, PAGO]]) {
      const t = consecuenciasDeAutorizar({ ...MONITORIA, pagos });
      expect(t).toContain("Esto no se puede deshacer.");
      expect(t.endsWith(SIEMPRE)).toBe(true);
    }
  });
});

describe("avisosDeLaPagina", () => {
  const CITA = (cambios: Partial<Parameters<typeof avisosDeLaPagina>[1]> = {}) => ({
    autorizacion: { idAdmin: YO },
    pagos: [{ estado: "aprobado" as const, tieneReembolso: true }],
    ...cambios,
  });

  it("el éxito solo se dice con ?autorizada=1, la autorización registrada y de esta sesión", () => {
    expect(avisosDeLaPagina({ autorizada: "1" }, CITA(), YO)).toEqual([
      {
        exito: true,
        texto:
          "Autorizaste la cancelación. La monitoría quedó cancelada. Creamos 1 reembolso y le pedimos la llave a quien pagó. Quien agendó y el monitor reciben un correo.",
      },
    ]);
    // Un enlace viejo o escrito a mano.
    expect(avisosDeLaPagina({}, CITA(), YO)).toEqual([]);
    expect(avisosDeLaPagina({ autorizada: "0" }, CITA(), YO)).toEqual([]);
    expect(avisosDeLaPagina({ autorizada: ["1", "1"] }, CITA(), YO)).toEqual([]);
    // Sin registro de la autorización: el enlace dice algo que no pasó.
    expect(avisosDeLaPagina({ autorizada: "1" }, CITA({ autorizacion: null }), YO)).toEqual([]);
    // La autorizó otro admin: esta sesión no anuncia una autorización que no hizo.
    expect(avisosDeLaPagina({ autorizada: "1" }, CITA(), OTRO)).toEqual([]);
  });

  it("los reembolsos se cuentan con el singular o el plural exactos, y sin pagos aprobados no se dice ninguno", () => {
    const con = (n: number) => ({ pagos: Array.from({ length: n }, () => ({ estado: "aprobado" as const, tieneReembolso: true })) });
    expect(avisosDeLaPagina({ autorizada: "1" }, CITA(con(2)), YO)[0].texto).toContain(" Creamos 2 reembolsos y le pedimos la llave a cada pagador.");
    expect(avisosDeLaPagina({ autorizada: "1" }, CITA(con(1)), YO)[0].texto).toContain(" Creamos 1 reembolso y le pedimos la llave a quien pagó.");
    const sin = avisosDeLaPagina({ autorizada: "1" }, CITA({ pagos: [] }), YO)[0].texto;
    expect(sin).toBe("Autorizaste la cancelación. La monitoría quedó cancelada. Quien agendó y el monitor reciben un correo.");
    expect(sin).not.toContain("reembolso");
  });

  it("los pagos en revisión se dicen en singular o plural, y no cuentan como reembolsos", () => {
    const uno = avisosDeLaPagina({ autorizada: "1" }, CITA({ pagos: [{ estado: "en_revision", tieneReembolso: false }] }), YO)[0].texto;
    expect(uno).toBe(
      "Autorizaste la cancelación. La monitoría quedó cancelada. El pago en revisión recibirá su reembolso cuando se apruebe. Quien agendó y el monitor reciben un correo.",
    );
    const varios = avisosDeLaPagina(
      { autorizada: "1" },
      CITA({
        pagos: [
          { estado: "aprobado", tieneReembolso: true },
          { estado: "en_revision", tieneReembolso: false },
          { estado: "en_revision", tieneReembolso: false },
        ],
      }),
      YO,
    )[0].texto;
    expect(varios).toContain(" Creamos 1 reembolso y le pedimos la llave a quien pagó. Los 2 pagos en revisión recibirán el suyo cuando se aprueben. Quien agendó");
  });

  it("el correo se dice en futuro: la página no puede comprobar que ya salió", () => {
    const texto = avisosDeLaPagina({ autorizada: "1" }, CITA(), YO)[0].texto;
    expect(texto).toContain("reciben un correo");
    expect(texto).not.toMatch(/avisamos|enviamos|mandamos/i);
  });

  it("lo que cambió mientras el admin miraba se dice como alerta, solo si es uno de esos resultados", () => {
    for (const resultado of CAMBIOS_DE_LA_CITA) {
      expect(avisosDeLaPagina({ error: resultado }, CITA({ autorizacion: null }), YO), resultado).toEqual([
        { exito: false, texto: MENSAJES_DE_AUTORIZACION[resultado] },
      ]);
    }
    // Los demás resultados se dicen en el formulario y no llegan por la dirección.
    for (const otro of ["sin_permiso", "no_existe", "nota_invalida", "categoria_invalida", "autorizada", "x", ""]) {
      expect(avisosDeLaPagina({ error: otro }, CITA(), YO), otro).toEqual([]);
    }
    expect(avisosDeLaPagina({ error: ["ya_cancelada", "ya_empezo"] }, CITA(), YO)).toEqual([]);
  });
});

describe("sin cifras de comisión (CLAUDE.md, D-59)", () => {
  /** Todas las cadenas que exporta el módulo, a cualquier profundidad. */
  function cadenas(valor: unknown): string[] {
    if (typeof valor === "string") return [valor];
    if (Array.isArray(valor)) return valor.flatMap(cadenas);
    if (valor && typeof valor === "object") return Object.values(valor).flatMap(cadenas);
    return [];
  }

  it("ningún texto exportado habla de comisión, bruto ni neto", () => {
    const textos = cadenas(Object.values(reglas).filter((v) => typeof v !== "function"));
    expect(textos.length).toBeGreaterThan(20);
    for (const texto of textos) expect(texto).not.toMatch(/comisi|bruto|neto/i);
  });

  it("ni lo que arman las funciones con pagos de prueba", () => {
    const pagos: PagoDeLaCita[] = [PAGO, { ...PAGO, nombrePagador: "Luis Pérez", monto: 15_000, estado: "en_revision" }];
    const armados = [
      consecuenciasDeAutorizar({ nombreMateria: "Cálculo", fecha: "2030-01-07", hora: "10:00:00", pagos }),
      ...avisosDeLaPagina({ autorizada: "1" }, { autorizacion: { idAdmin: YO }, pagos: pagos.map((p) => ({ estado: p.estado, tieneReembolso: true })) }, YO).map((a) => a.texto),
      textoDePagosEnRevision(2) ?? "",
    ];
    for (const texto of armados) expect(texto).not.toMatch(/comisi|bruto|neto/i);
  });
});
