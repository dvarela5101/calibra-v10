import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVISO_DEL_CODIGO,
  CODIGO_UNIANDES,
  ERRORES,
  GUARDAR_FALLO,
  SIN_PERMISO_PARA_CAMBIAR,
  entenderResultadoDeBorrar,
  leerEvaluacion,
  leerMateria,
  lineaDeEvaluacion,
  mensajeDeError,
  nombreDeLaConsulta,
  nombreRepetido,
  normalizarCodigo,
  preguntaDeBorrarEvaluacion,
  preguntaDeBorrarMateria,
  textoDeCodigoRepetido,
  textoDeEvaluaciones,
  textoDeLoLigado,
  textoDeLoLigadoAhora,
} from "./reglas";

// HU-055 sin navegador ni base: la lectura de los formularios, los textos de la lista y del borrado y los mensajes de
// los errores de la base. Lo que la base exige (trigger, índice, permisos) lo cubre supabase/tests/gestionar_materias.test.sql.

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Un nombre de `n` puntos de código. */
const nombreDe = (n: number, letra = "a") => letra.repeat(n);

describe("normalizarCodigo", () => {
  it("recorta los bordes y sube a mayúsculas", () => {
    expect(normalizarCodigo("  mate-1214 ")).toBe("MATE-1214");
    expect(normalizarCodigo("Isis-1221")).toBe("ISIS-1221");
  });

  it("no toca lo de adentro", () => {
    expect(normalizarCodigo("ma te-12 14")).toBe("MA TE-12 14");
  });
});

describe("el recorte de la base y el de la app dicen lo mismo", () => {
  // Los triggers de la migración recortan con `btrim(x, c_blancos)` y la app con `trim()` de JavaScript. Si no quitaran lo mismo,
  // un nombre de solo un tabulador o un espacio de no separación se rechazaría en la app y se guardaría por la Data API.
  const migracion = readFileSync(new URL("../../../supabase/migrations/20261011170714_gestionar_materias.sql", import.meta.url), "utf8");
  const barra = String.fromCharCode(92);
  const SECUENCIA = new RegExp(`${barra}${barra}(x[0-9a-f]{2}|u[0-9a-f]{4}|[tnr])`, "g");

  /** Lo que escribe un literal `E'…'` de Postgres: tabulador, salto de línea, retorno de carro, `xNN` y `uNNNN` con su barra invertida. */
  const decodificar = (literal: string) =>
    literal.replace(SECUENCIA, (_, c: string) =>
      c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "\r" : String.fromCharCode(parseInt(c.slice(1), 16)),
    );
  const codigos = (texto: string) => [...texto].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).sort();

  it("la constante c_blancos de los dos triggers es exactamente lo que trim() quita de los bordes", () => {
    const literales = [...migracion.matchAll(/c_blancos constant text := E'([^']*)';/g)].map((m) => decodificar(m[1]));
    expect(literales, "uno en el trigger de la materia y otro en el de la evaluación").toHaveLength(2);

    let deLaApp = "";
    for (let c = 0; c <= 0xffff; c++) if (String.fromCharCode(c).trim() === "") deLaApp += String.fromCharCode(c);
    for (const literal of literales) expect(codigos(literal)).toEqual(codigos(deLaApp));
  });

  it("un nombre de solo blancos de esos es vacío en la app, y un código con ellos en los bordes se recorta", () => {
    for (const blanco of ["\t", "\n", String.fromCharCode(0xa0), String.fromCharCode(0x3000), String.fromCharCode(0xfeff)]) {
      expect(leerMateria(formulario({ nombre: blanco, codigo: "MATE-1214" })).ok).toBe(false);
      expect(normalizarCodigo(`${blanco}mate-1214${blanco}`)).toBe("MATE-1214");
    }
  });
});

describe("CODIGO_UNIANDES", () => {
  it.each(["MATE-1214", "ZZZZ-0001", "ISIS-1221"])("acepta %s", (codigo) => {
    expect(CODIGO_UNIANDES.test(codigo)).toBe(true);
  });

  it.each(["MATE-12", "MATE-12145", "MATE-1214x", "xMATE-1214", "MAT-1214", "MATEM-1214", "MATE1214", "mate-1214", "ÁBCD-1234", "MATE-١٢٣٤", "MATE-1214\n"])(
    "rechaza %j",
    (codigo) => {
      expect(CODIGO_UNIANDES.test(codigo)).toBe(false);
    },
  );
});

describe("leerMateria: crear", () => {
  it("normaliza el código y recorta el nombre", () => {
    const lectura = leerMateria(formulario({ nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " }));
    expect(lectura).toEqual({
      ok: true,
      datos: { nombre: "Cálculo Diferencial", codigo: "MATE-1214" },
      valores: { nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " },
    });
  });

  it("un nombre vacío o de solo espacios da el error junto al campo, y los campos conservan lo escrito", () => {
    for (const nombre of ["", "   ", "\t \n"]) {
      const lectura = leerMateria(formulario({ nombre, codigo: "mate-1214" }));
      expect(lectura).toEqual({ ok: false, errores: { nombre: ERRORES.nombreDeMateria }, valores: { nombre, codigo: "mate-1214" } });
    }
  });

  it("falta el campo o es un archivo: cuenta como vacío", () => {
    expect(leerMateria(new FormData())).toMatchObject({ ok: false, errores: { nombre: ERRORES.nombreDeMateria, codigo: ERRORES.codigo } });
    expect(leerMateria(formulario({ nombre: new Blob(["x"]), codigo: "MATE-1214" }))).toMatchObject({
      ok: false,
      errores: { nombre: ERRORES.nombreDeMateria },
    });
  });

  it("el nombre llega hasta 120 caracteres y 121 se rechaza", () => {
    expect(leerMateria(formulario({ nombre: nombreDe(120), codigo: "MATE-1214" })).ok).toBe(true);
    expect(leerMateria(formulario({ nombre: nombreDe(121), codigo: "MATE-1214" }))).toMatchObject({
      ok: false,
      errores: { nombre: ERRORES.nombreLargo },
    });
  });

  it("el largo se cuenta por puntos de código, como char_length: 120 emojis valen 120, aunque ocupen 240 unidades de UTF-16", () => {
    const emojis = (n: number) => "😀".repeat(n);
    expect(emojis(120).length).toBe(240);
    expect(leerMateria(formulario({ nombre: emojis(120), codigo: "MATE-1214" })).ok).toBe(true);
    expect(leerMateria(formulario({ nombre: emojis(121), codigo: "MATE-1214" })).ok).toBe(false);
  });

  it("los espacios de los bordes no cuentan en el largo", () => {
    expect(leerMateria(formulario({ nombre: `  ${nombreDe(120)}  `, codigo: "MATE-1214" })).ok).toBe(true);
  });

  it.each(["", "MATE-12", "MATE-1214x", "ZZ-1", "ABCD-12345", "ÁBCD-1234", "MATE 1214", "MATE-١٢٣٤"])("el código %j da el error del código", (codigo) => {
    expect(leerMateria(formulario({ nombre: "Cálculo", codigo }))).toEqual({
      ok: false,
      errores: { codigo: ERRORES.codigo },
      valores: { nombre: "Cálculo", codigo },
    });
  });

  it("con los dos campos mal, dice los dos errores", () => {
    expect(leerMateria(formulario({ nombre: "", codigo: "x" }))).toMatchObject({
      ok: false,
      errores: { nombre: ERRORES.nombreDeMateria, codigo: ERRORES.codigo },
    });
  });
});

describe("leerMateria: editar (el código y el nombre guardados)", () => {
  it("un código guardado sin forma Uniandes que no cambia no pide formato (PRB-1)", () => {
    const lectura = leerMateria(formulario({ nombre: "Otro nombre", codigo: "PRB-1" }), { codigoGuardado: "PRB-1" });
    expect(lectura).toMatchObject({ ok: true, datos: { nombre: "Otro nombre", codigo: "PRB-1" } });
  });

  it("un código histórico con espacios y minúsculas, reenviado normalizado, no cuenta como cambio", () => {
    const lectura = leerMateria(formulario({ nombre: "Otro nombre", codigo: "PRB-2" }), { codigoGuardado: " prb-2 " });
    expect(lectura).toMatchObject({ ok: true, datos: { codigo: "PRB-2" } });
    expect(leerMateria(formulario({ nombre: "Otro nombre", codigo: " prb-2 " }), { codigoGuardado: "PRB-2" }).ok).toBe(true);
  });

  it("si el código cambia, se exige la forma: PRB-1 no se puede cambiar a PRB-9 ni a nada sin forma", () => {
    expect(leerMateria(formulario({ nombre: "Nombre", codigo: "PRB-9" }), { codigoGuardado: "PRB-1" })).toMatchObject({
      ok: false,
      errores: { codigo: ERRORES.codigo },
    });
    expect(leerMateria(formulario({ nombre: "Nombre", codigo: "MATE-1215" }), { codigoGuardado: "PRB-1" }).ok).toBe(true);
  });

  it("un código con forma que cambia de MATE-1214 a mate-1215 se acepta normalizado", () => {
    expect(leerMateria(formulario({ nombre: "Nombre", codigo: "mate-1215" }), { codigoGuardado: "MATE-1214" })).toMatchObject({
      ok: true,
      datos: { codigo: "MATE-1215" },
    });
  });

  it("un nombre guardado de más de 120 caracteres que no cambia no impide corregir el código", () => {
    const largo = nombreDe(130);
    expect(leerMateria(formulario({ nombre: largo, codigo: "MATE-1215" }), { codigoGuardado: "MATE-1214", nombreGuardado: largo }).ok).toBe(true);
    expect(leerMateria(formulario({ nombre: ` ${largo} `, codigo: "MATE-1215" }), { codigoGuardado: "MATE-1214", nombreGuardado: largo }).ok).toBe(true);
  });

  it("si el nombre largo cambia, se vuelve a exigir el largo; y sin nombre guardado, siempre", () => {
    const largo = nombreDe(130);
    expect(
      leerMateria(formulario({ nombre: nombreDe(131), codigo: "MATE-1214" }), { codigoGuardado: "MATE-1214", nombreGuardado: largo }),
    ).toMatchObject({ ok: false, errores: { nombre: ERRORES.nombreLargo } });
    expect(leerMateria(formulario({ nombre: largo, codigo: "MATE-1214" }), { codigoGuardado: "MATE-1214" })).toMatchObject({
      ok: false,
      errores: { nombre: ERRORES.nombreLargo },
    });
  });

  it("un nombre vacío se rechaza aunque el guardado sea el mismo", () => {
    expect(leerMateria(formulario({ nombre: " ", codigo: "MATE-1214" }), { codigoGuardado: "MATE-1214", nombreGuardado: " " })).toMatchObject({
      ok: false,
      errores: { nombre: ERRORES.nombreDeMateria },
    });
  });
});

describe("leerEvaluacion", () => {
  const lee = (nombre: string, semana: string, guardada?: { nombreGuardado?: string }) => leerEvaluacion(formulario({ nombre, semana }), guardada);

  it("lee el nombre recortado y la semana como número", () => {
    expect(lee("  Parcial 1 ", " 3 ")).toEqual({
      ok: true,
      datos: { nombre: "Parcial 1", semana: 3 },
      valores: { nombre: "  Parcial 1 ", semana: " 3 " },
    });
  });

  it.each(["1", "9", "16", "52", "007", "2147483647"])("acepta la semana %j", (semana) => {
    expect(lee("Parcial", semana).ok).toBe(true);
  });

  it.each(["", " ", "0", "00", "-1", "+3", "1.5", "1,5", "1e2", "0x10", "tres", "٣", "２", "2147483648", "99999999999999999999", "3 4"])(
    "rechaza la semana %j con el mensaje de la semana",
    (semana) => {
      expect(lee("Parcial", semana)).toEqual({ ok: false, errores: { semana: ERRORES.semana }, valores: { nombre: "Parcial", semana } });
    },
  );

  it("la semana se guarda como número, no como texto: 007 es 7", () => {
    expect(lee("Parcial", "007")).toMatchObject({ datos: { semana: 7 } });
  });

  it("un nombre vacío o de más de 120 caracteres da el error del nombre; 120 pasa", () => {
    expect(lee("  ", "3")).toMatchObject({ ok: false, errores: { nombre: ERRORES.nombreDeEvaluacion } });
    expect(lee(nombreDe(121), "3")).toMatchObject({ ok: false, errores: { nombre: ERRORES.nombreLargo } });
    expect(lee(nombreDe(120), "3").ok).toBe(true);
    expect(lee("😀".repeat(120), "3").ok).toBe(true);
    expect(lee("😀".repeat(121), "3").ok).toBe(false);
  });

  it("un nombre guardado de más de 120 caracteres que no cambia no impide corregir la semana", () => {
    const largo = nombreDe(125);
    expect(lee(largo, "4", { nombreGuardado: largo }).ok).toBe(true);
    expect(lee(largo, "4").ok).toBe(false);
  });

  it("con los dos campos mal, dice los dos errores y conserva lo escrito", () => {
    expect(lee("", "0")).toEqual({
      ok: false,
      errores: { nombre: ERRORES.nombreDeEvaluacion, semana: ERRORES.semana },
      valores: { nombre: "", semana: "0" },
    });
  });
});

describe("nombreRepetido", () => {
  const hermanas = [
    { id: "a", nombre: "Parcial 1" },
    { id: "b", nombre: "Parcial 2" },
  ];

  it("detecta el nombre de otra evaluación de la materia, sin importar mayúsculas ni espacios de los bordes", () => {
    expect(nombreRepetido("Parcial 2", hermanas, "a")).toBe(true);
    expect(nombreRepetido("  parcial 2 ", hermanas, "a")).toBe(true);
    expect(nombreRepetido("PARCIAL 2", hermanas, "a")).toBe(true);
  });

  it("no cuenta a la propia evaluación: guardar sin cambiar el nombre no es un duplicado", () => {
    expect(nombreRepetido("Parcial 1", hermanas, "a")).toBe(false);
    expect(nombreRepetido("parcial 1 ", hermanas, "a")).toBe(false);
  });

  it("un nombre distinto, o sin hermanas, no se repite", () => {
    expect(nombreRepetido("Parcial 3", hermanas, "a")).toBe(false);
    expect(nombreRepetido("Parcial", hermanas, "a")).toBe(false);
    expect(nombreRepetido("Parcial 1", [], "a")).toBe(false);
  });
});

describe("textoDeEvaluaciones", () => {
  it.each([
    [0, 0, "Sin evaluaciones"],
    [1, 1, "1 evaluación, 1 activa"],
    [1, 0, "1 evaluación, ninguna activa"],
    [3, 1, "3 evaluaciones, 1 activa"],
    [3, 2, "3 evaluaciones, 2 activas"],
    [3, 3, "3 evaluaciones, 3 activas"],
    [3, 0, "3 evaluaciones, ninguna activa"],
    [10, 10, "10 evaluaciones, 10 activas"],
  ])("%i evaluaciones, %i activas: «%s»", (total, activas, texto) => {
    expect(textoDeEvaluaciones(total, activas)).toBe(texto);
  });
});

describe("lineaDeEvaluacion", () => {
  it("escribe la semana, si es acumulativa y si está activa", () => {
    expect(lineaDeEvaluacion({ semana: 8, acumulativo: false, activa: true })).toBe("Semana 8 · No acumulativa · Activa");
    expect(lineaDeEvaluacion({ semana: 16, acumulativo: true, activa: false })).toBe("Semana 16 · Acumulativa · Inactiva");
  });
});

describe("textoDeLoLigado (criterios 13 y 15)", () => {
  const TODO = ["evaluaciones", "temas", "certificados", "solicitudes", "diagnosticos", "monitorias"];

  it("de una materia, con los seis: la lista de la HU, con «y» antes del último", () => {
    expect(textoDeLoLigado(TODO, "materia")).toBe(
      "No se puede borrar: tiene evaluaciones, temas, certificados, solicitudes de monitor, diagnósticos y monitorías.",
    );
  });

  it("solo dice lo que de verdad tiene", () => {
    expect(textoDeLoLigado(["temas"], "materia")).toBe("No se puede borrar: tiene temas.");
    expect(textoDeLoLigado(["certificados", "monitorias"], "materia")).toBe("No se puede borrar: tiene certificados y monitorías.");
    expect(textoDeLoLigado(["evaluaciones", "diagnosticos", "monitorias"], "materia")).toBe(
      "No se puede borrar: tiene evaluaciones, diagnósticos y monitorías.",
    );
    expect(textoDeLoLigado(["solicitudes"], "materia")).toBe("No se puede borrar: tiene solicitudes de monitor.");
  });

  it("de una evaluación: temas y diagnósticos", () => {
    expect(textoDeLoLigado(["temas", "diagnosticos"], "evaluacion")).toBe("No se puede borrar: tiene temas y diagnósticos.");
    expect(textoDeLoLigado(["temas"], "evaluacion")).toBe("No se puede borrar: tiene temas.");
    expect(textoDeLoLigado(["diagnosticos"], "evaluacion")).toBe("No se puede borrar: tiene diagnósticos.");
  });

  it("las pone en el orden fijo de la base aunque lleguen en otro", () => {
    expect(textoDeLoLigado(["monitorias", "temas", "evaluaciones"], "materia")).toBe("No se puede borrar: tiene evaluaciones, temas y monitorías.");
    expect(textoDeLoLigado(["diagnosticos", "temas"], "evaluacion")).toBe("No se puede borrar: tiene temas y diagnósticos.");
  });

  it("lo que esta pantalla no conoce se dice como viene, para no esconder nada", () => {
    expect(textoDeLoLigado(["temas", "perfiles"], "materia")).toBe("No se puede borrar: tiene temas y perfiles.");
  });

  it("textoDeLoLigadoAhora: lo mismo, cuando alguien lo ligó después de abrir la página", () => {
    expect(textoDeLoLigadoAhora(["certificados"], "materia")).toBe("Ya no se puede borrar: tiene certificados. Recarga la página.");
    expect(textoDeLoLigadoAhora(["temas", "diagnosticos"], "evaluacion")).toBe("Ya no se puede borrar: tiene temas y diagnósticos. Recarga la página.");
  });
});

describe("las preguntas de borrar y el código repetido", () => {
  it("son las de la HU", () => {
    expect(preguntaDeBorrarMateria("Cálculo Diferencial", "MATE-1214")).toBe("¿Borrar la materia Cálculo Diferencial (MATE-1214)? No se puede deshacer.");
    expect(preguntaDeBorrarEvaluacion("Parcial 1")).toBe("¿Borrar la evaluación Parcial 1? No se puede deshacer.");
  });

  it("el código repetido nombra a quien lo tiene; sin el nombre, lo dice sin él", () => {
    expect(textoDeCodigoRepetido("Cálculo Diferencial")).toBe("Ya existe una materia con ese código: Cálculo Diferencial.");
    expect(textoDeCodigoRepetido(null)).toBe("Ya existe una materia con ese código.");
    expect(textoDeCodigoRepetido("")).toBe("Ya existe una materia con ese código.");
  });

  it("el aviso del código es el de la HU", () => {
    expect(AVISO_DEL_CODIGO).toBe("Los enlaces con el código anterior dejarán de encontrar esta materia.");
  });
});

describe("nombreDeLaConsulta (?borrada= y ?evaluacion_borrada=)", () => {
  it("devuelve el nombre recortado", () => {
    expect(nombreDeLaConsulta("  Cálculo ")).toBe("Cálculo");
  });

  it("sin valor, vacío o de espacios: nada", () => {
    expect(nombreDeLaConsulta(undefined)).toBeNull();
    expect(nombreDeLaConsulta("")).toBeNull();
    expect(nombreDeLaConsulta("   ")).toBeNull();
    expect(nombreDeLaConsulta([])).toBeNull();
  });

  it("recorta a 120 caracteres, por puntos de código", () => {
    expect(nombreDeLaConsulta("a".repeat(500))).toBe("a".repeat(120));
    expect(nombreDeLaConsulta("😀".repeat(500))).toBe("😀".repeat(120));
  });

  it("con varios valores toma el primero", () => {
    expect(nombreDeLaConsulta(["uno", "dos"])).toBe("uno");
  });

  it("no interpreta nada: devuelve el texto tal cual, para que React lo escape", () => {
    expect(nombreDeLaConsulta("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("entenderResultadoDeBorrar", () => {
  it("entiende las tres respuestas simples", () => {
    expect(entenderResultadoDeBorrar("borrada")).toEqual({ tipo: "borrada" });
    expect(entenderResultadoDeBorrar("no_existe")).toEqual({ tipo: "no_existe" });
    expect(entenderResultadoDeBorrar("no_autorizado")).toEqual({ tipo: "no_autorizado" });
  });

  it("ligada:a,b trae la lista", () => {
    expect(entenderResultadoDeBorrar("ligada:evaluaciones,temas")).toEqual({ tipo: "ligada", ligado: ["evaluaciones", "temas"] });
    expect(entenderResultadoDeBorrar("ligada:temas")).toEqual({ tipo: "ligada", ligado: ["temas"] });
  });

  it.each(["", "ligada:", "ligada:,", "ligada", "Borrada", "borrada ", "ok", null, undefined, 3, ["borrada"]])("%j lanza", (texto) => {
    expect(() => entenderResultadoDeBorrar(texto)).toThrow(/Respuesta inesperada al borrar/);
  });
});

describe("mensajeDeError", () => {
  it("23505 pide buscar quién tiene el código", () => {
    expect(mensajeDeError({ code: "23505", hint: null })).toEqual({ tipo: "codigo_repetido" });
  });

  it("23514 con la pista del trigger es del campo", () => {
    expect(mensajeDeError({ code: "23514", hint: "nombre" })).toEqual({ tipo: "campo", campo: "nombre", texto: ERRORES.nombreDeLaBase });
    expect(mensajeDeError({ code: "23514", hint: "codigo" })).toEqual({ tipo: "campo", campo: "codigo", texto: ERRORES.codigo });
    expect(mensajeDeError({ code: "23514", hint: "semana" })).toEqual({ tipo: "campo", campo: "semana", texto: ERRORES.semana });
  });

  it("23514 sin pista (la restricción de la semana no trae ninguna) es el error general", () => {
    expect(mensajeDeError({ code: "23514", hint: null })).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
    expect(mensajeDeError({ code: "23514" })).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
    expect(mensajeDeError({ code: "23514", hint: "otra" })).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
  });

  it("22003 (la semana no cabe en un integer) es el mensaje de la semana", () => {
    expect(mensajeDeError({ code: "22003" })).toEqual({ tipo: "campo", campo: "semana", texto: ERRORES.semana });
  });

  it("42501 es una cuenta sin permiso", () => {
    expect(mensajeDeError({ code: "42501", hint: "Grant the required privileges…" })).toEqual({ tipo: "general", texto: SIN_PERMISO_PARA_CAMBIAR });
  });

  it("cualquier otra cosa, o ningún error, es el error general", () => {
    expect(mensajeDeError({ code: "XX000" })).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
    expect(mensajeDeError({ code: "" })).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
    expect(mensajeDeError(null)).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
    expect(mensajeDeError(undefined)).toEqual({ tipo: "general", texto: GUARDAR_FALLO });
  });

  it("los textos son los de la HU", () => {
    expect(GUARDAR_FALLO).toBe("No pudimos guardar los cambios. Intenta de nuevo.");
    expect(SIN_PERMISO_PARA_CAMBIAR).toBe("Tu cuenta no puede cambiar materias ni evaluaciones.");
  });
});
