import { describe, expect, it } from "vitest";
import { avisoDeConservada, decidirMateria, diferenciasDeEvaluacion } from "../scripts/contenido/cargar.mts";
import type { DecisionMateria, Diferencia } from "../scripts/contenido/cargar.mts";

// HU-055 (D-62 a): qué hace la carga del banco con una materia o una evaluación que un admin editó desde la app.
// Son las decisiones, sin base de datos: reconocer la materia por carpeta, adoptarla, el candado y el upsert de la
// evaluación los prueba integracion/banco.test.ts contra el Supabase local.
//
// La materia del banco dice "Materia de prueba A" con el código ZZPR-0001. La marca `editada_en_app` la pone la base
// cuando un admin cambia el nombre o el código; la carga no la pone nunca.

const DEL_BANCO = { nombre: "Materia de prueba A", codigo: "ZZPR-0001" };

const nombre = (enBase: string): Diferencia => ({ campo: "nombre", enBase, delBanco: DEL_BANCO.nombre });
const codigo = (enBase: string): Diferencia => ({ campo: "codigo", enBase, delBanco: DEL_BANCO.codigo });

describe("decidirMateria: la tabla completa (marca × qué difiere)", () => {
  const casos: [string, { nombre: string; codigo: string }, boolean, DecisionMateria][] = [
    // Sin la marca el markdown manda: se aplica lo que difiere, y solo eso.
    ["sin marca, todo igual", DEL_BANCO, false, { cambios: {}, diferencias: [], bajarMarca: false }],
    [
      "sin marca, otro nombre",
      { nombre: "Otro nombre", codigo: "ZZPR-0001" },
      false,
      { cambios: { nombre: DEL_BANCO.nombre }, diferencias: [], bajarMarca: false },
    ],
    [
      "sin marca, otro código",
      { nombre: DEL_BANCO.nombre, codigo: "ZZPR-0009" },
      false,
      { cambios: { codigo: DEL_BANCO.codigo }, diferencias: [], bajarMarca: false },
    ],
    [
      "sin marca, otro nombre y otro código",
      { nombre: "Otro nombre", codigo: "ZZPR-0009" },
      false,
      { cambios: { nombre: DEL_BANCO.nombre, codigo: DEL_BANCO.codigo }, diferencias: [], bajarMarca: false },
    ],
    // Con la marca la base conserva lo suyo, lo reporta, y la marca baja solo cuando ya no hay diferencia.
    ["con marca, todo igual: la marca baja", DEL_BANCO, true, { cambios: {}, diferencias: [], bajarMarca: true }],
    [
      "con marca, otro nombre",
      { nombre: "Otro nombre", codigo: "ZZPR-0001" },
      true,
      { cambios: {}, diferencias: [nombre("Otro nombre")], bajarMarca: false },
    ],
    [
      "con marca, otro código",
      { nombre: DEL_BANCO.nombre, codigo: "ZZPR-0009" },
      true,
      { cambios: {}, diferencias: [codigo("ZZPR-0009")], bajarMarca: false },
    ],
    [
      "con marca, otro nombre y otro código (nombre primero)",
      { nombre: "Otro nombre", codigo: "ZZPR-0009" },
      true,
      { cambios: {}, diferencias: [nombre("Otro nombre"), codigo("ZZPR-0009")], bajarMarca: false },
    ],
  ];

  it.each(casos)("%s", (_caso, fila, editada_en_app, esperado) => {
    // toStrictEqual: un campo con valor `undefined` en `cambios` contaría como escrito.
    expect(decidirMateria({ ...fila, editada_en_app }, DEL_BANCO)).toStrictEqual(esperado);
  });

  it("compara los valores tal cual: un código en minúsculas o con espacios no es el de materia.md", () => {
    const enBase = { nombre: DEL_BANCO.nombre, codigo: " zzpr-0001 " };
    // Sin marca (una fila de confianza adoptada): el banco manda y se corrige el código.
    expect(decidirMateria({ ...enBase, editada_en_app: false }, DEL_BANCO)).toStrictEqual({
      cambios: { codigo: "ZZPR-0001" },
      diferencias: [],
      bajarMarca: false,
    });
    // Con marca: es una diferencia más y la marca no baja.
    expect(decidirMateria({ ...enBase, editada_en_app: true }, DEL_BANCO)).toStrictEqual({
      cambios: {},
      diferencias: [codigo(" zzpr-0001 ")],
      bajarMarca: false,
    });
  });

  it("distingue las mayúsculas del nombre", () => {
    const decision = decidirMateria({ nombre: "materia de prueba a", codigo: "ZZPR-0001", editada_en_app: true }, DEL_BANCO);
    expect(decision.diferencias).toStrictEqual([nombre("materia de prueba a")]);
    expect(decision.bajarMarca).toBe(false);
  });
});

describe("diferenciasDeEvaluacion: lo que devolvió el upsert de la evaluación", () => {
  const DEL_BANCO_EVALUACION = { nombre: "Parcial 1", semana: 6 };

  // `editada_en_app` es la marca que dejó el upsert: true si la base conservó lo del admin, false si escribió el banco o
  // si la marca bajó porque el banco ya decía lo mismo.
  const casos: [string, { nombre: string; semana: number; editada_en_app: boolean }, Diferencia[]][] = [
    ["marca puesta, otro nombre", { nombre: "Primer parcial", semana: 6, editada_en_app: true }, [{ campo: "nombre", enBase: "Primer parcial", delBanco: "Parcial 1" }]],
    ["marca puesta, otra semana", { nombre: "Parcial 1", semana: 9, editada_en_app: true }, [{ campo: "semana", enBase: 9, delBanco: 6 }]],
    [
      "marca puesta, otro nombre y otra semana (nombre primero)",
      { nombre: "Primer parcial", semana: 9, editada_en_app: true },
      [
        { campo: "nombre", enBase: "Primer parcial", delBanco: "Parcial 1" },
        { campo: "semana", enBase: 9, delBanco: 6 },
      ],
    ],
    ["marca puesta, nombre y semana iguales al banco", { nombre: "Parcial 1", semana: 6, editada_en_app: true }, []],
    ["marca bajada: el banco escribió lo suyo", { nombre: "Parcial 1", semana: 6, editada_en_app: false }, []],
    // Sin marca la fila es del banco: aunque no coincidiera, no sería un aviso de "la base conserva".
    ["sin marca, aunque los valores difieran", { nombre: "Otro", semana: 9, editada_en_app: false }, []],
  ];

  it.each(casos)("%s", (_caso, fila, esperado) => {
    expect(diferenciasDeEvaluacion(fila, DEL_BANCO_EVALUACION)).toStrictEqual(esperado);
  });
});

describe("avisoDeConservada: la frase", () => {
  const CIERRE = "Para que vuelva a seguir al banco, iguala materia.md con la base.";

  it("materia: nombre y código con sus dos valores, entre comillas", () => {
    expect(avisoDeConservada("materia-a", [nombre("Nombre del admin"), codigo("ZZPR-0009")])).toBe(
      `materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin", materia.md "Materia de prueba A"; ` +
        `codigo: base "ZZPR-0009", materia.md "ZZPR-0001"). ${CIERRE}`,
    );
  });

  it("materia: un solo campo", () => {
    expect(avisoDeConservada("materia-a", [codigo("ZZPR-0009")])).toBe(
      `materia-a: la base conserva lo que un admin cambió en la app (codigo: base "ZZPR-0009", materia.md "ZZPR-0001"). ${CIERRE}`,
    );
  });

  it("evaluación: carpeta/clave, el nombre entre comillas y la semana como número", () => {
    expect(
      avisoDeConservada("materia-a/parcial-1", [
        { campo: "nombre", enBase: "Primer parcial", delBanco: "Parcial 1" },
        { campo: "semana", enBase: 9, delBanco: 6 },
      ]),
    ).toBe(
      `materia-a/parcial-1: la base conserva lo que un admin cambió en la app (nombre: base "Primer parcial", materia.md "Parcial 1"; ` +
        `semana: base 9, materia.md 6). ${CIERRE}`,
    );
  });
});
