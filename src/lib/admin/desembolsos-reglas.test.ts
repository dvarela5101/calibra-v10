import { describe, expect, it } from "vitest";
import {
  avisosDeLaPagina,
  CAMBIOS_DEL_DESEMBOLSO,
  consecuenciasDeEjecutar,
  ERRORES_DE_FECHA,
  esMotivoParaNoEjecutar,
  esResultadoDeEjecucion,
  LARGO_MAXIMO_REFERENCIA,
  leerEjecucion,
  MENSAJE_DE_CAMBIO,
  MENSAJE_DE_FALLO,
  MENSAJE_SIN_MONTO,
  MENSAJES_DE_EJECUCION,
  MENSAJES_DE_MOTIVO,
  MOTIVOS_PARA_NO_EJECUTAR,
  RESULTADOS_DE_EJECUCION,
} from "./desembolsos-reglas";

const ID = "d0d0d0d0-0000-4000-8000-000000000028";
const YO = "a0a0a0a0-0000-4000-8000-000000000028";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002801";
const HOY = "2030-01-10";
const SESION = "2030-01-06";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const VALIDO = { id_desembolso: ID, referencia: "M12345678", fecha: HOY, fecha_sesion: SESION, neto_esperado: "22500" };

describe("resultados y motivos (HU-028)", () => {
  it.each(Object.entries({ ...MENSAJES_DE_MOTIVO, ...MENSAJES_DE_EJECUCION }))("%s tiene un mensaje para el admin", (_clave, mensaje) => {
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("todo motivo y todo resultado que no es desembolsado tiene mensaje", () => {
    expect(MOTIVOS_PARA_NO_EJECUTAR.filter((m) => !(m in MENSAJES_DE_MOTIVO))).toEqual([]);
    expect(RESULTADOS_DE_EJECUCION.filter((r) => r !== "desembolsado" && !(r in MENSAJES_DE_EJECUCION))).toEqual([]);
  });

  it("reconoce solo lo que responde la base", () => {
    for (const motivo of MOTIVOS_PARA_NO_EJECUTAR) expect(esMotivoParaNoEjecutar(motivo)).toBe(true);
    for (const resultado of RESULTADOS_DE_EJECUCION) expect(esResultadoDeEjecucion(resultado)).toBe(true);
    for (const otro of ["ejecutado", "", null, undefined, 3]) {
      expect(esMotivoParaNoEjecutar(otro)).toBe(false);
      expect(esResultadoDeEjecucion(otro)).toBe(false);
    }
  });

  it("al ejecutar, un motivo de la base se dice igual que en la página", () => {
    for (const motivo of ["anulado", "no_realizada", "antes_de_plazo", "con_reporte", "pagos_en_revision", "sin_pagos_aprobados", "no_encontrado"] as const) {
      expect(MENSAJES_DE_EJECUCION[motivo]).toBe(MENSAJES_DE_MOTIVO[motivo]);
    }
  });

  it("D-39: con un pago en revisión dice que espera esa revisión", () => {
    expect(MENSAJES_DE_MOTIVO.pagos_en_revision).toMatch(/^Espera la revisión de un pago de esta monitoría/);
  });

  it("supuesto 2: sin pagos aprobados dice que no hay nada que transferir", () => {
    expect(MENSAJES_DE_MOTIVO.sin_pagos_aprobados).toContain("no hay nada que transferir");
  });

  it("ningún texto habla de bruto ni de comisión (CLAUDE.md, P-32)", () => {
    const textos = [
      ...Object.values(MENSAJES_DE_MOTIVO),
      ...Object.values(MENSAJES_DE_EJECUCION),
      ...Object.values(ERRORES_DE_FECHA),
      MENSAJE_DE_FALLO,
      MENSAJE_DE_CAMBIO,
      MENSAJE_SIN_MONTO,
      consecuenciasDeEjecutar("$ 22.500", "3001234567"),
    ];
    for (const texto of textos) expect(texto.toLowerCase()).not.toMatch(/comisi|bruto/);
  });
});

describe("leerEjecucion (supuesto 3)", () => {
  it("lee el desembolso, la referencia recortada, la fecha y el neto esperado", () => {
    expect(leerEjecucion(formulario({ ...VALIDO, id_desembolso: ` ${ID.toUpperCase()} `, referencia: "  M12345678\n " }), HOY)).toEqual({
      ok: true,
      datos: { idDesembolso: ID, referencia: "M12345678", fecha: HOY, netoEsperado: 22_500 },
    });
  });

  it("la fecha puede ser hoy o el día de la sesión, que son los bordes", () => {
    expect(leerEjecucion(formulario({ ...VALIDO, fecha: HOY }), HOY).ok).toBe(true);
    expect(leerEjecucion(formulario({ ...VALIDO, fecha: SESION }), HOY).ok).toBe(true);
  });

  it("cuenta caracteres como la base, no unidades de JavaScript: 100 caracteres de dos unidades caben", () => {
    // U+1D11E (clave de sol) ocupa dos unidades de JavaScript y es un solo carácter para char_length.
    const cien = "\u{1D11E}".repeat(LARGO_MAXIMO_REFERENCIA);
    expect(cien.length).toBe(2 * LARGO_MAXIMO_REFERENCIA);
    expect(leerEjecucion(formulario({ ...VALIDO, referencia: cien }), HOY).ok).toBe(true);
    expect(leerEjecucion(formulario({ ...VALIDO, referencia: `${cien}a` }), HOY)).toEqual({ ok: false, error: MENSAJES_DE_EJECUCION.referencia_invalida });
  });

  it.each([
    ["sin desembolso", { ...VALIDO, id_desembolso: "" }, MENSAJES_DE_EJECUCION.no_encontrado],
    ["con un desembolso que no es un id", { ...VALIDO, id_desembolso: "1 or 1=1" }, MENSAJES_DE_EJECUCION.no_encontrado],
    ["sin referencia", { ...VALIDO, referencia: "" }, MENSAJES_DE_EJECUCION.referencia_invalida],
    ["con la referencia en blanco", { ...VALIDO, referencia: " \n\t " }, MENSAJES_DE_EJECUCION.referencia_invalida],
    ["con 101 caracteres de referencia", { ...VALIDO, referencia: "a".repeat(101) }, MENSAJES_DE_EJECUCION.referencia_invalida],
    ["sin fecha", { ...VALIDO, fecha: "" }, ERRORES_DE_FECHA.falta],
    ["con una fecha sin forma", { ...VALIDO, fecha: "10/01/2030" }, ERRORES_DE_FECHA.falta],
    ["con un día que no existe", { ...VALIDO, fecha: "2030-02-30" }, ERRORES_DE_FECHA.falta],
    ["con una fecha de mañana", { ...VALIDO, fecha: "2030-01-11" }, ERRORES_DE_FECHA.futura],
    ["con una fecha anterior a la sesión", { ...VALIDO, fecha: "2030-01-05" }, ERRORES_DE_FECHA.antesDeLaSesion],
    ["sin neto esperado", { ...VALIDO, neto_esperado: "" }, MENSAJE_SIN_MONTO],
    ["con un neto esperado que no es un entero", { ...VALIDO, neto_esperado: "22500.5" }, MENSAJE_SIN_MONTO],
    ["con un neto esperado negativo", { ...VALIDO, neto_esperado: "-1" }, MENSAJE_SIN_MONTO],
  ])("rechaza un formulario %s", (_caso, campos, error) => {
    expect(leerEjecucion(formulario(campos), HOY)).toEqual({ ok: false, error });
  });

  it("sin el día de la sesión no lo anticipa: lo decide la base", () => {
    const sinSesion = formulario({ ...VALIDO, fecha: "2020-01-01" });
    sinSesion.delete("fecha_sesion");
    expect(leerEjecucion(sinSesion, HOY).ok).toBe(true);
    expect(leerEjecucion(formulario({ ...VALIDO, fecha_sesion: "otra cosa", fecha: "2020-01-01" }), HOY).ok).toBe(true);
  });

  it("un archivo en vez de texto no cuenta como referencia", () => {
    const datos = formulario(VALIDO);
    datos.set("referencia", new Blob(["M12345678"]));
    expect(leerEjecucion(datos, HOY)).toEqual({ ok: false, error: MENSAJES_DE_EJECUCION.referencia_invalida });
  });
});

describe("consecuenciasDeEjecutar", () => {
  it("dice qué se registra, a qué llave y que no se deshace", () => {
    expect(consecuenciasDeEjecutar("$ 22.500", "3001234567")).toBe("Registra la transferencia de $ 22.500 a 3001234567. No se puede deshacer.");
  });
});

describe("avisosDeLaPagina", () => {
  const DESEMBOLSADO = { estado: "desembolsado" as const, idAdmin: YO };

  it("dice que se registró solo si el desembolso de verdad quedó desembolsado por el admin de la sesión", () => {
    const exito = { exito: true, texto: "Registraste la transferencia. El desembolso ya no aparece en la bandeja." };
    expect(avisosDeLaPagina({ ejecutado: "desembolsado" }, DESEMBOLSADO, YO)).toEqual([exito]);
    expect(avisosDeLaPagina({ ejecutado: "desembolsado" }, { estado: "pendiente", idAdmin: null }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ ejecutado: "desembolsado" }, { estado: "anulado", idAdmin: null }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ ejecutado: "desembolsado" }, { ...DESEMBOLSADO, idAdmin: OTRO }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ ejecutado: "otro" }, DESEMBOLSADO, YO)).toEqual([]);
    expect(avisosDeLaPagina({ ejecutado: ["desembolsado", "desembolsado"] }, DESEMBOLSADO, YO)).toEqual([]);
  });

  it("si ya estaba registrado, pide no transferirlo otra vez", () => {
    expect(avisosDeLaPagina({ error: "ya_desembolsado" }, { ...DESEMBOLSADO, idAdmin: OTRO }, YO)).toEqual([
      { exito: false, texto: MENSAJES_DE_EJECUCION.ya_desembolsado },
    ]);
    expect(MENSAJES_DE_EJECUCION.ya_desembolsado).toContain("No lo transfieras otra vez.");
  });

  it("lo demás que cambió mientras el admin miraba se dice una vez como alerta: el motivo ya lo dice la página", () => {
    for (const error of CAMBIOS_DEL_DESEMBOLSO.filter((e) => e !== "ya_desembolsado")) {
      expect(avisosDeLaPagina({ error }, { estado: "pendiente", idAdmin: null }, YO)).toEqual([{ exito: false, texto: MENSAJE_DE_CAMBIO }]);
    }
  });

  it("los errores desconocidos, los del formulario y los repetidos no se dicen", () => {
    for (const error of ["<script>", "monto_cambio", "referencia_invalida", "sin_permiso"]) {
      expect(avisosDeLaPagina({ error }, { estado: "pendiente", idAdmin: null }, YO)).toEqual([]);
    }
    expect(avisosDeLaPagina({ error: ["con_reporte", "anulado"] }, { estado: "pendiente", idAdmin: null }, YO)).toEqual([]);
  });
});
