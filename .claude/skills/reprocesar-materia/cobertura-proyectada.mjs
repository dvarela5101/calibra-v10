// Cobertura proyectada de una materia (HU-061, paso 5 de contenido/PROCESO.md).
//
//   node .claude/skills/reprocesar-materia/cobertura-proyectada.mjs <materia> [opciones]
//
//   <materia>              carpeta de la materia en contenido/ (calculo-diferencial)
//   --evaluacion <clave>   alcance: las habilidades de los temas de esa Evaluación (parcial-1)
//   --temas a,b            alcance: las habilidades de esos temas
//                          (sin alcance, se cuenta toda la materia)
//   --banco <ruta>         otra carpeta de banco (por defecto, contenido/ del clon)
//   --json                 imprime el resultado como JSON en vez de texto
//
// El convertidor (npm run contenido:validar) cuenta solo las preguntas revisadas, también con
// --borradores (scripts/contenido/banco.mts, calcularCobertura). Este script cuenta revisadas y
// borradores, nunca las retiradas, para saber si la materia llegaría a la meta cuando se revise lo
// generado. Con `⚠ revisar` una pregunta cuenta igual, como en el convertidor.
//
// Meta por habilidad (notas técnicas de HU-061): al menos 4 preguntas, 2 o más de dificultad 2,
// 2 o más de dificultad 1 o 3 y al menos una de dificultad 3. Rechazar cualquier pregunta deja
// entonces la cobertura de D-13 (3 preguntas en 2 dificultades).
//
// Salida: 0 si todas las habilidades del alcance llegan a la meta; 2 si alguna no; 1 si el uso o el
// banco tienen errores.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatearDiagnostico, leerBanco } from "../../../scripts/contenido/banco.mts";

export const BANCO_POR_DEFECTO = join(import.meta.dirname, "..", "..", "..", "contenido");

/** La meta de HU-061 por habilidad. */
export const META = { total: 4, dificultad2: 2, fueraDe2: 2, dificultad3: 1 };
/** La cobertura de D-13 con la que se activa una Evaluación. */
export const D13 = { preguntas: 3, dificultades: 2 };
/** Veces que una misconcepción debería salir como trampa (el motor la necesita dos veces). */
export const TRAMPAS_POR_MISCONCEPCION = 2;

const USO = "Uso: node .claude/skills/reprocesar-materia/cobertura-proyectada.mjs <materia> [--evaluacion <clave> | --temas a,b] [--banco <ruta>] [--json]";

/** Preguntas por dificultad: { 1, 2, 3 }. */
export function contarDificultades(preguntas) {
  const c = { 1: 0, 2: 0, 3: 0 };
  for (const p of preguntas) c[p.dificultad] += 1;
  return c;
}

/** Cobertura de D-13: 3 preguntas o más en 2 dificultades o más. */
export function cumpleD13(preguntas) {
  return preguntas.length >= D13.preguntas && new Set(preguntas.map((p) => p.dificultad)).size >= D13.dificultades;
}

/** Lo que le falta a unos conteos { 1, 2, 3 } para la meta. Vacío si la cumple. */
export function faltantesDeMeta(c) {
  const total = c[1] + c[2] + c[3];
  const faltan = [];
  if (total < META.total) faltan.push(`${total} de ${META.total} preguntas`);
  if (c[2] < META.dificultad2) faltan.push(`${c[2]} de ${META.dificultad2} de dificultad 2`);
  if (c[1] + c[3] < META.fueraDe2) faltan.push(`${c[1] + c[3]} de ${META.fueraDe2} de dificultad 1 o 3`);
  if (c[3] < META.dificultad3) faltan.push(`${c[3]} de ${META.dificultad3} de dificultad 3`);
  return faltan;
}

/** Cuántas preguntas hay que agregar, como mínimo, para llegar a la meta (0 si ya llega). */
export function minimoPorAgregar(c) {
  let mejor = Infinity;
  for (let a1 = 0; a1 <= META.total; a1 += 1) {
    for (let a2 = 0; a2 <= META.total; a2 += 1) {
      for (let a3 = 0; a3 <= META.total; a3 += 1) {
        if (faltantesDeMeta({ 1: c[1] + a1, 2: c[2] + a2, 3: c[3] + a3 }).length === 0) mejor = Math.min(mejor, a1 + a2 + a3);
      }
    }
  }
  return mejor;
}

/** Quitar cualquiera de las preguntas deja la cobertura de D-13. */
export function resisteRechazo(preguntas) {
  return preguntas.every((_, i) => cumpleD13(preguntas.filter((__, j) => j !== i)));
}

/**
 * Calcula la cobertura actual (la del convertidor: revisadas) y la proyectada (revisadas y borradores)
 * de una materia ya leída. `alcance` es null (toda la materia) o la lista de claves de habilidad.
 */
export function analizar(materia, alcance = null) {
  const todas = materia.temas.flatMap((t) => t.preguntas);
  const revisadas = todas.filter((p) => p.estado === "revisada");
  const proyectables = todas.filter((p) => p.estado === "revisada" || p.estado === "borrador");

  const temaDe = new Map();
  const habilidades = [];
  for (const tema of materia.temas) {
    for (const h of tema.habilidades) {
      temaDe.set(h.clave, tema.clave);
      const hoy = revisadas.filter((p) => p.habilidades.includes(h.clave));
      const proyectadas = proyectables.filter((p) => p.habilidades.includes(h.clave));
      const c = contarDificultades(proyectadas);
      const faltan = faltantesDeMeta(c);
      habilidades.push({
        clave: h.clave,
        tema: tema.clave,
        actual: {
          preguntas: hoy.length,
          dificultades: [...new Set(hoy.map((p) => p.dificultad))].sort(),
          cumpleD13: cumpleD13(hoy),
        },
        proyectada: {
          preguntas: proyectadas.length,
          porDificultad: c,
          cumpleD13: cumpleD13(proyectadas),
          resisteRechazo: resisteRechazo(proyectadas),
          cumpleMeta: faltan.length === 0,
          faltan,
          porAgregar: minimoPorAgregar(c),
        },
      });
    }
  }
  const enAlcance = alcance === null ? habilidades : habilidades.filter((h) => alcance.includes(h.clave));
  const clavesEnAlcance = new Set(enAlcance.map((h) => h.clave));

  const misconcepciones = [];
  for (const tema of materia.temas) {
    for (const m of tema.misconcepciones) {
      if (!clavesEnAlcance.has(m.habilidad)) continue;
      const ofrece = (p) => p.opciones.some((o) => !o.correcta && o.misconcepcion === m.clave);
      misconcepciones.push({
        clave: m.clave,
        habilidad: m.habilidad,
        actual: revisadas.filter(ofrece).length,
        proyectada: proyectables.filter(ofrece).length,
      });
    }
  }

  const d13Proyectada = new Map(habilidades.map((h) => [h.clave, h.proyectada.cumpleD13]));
  const meta = new Map(habilidades.map((h) => [h.clave, h.proyectada.cumpleMeta]));
  const evaluaciones = materia.evaluaciones.map((e) => {
    const claves = materia.temas.filter((t) => e.temas.includes(t.clave)).flatMap((t) => t.habilidades.map((h) => h.clave));
    return {
      clave: e.clave,
      nombre: e.nombre,
      semana: e.semana,
      habilidades: claves.length,
      activaHoy: e.activa,
      activaProyectada: claves.length > 0 && claves.every((c) => d13Proyectada.get(c) === true),
      habilidadesSinMeta: claves.filter((c) => meta.get(c) !== true).length,
    };
  });

  const ia = todas.filter((p) => p.origen.startsWith("ia")).length;
  return {
    materia: materia.carpeta,
    preguntas: {
      total: todas.length,
      revisadas: revisadas.length,
      borradores: todas.filter((p) => p.estado === "borrador").length,
      retiradas: todas.filter((p) => p.estado === "retirada").length,
      porRevisar: todas.filter((p) => p.porRevisar).length,
      origenIa: ia,
      origenHumano: todas.length - ia,
    },
    habilidades: enAlcance,
    misconcepciones: {
      total: misconcepciones.length,
      conTrampaEn2oMas: misconcepciones.filter((m) => m.proyectada >= TRAMPAS_POR_MISCONCEPCION).length,
      conTrampaEn2oMasHoy: misconcepciones.filter((m) => m.actual >= TRAMPAS_POR_MISCONCEPCION).length,
      lista: misconcepciones,
    },
    evaluaciones,
    sinMeta: enAlcance.filter((h) => !h.proyectada.cumpleMeta).map((h) => h.clave),
  };
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** El reporte en texto. */
export function formatear(r, descripcionAlcance) {
  const s = [];
  const p = r.preguntas;
  s.push(`Cobertura de ${r.materia}${descripcionAlcance ? ` (${descripcionAlcance})` : ""}`);
  s.push(
    `Preguntas de la materia: ${p.total} (${p.revisadas} revisadas, ${p.borradores} borradores, ${p.retiradas} retiradas; ` +
      `${p.origenIa} de origen IA, ${p.origenHumano} humano; ${p.porRevisar} con ⚠ revisar)`,
  );
  s.push("");
  s.push(
    `Por habilidad. Actual = revisadas, como el convertidor. Proyectada = revisadas y borradores, con la meta ` +
      `${META.total}+ preguntas, ${META.dificultad2}+ de dificultad 2, ${META.fueraDe2}+ de dificultad 1 o 3 y ${META.dificultad3}+ de dificultad 3:`,
  );
  const ancho = Math.max(0, ...r.habilidades.map((h) => h.clave.length));
  for (const h of r.habilidades) {
    const c = h.proyectada.porDificultad;
    const hoy = `${h.actual.cumpleD13 ? "✓" : "✗"} actual ${h.actual.preguntas}`;
    const proy =
      `${h.proyectada.cumpleMeta ? "✓" : "✗"} proyectada ${h.proyectada.preguntas} (d1: ${c[1]}, d2: ${c[2]}, d3: ${c[3]})`;
    const falta = h.proyectada.cumpleMeta ? "" : `  falta: ${h.proyectada.faltan.join("; ")}; agrega ${plural(h.proyectada.porAgregar, "pregunta", "preguntas")} como mínimo`;
    s.push(`  ${h.clave.padEnd(ancho)}  ${hoy}  ${proy}${falta}`);
  }
  const llegan = r.habilidades.filter((h) => h.proyectada.cumpleMeta).length;
  s.push(`  Llegan a la meta ${llegan} de ${r.habilidades.length}.`);

  s.push("");
  const m = r.misconcepciones;
  s.push(
    `Misconcepciones del alcance como trampa en ${TRAMPAS_POR_MISCONCEPCION} preguntas o más: ${m.conTrampaEn2oMas} de ${m.total} ` +
      `con borradores, ${m.conTrampaEn2oMasHoy} de ${m.total} solo con revisadas.`,
  );
  const faltan = m.lista.filter((x) => x.proyectada < TRAMPAS_POR_MISCONCEPCION);
  if (faltan.length > 0) {
    const vistas = faltan.slice(0, 12).map((x) => `${x.clave} (${x.proyectada})`).join(", ");
    s.push(`  Con menos de ${TRAMPAS_POR_MISCONCEPCION}: ${vistas}${faltan.length > 12 ? ` y ${faltan.length - 12} más` : ""}`);
  }

  s.push("");
  s.push("Evaluaciones (activa hoy = convertidor; proyectada = D-13 contando borradores):");
  for (const e of r.evaluaciones) {
    s.push(
      `  ${e.clave} · semana ${e.semana} · ${plural(e.habilidades, "habilidad", "habilidades")}: ` +
        `hoy ${e.activaHoy ? "activa" : "inactiva"}, proyectada ${e.activaProyectada ? "activa" : "inactiva"}, ` +
        `${e.habilidadesSinMeta} sin llegar a la meta de preguntas`,
    );
  }

  s.push("");
  s.push(r.sinMeta.length === 0 ? "Todas las habilidades del alcance llegan a la meta." : `Sin llegar a la meta (candidatas a contenido/FALTA-MATERIAL.md): ${r.sinMeta.join(", ")}`);
  return s.join("\n");
}

/** Lee los argumentos. Devuelve un texto si hay uno que no entiende. */
export function leerArgumentos(argv) {
  const a = { materia: null, evaluacion: null, temas: null, banco: BANCO_POR_DEFECTO, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    const valor = () => {
      const v = argv[i + 1];
      i += 1;
      return v;
    };
    if (x === "--json") a.json = true;
    else if (x === "--evaluacion" || x === "--temas" || x === "--banco") {
      const v = valor();
      if (!v || v.startsWith("--")) return `Falta el valor después de ${x}.`;
      if (x === "--evaluacion") a.evaluacion = v;
      else if (x === "--temas") a.temas = v.split(",").map((t) => t.trim()).filter(Boolean);
      else a.banco = resolve(v);
    } else if (x.startsWith("--")) return `No entiendo el argumento "${x}".`;
    else if (a.materia === null) a.materia = x;
    else return `Sobra el argumento "${x}".`;
  }
  if (a.materia === null) return "Falta la materia.";
  if (a.evaluacion && a.temas) return "Usa --evaluacion o --temas, no los dos.";
  return a;
}

/** Corre el script y devuelve el código de salida. */
export function principal(argv) {
  const a = leerArgumentos(argv);
  if (typeof a === "string") {
    console.error(`${a}\n${USO}`);
    return 1;
  }
  if (!existsSync(a.banco) || !statSync(a.banco).isDirectory()) {
    console.error(`No encuentro la carpeta del banco: ${a.banco}`);
    return 1;
  }
  const resultado = leerBanco(a.banco);
  if (resultado.errores.length > 0) {
    console.error(`El banco tiene ${resultado.errores.length} errores; corrige con npm run contenido:validar antes de calcular:`);
    for (const e of resultado.errores.slice(0, 10)) console.error(`  ${formatearDiagnostico(e)}`);
    return 1;
  }
  const materia = resultado.banco.materias.find((m) => m.carpeta === a.materia);
  if (!materia) {
    console.error(`No hay una materia "${a.materia}" en el banco. Hay: ${resultado.banco.materias.map((m) => m.carpeta).join(", ")}.`);
    return 1;
  }

  let alcance = null;
  let descripcion = "toda la materia";
  if (a.evaluacion) {
    const e = materia.evaluaciones.find((x) => x.clave === a.evaluacion);
    if (!e) {
      console.error(`No hay una evaluación "${a.evaluacion}" en ${a.materia}. Hay: ${materia.evaluaciones.map((x) => x.clave).join(", ")}.`);
      return 1;
    }
    alcance = materia.temas.filter((t) => e.temas.includes(t.clave)).flatMap((t) => t.habilidades.map((h) => h.clave));
    descripcion = `alcance: ${e.clave}`;
  } else if (a.temas) {
    const desconocidos = a.temas.filter((t) => !materia.temas.some((x) => x.clave === t));
    if (desconocidos.length > 0) {
      console.error(`No hay estos temas en ${a.materia}: ${desconocidos.join(", ")}.`);
      return 1;
    }
    alcance = materia.temas.filter((t) => a.temas.includes(t.clave)).flatMap((t) => t.habilidades.map((h) => h.clave));
    descripcion = `alcance: temas ${a.temas.join(", ")}`;
  }

  const reporte = analizar(materia, alcance);
  console.log(a.json ? JSON.stringify(reporte, null, 2) : formatear(reporte, descripcion));
  return reporte.sinMeta.length === 0 ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2));
}
