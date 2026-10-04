import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avisosDeLaPagina,
  CAMBIOS_DEL_REEMBOLSO,
  consecuenciasDeRegistrar,
  ERRORES_DE_FECHA,
  esEstadoDeLaVista,
  esResultadoDeRegistro,
  ESTADOS_DE_LA_VISTA,
  LARGO_MAXIMO_REFERENCIA,
  leerRegistro,
  MENSAJE_DE_CAMBIO,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_REGISTRO,
  RESULTADOS_DE_REGISTRO,
} from "./reembolsos-reglas";

const ID = "70000000-0000-4000-8000-000000000026";
const YO = "a0a0a0a0-0000-4000-8000-000000000026";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002601";
const HOY = "2030-01-10";
/** El día en que se creó el reembolso. */
const CREADO = "2030-01-06";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const VALIDO = { id_reembolso: ID, referencia: "REF-26", fecha: HOY, fecha_minima: CREADO };

/**
 * Los resultados que lista el comentario de una función en su migración, en su orden. Las líneas son
 * `--   resultado   explicación`, con las explicaciones largas en líneas de continuación más indentadas.
 */
function resultadosDelComentario(sql: string, ...encabezados: string[]): string[] {
  const lineas = sql.split(/\r?\n/);
  let desde = 0;
  for (const encabezado of encabezados) {
    desde = lineas.findIndex((linea, i) => i >= desde && linea.includes(encabezado));
    if (desde < 0) throw new Error(`No está en la migración: ${encabezado}`);
  }
  const resultados: string[] = [];
  for (const linea of lineas.slice(desde + 1)) {
    const resultado = /^-- {3}([a-z_]+)\s/.exec(linea);
    if (resultado) resultados.push(resultado[1]);
    else if (!/^-- {6,}\S/.test(linea)) break;
  }
  return resultados;
}

describe("resultados (HU-026)", () => {
  it.each(Object.entries(MENSAJES_DE_REGISTRO))("%s tiene un mensaje para el admin", (_clave, mensaje) => {
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("todo resultado que no es reembolsado tiene mensaje", () => {
    expect(RESULTADOS_DE_REGISTRO.filter((r) => r !== "reembolsado" && !(r in MENSAJES_DE_REGISTRO))).toEqual([]);
  });

  it("reconoce solo lo que responde la base", () => {
    for (const resultado of RESULTADOS_DE_REGISTRO) expect(esResultadoDeRegistro(resultado)).toBe(true);
    for (const estado of ESTADOS_DE_LA_VISTA) expect(esEstadoDeLaVista(estado)).toBe(true);
    for (const otro of ["registrado", "desembolsado", "", null, undefined, 3]) {
      expect(esResultadoDeRegistro(otro)).toBe(false);
      expect(esEstadoDeLaVista(otro)).toBe(false);
    }
  });

  it("los resultados van en el orden en que los mira public.ejecutar_reembolso (su migración)", () => {
    const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261004055644_gestionar_reembolsos.sql"), "utf8");
    expect(resultadosDelComentario(sql, "Registrar la transferencia", "Resultado, en el orden en que se mira:")).toEqual([...RESULTADOS_DE_REGISTRO]);
  });

  it("lo que cambió mientras el admin miraba son resultados de la base, en su orden", () => {
    const posiciones = CAMBIOS_DEL_REEMBOLSO.map((c) => RESULTADOS_DE_REGISTRO.indexOf(c));
    expect(posiciones.every((p) => p > 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it("los textos son los acordados (SPEC de HU-026, 4.7)", () => {
    expect(MENSAJES_DE_REGISTRO).toEqual({
      ya_reembolsado: "Este reembolso ya estaba registrado, así que no se registró otra vez. No lo transfieras de nuevo.",
      sin_llave: "Quien pagó todavía no nos ha enviado su llave: no hay a dónde transferir.",
      no_asignado: "Este reembolso lo tiene asignado otro admin: solo esa persona registra la transferencia.",
      fecha_invalida: "La fecha de la transferencia no puede ser posterior a hoy ni anterior al día en que se creó el reembolso.",
      referencia_invalida: "Escribe la referencia de la transferencia, de hasta 100 caracteres.",
      no_encontrado: "No encontramos este reembolso.",
      sin_permiso: "Solo un admin activo registra reembolsos.",
      sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
    });
    expect(MENSAJE_DE_CAMBIO).toBe("No registramos la transferencia: el reembolso cambió mientras lo mirabas. Revisa cómo quedó antes de transferir.");
    expect(MENSAJE_DE_FALLO).toBe("No pudimos registrar la transferencia. Intenta de nuevo; si sigue igual, avisa al equipo.");
  });

  it("ningún texto habla de bruto ni de comisión (CLAUDE.md, RN-60: el reembolso es el pago completo)", () => {
    const textos = [
      ...Object.values(MENSAJES_DE_REGISTRO),
      ...Object.values(ERRORES_DE_FECHA),
      MENSAJE_DE_FALLO,
      MENSAJE_DE_CAMBIO,
      consecuenciasDeRegistrar("$ 25.000", "3001234567"),
      ...avisosDeLaPagina({ registrado: "reembolsado", error: "sin_llave" }, { estado: "reembolsado", idAdmin: YO }, YO).map((a) => a.texto),
    ];
    for (const texto of textos) expect(texto.toLowerCase()).not.toMatch(/comisi|bruto/);
  });
});

describe("leerRegistro (supuestos 2 y 3)", () => {
  it("lee el reembolso, la referencia recortada y la fecha", () => {
    expect(leerRegistro(formulario({ ...VALIDO, id_reembolso: ` ${ID.toUpperCase()} `, referencia: "  REF-26\n " }), HOY)).toEqual({
      ok: true,
      datos: { idReembolso: ID, referencia: "REF-26", fecha: HOY },
    });
  });

  it("la fecha puede ser hoy o el día en que se creó el reembolso, que son los bordes", () => {
    expect(leerRegistro(formulario({ ...VALIDO, fecha: HOY }), HOY).ok).toBe(true);
    expect(leerRegistro(formulario({ ...VALIDO, fecha: CREADO }), HOY).ok).toBe(true);
  });

  it("cuenta caracteres como la base, no unidades de JavaScript: 100 caracteres de dos unidades caben", () => {
    // U+1D11E (clave de sol) ocupa dos unidades de JavaScript y es un solo carácter para char_length.
    const cien = "\u{1D11E}".repeat(LARGO_MAXIMO_REFERENCIA);
    expect(cien.length).toBe(2 * LARGO_MAXIMO_REFERENCIA);
    expect(leerRegistro(formulario({ ...VALIDO, referencia: cien }), HOY).ok).toBe(true);
    expect(leerRegistro(formulario({ ...VALIDO, referencia: `${cien}a` }), HOY)).toEqual({ ok: false, error: MENSAJES_DE_REGISTRO.referencia_invalida });
  });

  it.each([
    ["sin reembolso", { ...VALIDO, id_reembolso: "" }, MENSAJES_DE_REGISTRO.no_encontrado],
    ["con un reembolso que no es un id", { ...VALIDO, id_reembolso: "1 or 1=1" }, MENSAJES_DE_REGISTRO.no_encontrado],
    ["sin referencia", { ...VALIDO, referencia: "" }, MENSAJES_DE_REGISTRO.referencia_invalida],
    ["con la referencia en blanco", { ...VALIDO, referencia: " \n\t " }, MENSAJES_DE_REGISTRO.referencia_invalida],
    ["con 101 caracteres de referencia", { ...VALIDO, referencia: "a".repeat(101) }, MENSAJES_DE_REGISTRO.referencia_invalida],
    ["sin fecha", { ...VALIDO, fecha: "" }, ERRORES_DE_FECHA.falta],
    ["con una fecha sin forma", { ...VALIDO, fecha: "10/01/2030" }, ERRORES_DE_FECHA.falta],
    ["con un día que no existe", { ...VALIDO, fecha: "2030-02-30" }, ERRORES_DE_FECHA.falta],
    ["con una fecha de mañana", { ...VALIDO, fecha: "2030-01-11" }, ERRORES_DE_FECHA.futura],
    ["con una fecha anterior al día en que se creó", { ...VALIDO, fecha: "2030-01-05" }, ERRORES_DE_FECHA.antesDeCrearse],
  ])("rechaza un formulario %s", (_caso, campos, error) => {
    expect(leerRegistro(formulario(campos), HOY)).toEqual({ ok: false, error });
  });

  it("los errores de la fecha dicen lo mismo que la base, por partes", () => {
    expect(ERRORES_DE_FECHA).toEqual({
      falta: "Escribe la fecha de la transferencia.",
      futura: "La fecha de la transferencia no puede ser posterior a hoy.",
      antesDeCrearse: "La fecha de la transferencia no puede ser anterior al día en que se creó el reembolso.",
    });
  });

  it("sin el día de creación no lo anticipa: lo decide la base", () => {
    const sinMinima = formulario({ ...VALIDO, fecha: "2020-01-01" });
    sinMinima.delete("fecha_minima");
    expect(leerRegistro(sinMinima, HOY).ok).toBe(true);
    expect(leerRegistro(formulario({ ...VALIDO, fecha_minima: "otra cosa", fecha: "2020-01-01" }), HOY).ok).toBe(true);
  });

  it("un archivo en vez de texto no cuenta como referencia", () => {
    const datos = formulario(VALIDO);
    datos.set("referencia", new Blob(["REF-26"]));
    expect(leerRegistro(datos, HOY)).toEqual({ ok: false, error: MENSAJES_DE_REGISTRO.referencia_invalida });
  });
});

describe("consecuenciasDeRegistrar", () => {
  it("dice qué se registra, a qué llave y que no se deshace", () => {
    expect(consecuenciasDeRegistrar("$ 25.000", "3001234567")).toBe("Registra la transferencia de $ 25.000 a 3001234567. No se puede deshacer.");
  });
});

describe("avisosDeLaPagina", () => {
  const REEMBOLSADO = { estado: "reembolsado" as const, idAdmin: YO };
  const PENDIENTE = { estado: "pendiente" as const, idAdmin: YO };
  const EXITO = {
    exito: true,
    texto: "Registraste la transferencia. El reembolso sale de tu bandeja y quien pagó ve en su enlace que ya le devolvimos el dinero.",
  };

  it("dice que se registró solo si el reembolso de verdad quedó reembolsado por el admin de la sesión", () => {
    expect(avisosDeLaPagina({ registrado: "reembolsado" }, REEMBOLSADO, YO)).toEqual([EXITO]);
    expect(avisosDeLaPagina({ registrado: "reembolsado" }, PENDIENTE, YO)).toEqual([]);
    expect(avisosDeLaPagina({ registrado: "reembolsado" }, { estado: "esperando_llave", idAdmin: YO }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ registrado: "reembolsado" }, { ...REEMBOLSADO, idAdmin: OTRO }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ registrado: "reembolsado" }, { ...REEMBOLSADO, idAdmin: null }, YO)).toEqual([]);
    expect(avisosDeLaPagina({ registrado: "otro" }, REEMBOLSADO, YO)).toEqual([]);
    expect(avisosDeLaPagina({ registrado: ["reembolsado", "reembolsado"] }, REEMBOLSADO, YO)).toEqual([]);
  });

  it("si ya estaba registrado, pide no transferirlo de nuevo", () => {
    expect(avisosDeLaPagina({ error: "ya_reembolsado" }, { ...REEMBOLSADO, idAdmin: OTRO }, YO)).toEqual([
      { exito: false, texto: MENSAJES_DE_REGISTRO.ya_reembolsado },
    ]);
  });

  it("lo demás que cambió mientras el admin miraba se dice una vez como alerta: la página ya se pinta como quedó", () => {
    for (const error of CAMBIOS_DEL_REEMBOLSO.filter((e) => e !== "ya_reembolsado")) {
      expect(avisosDeLaPagina({ error }, PENDIENTE, YO), error).toEqual([{ exito: false, texto: MENSAJE_DE_CAMBIO }]);
    }
  });

  it("los errores desconocidos, los del formulario y los repetidos no se dicen", () => {
    for (const error of ["<script>", "referencia_invalida", "fecha_invalida", "sin_permiso", "monto_cambio"]) {
      expect(avisosDeLaPagina({ error }, PENDIENTE, YO), error).toEqual([]);
    }
    expect(avisosDeLaPagina({ error: ["sin_llave", "no_asignado"] }, PENDIENTE, YO)).toEqual([]);
  });

  it("también dice qué pasó al reenviar el enlace (?reenvio=)", () => {
    expect(avisosDeLaPagina({ reenvio: "reenviado" }, { estado: "esperando_llave", idAdmin: OTRO }, YO)).toEqual([
      { exito: true, texto: "Le mandamos otra vez el enlace a quien pagó. Le llega en unos minutos y el plazo no cambia." },
    ]);
    expect(avisosDeLaPagina({ reenvio: "ya_entregada" }, PENDIENTE, YO)).toEqual([{ exito: false, texto: "No hace falta: quien pagó ya nos envió su llave." }]);
    expect(avisosDeLaPagina({ reenvio: "otro" }, PENDIENTE, YO)).toEqual([]);
  });
});
