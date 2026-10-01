// Migración única del banco del prototipo (dvarela5101/Calibra, contenido/*.md, commit 87f71ed) al formato
// por habilidades de HU-005: contenido/<materia>/materia.md y un <tema>.md por subtema.
//
//   node scripts/contenido/migrar-prototipo.mts <contenido-del-prototipo> [--salida contenido] [--verificar]
//
// Se corre una vez; se versiona para que la migración sea reproducible y se pueda revisar.
//
// Sin --verificar: lee los .md del prototipo con su propio lector del formato viejo y, si hay algo que no
// entiende, no escribe nada. Si todo está bien, sobrescribe contenido/<materia>/ de cada materia (no toca
// otros archivos de contenido/) y verifica. Con --verificar solo verifica lo que ya está escrito.
//
// La verificación tiene dos partes: (1) el validador nuevo (banco.mts) no da errores sobre la salida, y
// (2) lo migrado dice lo mismo que lee el propio convertir.js del prototipo, cargado en un vm como oráculo.
// El oráculo es el parser original y no el de banco.mts a propósito: el lector de aquí reutiliza
// armarEnunciado y partirOpcion de banco.mts, y un error compartido no se vería si se comparara consigo mismo.
//
// Qué cambia al migrar (decisiones de HU-005 y de la dueña del producto, 30-sep-2026):
// - El frontmatter queda con codigo, nombre y libro. Se descartan id (es la carpeta), activa (la activación
//   vive en la evaluación) y longitud (el tope es de HU-060). contexto se vuelve la única evaluación.
// - Cálculo Integral conserva sus kc y mc. Una opción incorrecta queda "· [mc]" si su texto de error es
//   idéntico a la descripción de la mc, y "· [mc] <texto propio>" si no.
// - Las otras 7 materias no tienen kc: cada tema recibe la habilidad provisional "<clave-tema>" y cada texto
//   de error distinto dentro del tema se vuelve la misconcepción "<clave-tema>-e<n>".
// - Las preguntas que no eran borrador quedan revisadas por "prototipo" y de origen humano; los borradores
//   (todos los redactó el asistente de IA) quedan borrador de origen "ia (desconocido)", sin solución.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";
import { armarEnunciado, formatearDiagnostico, leerBanco, partirOpcion } from "./banco.mts";
import type { LineaNumerada } from "./banco.mts";
import type { ArchivoBanco, Banco, Letra, Materia, Tema } from "./modelo.mts";

// Semana del curso de la única evaluación de cada materia (RN-20, D-15). Sale del programa del curso más
// reciente que se encontró el 30-sep-2026. Cambia entre secciones y semestres: después de la migración se
// corrige en el materia.md con un PR, no aquí.
export const SEMANAS: Record<string, number> = {
  // Parcial 1. Programa 2026-2 (coordinación, prof. Winklmeier), cronograma, fila 6:
  // math.uniandes.edu.co/~mwinklme/teaching/LinAlg-202620/PROGRAMA_Algebra_Lineal_202620-Winklmeier.pdf
  "algebra-lineal": 6,
  // Parcial 1. Programa MATE-1203 de 2024-2, "Fechas importantes": "Parcial 1: (Semana 5)".
  "calculo-diferencial": 5,
  // Parcial 2. Programas 2025-20 de las secciones 5, A, F y G (la D lo pone en la 9):
  // math.uniandes.edu.co/aplicaciones/programas/2025-20/1214-5.pdf
  "calculo-integral": 8,
  // Parcial 1. Programas 2025-20: math.uniandes.edu.co/aplicaciones/programas/2025-20/1207.pdf
  "calculo-vectorial": 7,
  // Parcial 1. Programa FISI-1018 de 2020-1: wwwprof.uniandes.edu.co/~gtellez/fisica1/programa.pdf
  "fisica-1": 7,
  // Parcial 1. Programa público de Física 2 de 2022-2, que usa el código FISI-1028 (no FISI-1019):
  // quantummaterials.uniandes.edu.co/images/Courses/ProgF%C3%ADsica2-202220_PGG.pdf
  // Dudosa: en ese programa el parcial 1 es de termodinámica, que el banco no tiene; sus temas
  // (electrostática a magnetismo) caen en los parciales 2 a 4, semanas 8 a 16.
  "fisica-2": 5,
  // Examen escrito de nivel 2 (N2-EXAM). Sección 11, 2026-10 y 2025-20:
  // github.com/fedemelo/uniandes-profesor-ip, exams/config/n2-exam.toml
  "introduccion-programacion": 8,
  // Parcial 1. Programa IIND-2106 de 2020-10:
  // industrial.uniandes.edu.co/sites/default/files/IIND_2106_PROBABILIDAD_Y_ESTADISTICA_I_2020_10.pdf
  "probabilidad-estadistica": 7,
};

// El "contexto" del prototipo ("antes del parcial 1") dice para qué evaluación se prepara el estudiante.
const EVALUACIONES: Record<string, { clave: string; nombre: string }> = {
  "antes del parcial 1": { clave: "parcial-1", nombre: "Parcial 1" },
  "antes del parcial 2": { clave: "parcial-2", nombre: "Parcial 2" },
  "antes del examen escrito de nivel 2": { clave: "examen-nivel-2", nombre: "Examen escrito de nivel 2" },
};

// Totales del prototipo en 87f71ed (convertir.js --borradores y el informe de lectura de HU-005). Si no
// cuadran, el prototipo no es el que se revisó.
export const TOTALES_PROTOTIPO: Totales = {
  materias: 8,
  temas: 35,
  habilidades: 47,
  misconcepciones: 307,
  preguntas: 135,
  borradores: 39,
  opciones: 540,
};

const USO = "Uso: node scripts/contenido/migrar-prototipo.mts <contenido-del-prototipo> [--salida contenido] [--verificar]";
const SALIDA_POR_DEFECTO = join(import.meta.dirname, "..", "..", "contenido");
// Los archivos de contenido/ del prototipo que no son materias (convertir.js:28).
const IGNORAR = ["README.md", "plantilla-materia.md"];
const CLAVES_FRONTMATTER = ["id", "codigo", "nombre", "libro", "contexto", "activa", "longitud"];
const CARPETA = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Las expresiones del formato viejo son las de convertir.js (líneas 256, 276-277, 294 y 335).
const RE_SUBTEMA = /^##\s+([a-z0-9_-]+)\s*[·|-]\s*(.+)$/;
const RE_PREGUNTA = /^###\s+([A-Za-z0-9_-]+)\s*[·|-]\s*dificultad\s*([123])\s*(.*)$/;
const RE_KC = /^kc:\s*([a-z0-9_-]+)\s*·\s*(.+)$/;
const RE_MC = /^mc:\s*([a-z0-9_-]+)\s*·\s*([a-z0-9_-]+)\s*·\s*(.+)$/;
const RE_OPCION = /^\s*-\s*([A-D])\)\s*(.*)$/;
// Una cerca sin cerrar la corta el siguiente encabezado de pregunta o de subtema (convertir.js:225).
const RE_CORTA_CERCA = [/^###\s+[A-Za-z0-9_-]+\s*[·|-]\s*dificultad/, /^##\s+[a-z0-9_-]+\s*·\s*\S/];
// La marca donde empieza el programa principal de convertir.js: el oráculo carga solo lo de antes.
const MARCA_PROGRAMA = "/* ---------- Programa ---------- */";

export interface Totales {
  materias: number;
  temas: number;
  habilidades: number;
  misconcepciones: number;
  preguntas: number;
  borradores: number;
  opciones: number;
}

// ---------------------------------------------------------------------------------------------------
// Lector del formato viejo
// ---------------------------------------------------------------------------------------------------

export interface OpcionVieja {
  letra: Letra;
  texto: string;
  correcta: boolean;
  /** El texto del error, sin la etiqueta [mc]. Vacío en la correcta. */
  error: string;
  mc: string | null;
}

export interface PreguntaVieja {
  id: string;
  dificultad: number;
  kcs: string[];
  borrador: boolean;
  /** Las líneas del enunciado tal como están en el archivo (prosa y cercas), sin las líneas en blanco de los bordes. */
  enunciado: string[];
  opciones: OpcionVieja[];
  linea: number;
}

export interface SubtemaViejo {
  clave: string;
  nombre: string;
  /** El párrafo libre entre "## clave · Nombre" y la primera pregunta. */
  parrafo: string[];
  kcs: { clave: string; nombre: string }[];
  mcs: { clave: string; kc: string; texto: string }[];
  preguntas: PreguntaVieja[];
}

export interface MateriaVieja {
  archivo: string;
  id: string;
  codigo: string;
  nombre: string;
  libro: string | null;
  contexto: string;
  /** El texto libre entre el frontmatter y el primer subtema. */
  introduccion: string[];
  subtemas: SubtemaViejo[];
}

function sinBordesEnBlanco(lineas: string[]): string[] {
  let desde = 0;
  let hasta = lineas.length;
  while (desde < hasta && !lineas[desde].trim()) desde += 1;
  while (hasta > desde && !lineas[hasta - 1].trim()) hasta -= 1;
  return lineas.slice(desde, hasta);
}

/**
 * Lee un .md de materia del prototipo. Es más estricto que convertir.js: una línea que el prototipo
 * ignoraba en silencio (texto después de las opciones, una clave desconocida en el frontmatter) aquí es
 * un error, para que la migración no pierda nada sin avisar.
 */
export function leerPrototipo(archivo: string, texto: string): { materia: MateriaVieja; errores: string[] } {
  const errores: string[] = [];
  const error = (linea: number, mensaje: string) => errores.push(`${archivo}:${linea}  ${mensaje}`);
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const datos = new Map<string, string>();

  let i = 0;
  if (lineas[0].trim() !== "---") error(1, 'el archivo debe empezar con una línea "---"');
  else {
    for (i = 1; i < lineas.length && lineas[i].trim() !== "---"; i += 1) {
      const m = /^([a-zA-Z_]+):\s*(.*)$/.exec(lineas[i]);
      if (!m) {
        if (lineas[i].trim()) error(i + 1, 'línea del frontmatter que no entiendo: debe ser "clave: valor"');
      } else if (!CLAVES_FRONTMATTER.includes(m[1])) {
        error(i + 1, `clave "${m[1]}" desconocida en el frontmatter: la migración no sabría dónde ponerla`);
      } else datos.set(m[1], m[2].trim());
    }
    if (i >= lineas.length) error(1, 'no encontré el "---" que cierra el frontmatter');
    i += 1;
  }
  for (const campo of ["id", "codigo", "nombre", "contexto"]) {
    if (!datos.get(campo)) error(1, `falta "${campo}" en el frontmatter`);
  }
  const id = datos.get("id") ?? "";
  // El id es el nombre de la carpeta que se sobrescribe: nada de "..", barras ni mayúsculas.
  if (id && !CARPETA.test(id)) error(1, `el id "${id}" no sirve como carpeta: minúsculas y dígitos separados por guiones`);

  const materia: MateriaVieja = {
    archivo,
    id,
    codigo: datos.get("codigo") ?? "",
    nombre: datos.get("nombre") ?? "",
    libro: datos.get("libro") || null,
    contexto: datos.get("contexto") ?? "",
    introduccion: [],
    subtemas: [],
  };

  let subtema: SubtemaViejo | null = null;
  // La pregunta que se está leyendo: su encabezado y sus líneas hasta el siguiente "###" o "##".
  let bloque: LineaNumerada[] | null = null;
  let enCerca = false;
  const cerrarPregunta = () => {
    if (bloque && subtema) subtema.preguntas.push(leerPreguntaVieja(bloque, error));
    bloque = null;
    enCerca = false;
  };

  for (; i < lineas.length; i += 1) {
    const l = lineas[i];
    const n = i + 1;
    // Dentro de una cerca todo es código, salvo un encabezado que la corta porque quedó sin cerrar (lo
    // reporta armarEnunciado).
    if (bloque && enCerca) {
      if (RE_CORTA_CERCA.some((re) => re.test(l))) cerrarPregunta();
      else {
        if (l.trimEnd() === "```") enCerca = false;
        bloque.push({ texto: l, numero: n });
        continue;
      }
    }
    const mSub = RE_SUBTEMA.exec(l);
    if (mSub) {
      cerrarPregunta();
      subtema = { clave: mSub[1], nombre: mSub[2].trim(), parrafo: [], kcs: [], mcs: [], preguntas: [] };
      materia.subtemas.push(subtema);
      continue;
    }
    if (/^##\s/.test(l)) {
      error(n, 'encabezado de subtema mal formado. Debe ser "## clave · Nombre visible"');
      continue;
    }
    if (RE_PREGUNTA.test(l)) {
      cerrarPregunta();
      if (!subtema) error(n, "la pregunta no está dentro de ningún subtema");
      else bloque = [{ texto: l, numero: n }];
      continue;
    }
    if (/^###\s/.test(l)) {
      cerrarPregunta();
      error(n, 'encabezado de pregunta mal formado. Debe ser "### P1 · dificultad 2"');
      continue;
    }
    if (bloque) {
      if (/^```/.test(l)) enCerca = true;
      bloque.push({ texto: l, numero: n });
      continue;
    }
    if (!subtema) {
      materia.introduccion.push(l);
      continue;
    }
    if (/^(kc|mc):/.test(l)) {
      const mKc = RE_KC.exec(l);
      const mMc = RE_MC.exec(l);
      if (mKc) subtema.kcs.push({ clave: mKc[1], nombre: mKc[2].trim() });
      else if (mMc) subtema.mcs.push({ clave: mMc[1], kc: mMc[2], texto: mMc[3].trim() });
      else error(n, 'línea mal formada. Debe ser "kc: clave · Nombre" o "mc: clave · kc · texto del error"');
      continue;
    }
    // Antes de la primera pregunta del subtema: su párrafo libre.
    subtema.parrafo.push(l);
  }
  cerrarPregunta();
  if (materia.subtemas.length === 0) error(1, 'la materia no tiene subtemas ("## clave · Nombre")');
  materia.introduccion = sinBordesEnBlanco(materia.introduccion);
  for (const s of materia.subtemas) s.parrafo = sinBordesEnBlanco(s.parrafo);
  return { materia, errores };
}

function leerPreguntaVieja(bloque: LineaNumerada[], error: (linea: number, mensaje: string) => void): PreguntaVieja {
  const cabeza = bloque[0];
  const m = RE_PREGUNTA.exec(cabeza.texto) as RegExpExecArray;
  const pregunta: PreguntaVieja = {
    id: m[1],
    dificultad: Number(m[2]),
    kcs: [],
    borrador: false,
    enunciado: [],
    opciones: [],
    linea: cabeza.numero,
  };
  // "· kc: a, b" y "· borrador", como convertir.js:305-314.
  const resto = m[3].trim();
  if (resto) {
    if (!/^·/.test(resto)) error(cabeza.numero, 'encabezado de pregunta mal formado. Debe ser "### P1 · dificultad 2 · kc: clave"');
    for (const segmento of resto.replace(/^·\s*/, "").split(/\s*·\s*/)) {
      const mK = /^kc:\s*([a-z0-9_,\s-]+)$/.exec(segmento);
      if (mK) pregunta.kcs = mK[1].split(",").map((s) => s.trim()).filter(Boolean);
      else if (segmento === "borrador") pregunta.borrador = true;
      else error(cabeza.numero, `no entiendo "${segmento}" en el encabezado de ${pregunta.id}`);
    }
  }

  const cuerpo = bloque.slice(1);
  const enunciado = armarEnunciado(cuerpo, pregunta.id);
  for (const p of enunciado.problemas) error(p.linea, p.mensaje);
  if (!enunciado.texto) error(cabeza.numero, `la pregunta ${pregunta.id} no tiene enunciado`);
  pregunta.enunciado = sinBordesEnBlanco(cuerpo.slice(0, enunciado.usadas).map((l) => l.texto));

  for (const { texto, numero } of cuerpo.slice(enunciado.usadas)) {
    if (!texto.trim()) continue;
    const mo = RE_OPCION.exec(texto);
    if (!mo) {
      // convertir.js ignoraba en silencio el texto después de las opciones; aquí se perdería.
      error(numero, `línea inesperada después de las opciones de ${pregunta.id}`);
      continue;
    }
    const letra = mo[1] as Letra;
    const { texto: textoOpcion, cola } = partirOpcion(mo[2]);
    if (!textoOpcion) error(numero, `la opción ${letra} de ${pregunta.id} no tiene texto`);
    if (/^CORRECTA$/i.test(cola)) {
      pregunta.opciones.push({ letra, texto: textoOpcion, correcta: true, error: "", mc: null });
      continue;
    }
    const mEt = /^\[([a-z0-9_-]+)\]\s*(.*)$/.exec(cola);
    const textoError = mEt ? mEt[2] : cola;
    if (!textoError) error(numero, `la opción ${letra} de ${pregunta.id} no dice qué error conceptual delata`);
    pregunta.opciones.push({ letra, texto: textoOpcion, correcta: false, error: textoError, mc: mEt ? mEt[1] : null });
  }
  if (pregunta.opciones.map((o) => o.letra).join("") !== "ABCD") {
    error(cabeza.numero, `la pregunta ${pregunta.id} debe tener 4 opciones, A, B, C y D, en ese orden`);
  }
  const correctas = pregunta.opciones.filter((o) => o.correcta).length;
  if (correctas !== 1) error(cabeza.numero, `la pregunta ${pregunta.id} tiene ${correctas} opciones marcadas CORRECTA`);
  return pregunta;
}

// ---------------------------------------------------------------------------------------------------
// Escritura del formato nuevo
// ---------------------------------------------------------------------------------------------------

/** Una materia "usa kc" si declara alguno, como en convertir.js:404. Hoy solo Cálculo Integral. */
function usaKc(materia: MateriaVieja): boolean {
  return materia.subtemas.some((s) => s.kcs.length > 0);
}

/** El texto de un archivo con esas líneas: LF y salto de línea final. */
function textoDeArchivo(lineas: string[]): string {
  return `${lineas.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Los archivos nuevos de una materia del prototipo (rutas relativas a contenido/). No toca el disco.
 * `semanas` es SEMANAS; las pruebas pasan las suyas.
 */
export function migrarMateria(
  vieja: MateriaVieja,
  semanas: Record<string, number> = SEMANAS,
): { archivos: ArchivoBanco[]; errores: string[] } {
  const errores: string[] = [];
  const error = (linea: number, mensaje: string) => errores.push(`${vieja.archivo}:${linea}  ${mensaje}`);
  const conKc = usaKc(vieja);

  const evaluacion = EVALUACIONES[vieja.contexto] as { clave: string; nombre: string } | undefined;
  if (!evaluacion) {
    error(1, `no sé a qué evaluación corresponde el contexto "${vieja.contexto}": agrégalo a EVALUACIONES en migrar-prototipo.mts`);
  }
  const semana: number | undefined = semanas[vieja.id];
  if (!semana) error(1, `falta la semana de "${vieja.id}" en SEMANAS (migrar-prototipo.mts)`);

  const materiaMd = ["---", `codigo: ${vieja.codigo}`, `nombre: ${vieja.nombre}`];
  if (vieja.libro) materiaMd.push(`libro: ${vieja.libro}`);
  materiaMd.push("---", "");
  if (vieja.introduccion.length > 0) materiaMd.push(...vieja.introduccion, "");
  materiaMd.push("## Temas", ...vieja.subtemas.map((s) => `- ${s.clave}`), "", "## Evaluaciones", "");
  materiaMd.push(`### ${evaluacion?.clave} · ${evaluacion?.nombre} · semana ${semana}`);
  materiaMd.push(`temas: ${vieja.subtemas.map((s) => s.clave).join(", ")}`);
  const archivos: ArchivoBanco[] = [{ ruta: `${vieja.id}/materia.md`, texto: textoDeArchivo(materiaMd) }];

  // En Cálculo Integral, la descripción de cada mc decide si la opción lleva texto propio.
  const descripcionMc = new Map(vieja.subtemas.flatMap((s) => s.mcs.map((mc) => [mc.clave, mc.texto] as const)));

  for (const subtema of vieja.subtemas) {
    const habilidades = conKc ? subtema.kcs.map((kc) => `kc: ${kc.clave} · ${kc.nombre}`) : [`kc: ${subtema.clave} · ${subtema.nombre}`];
    const lineasMc: string[] = conKc ? subtema.mcs.map((mc) => `mc: ${mc.clave} · ${mc.kc} · ${mc.texto}`) : [];
    // Sin kc: cada texto de error distinto del tema es una misconcepción, numerada por su primera aparición.
    const provisionales = new Map<string, string>();
    const preguntas: string[] = [];
    for (const p of subtema.preguntas) {
      if (conKc && p.kcs.length === 0) error(p.linea, `la pregunta ${p.id} no dice qué kc mide`);
      if (!conKc && (p.kcs.length > 0 || p.opciones.some((o) => o.mc))) {
        error(p.linea, `la pregunta ${p.id} usa kc o [mc] pero la materia no declara ningún "kc:"`);
      }
      const kcs = conKc ? p.kcs : [subtema.clave];
      const estado = p.borrador ? "borrador · origen: ia (desconocido)" : "revisada · origen: humano · revisó: prototipo";
      preguntas.push(`### ${p.id} · dificultad ${p.dificultad} · kc: ${kcs.join(", ")} · ${estado}`, ...p.enunciado, "");
      for (const o of p.opciones) {
        if (o.correcta) {
          preguntas.push(`- ${o.letra}) ${o.texto} · CORRECTA`);
          continue;
        }
        let etiqueta: string;
        if (conKc) {
          const descripcion = o.mc ? descripcionMc.get(o.mc) : undefined;
          if (!o.mc || descripcion === undefined) {
            error(p.linea, `la opción ${o.letra} de ${p.id} no tiene una [mc] declarada`);
            etiqueta = `[${o.mc ?? ""}]`;
          } else etiqueta = o.error === descripcion ? `[${o.mc}]` : `[${o.mc}] ${o.error}`;
        } else {
          let clave = provisionales.get(o.error);
          if (!clave) {
            clave = `${subtema.clave}-e${provisionales.size + 1}`;
            provisionales.set(o.error, clave);
            lineasMc.push(`mc: ${clave} · ${subtema.clave} · ${o.error}`);
          }
          etiqueta = `[${clave}]`;
        }
        preguntas.push(`- ${o.letra}) ${o.texto} · ${etiqueta}`);
      }
      preguntas.push("");
    }

    const tema = [`# ${subtema.nombre}`, ""];
    if (subtema.parrafo.length > 0) tema.push(...subtema.parrafo, "");
    tema.push("## Habilidades", ...habilidades, "", "## Errores", ...lineasMc, "", "## Preguntas", "", ...preguntas);
    archivos.push({ ruta: `${vieja.id}/${subtema.clave}.md`, texto: textoDeArchivo(tema) });
  }
  return { archivos, errores };
}

// ---------------------------------------------------------------------------------------------------
// Verificación contra el oráculo (convertir.js del prototipo)
// ---------------------------------------------------------------------------------------------------

/** Lo que devuelve leerMateria de convertir.js (con --borradores), en lo que importa aquí. */
export interface MateriaOraculo {
  id: string;
  codigo: string;
  nombre: string;
  libro: string;
  contexto: string;
  subtemas: Record<string, string>;
  kcs: Record<string, { subtema: string; nombre: string }>;
  misconcepciones: Record<string, { kc: string; texto: string }>;
  preguntas: {
    /** En minúsculas ("p1"). */
    id: string;
    subtema: string;
    dificultad: number;
    kcs: string[];
    borrador: boolean;
    enunciado: string;
    opciones: { letra: string; texto: string; correcta: boolean; error: string; mc: string }[];
  }[];
}

/**
 * Carga convertir.js del prototipo en un vm, sin su programa principal (todo lo que está después de la
 * marca "Programa"), y lee con su leerMateria cada .md de materia con --borradores. Devuelve también los
 * errores que el propio convertir.js encontró.
 */
export function cargarOraculo(dirPrototipo: string): { materias: MateriaOraculo[]; errores: string[] } {
  const ruta = join(dirPrototipo, "convertir.js");
  const fuente = readFileSync(ruta, "utf8");
  const corte = fuente.indexOf(MARCA_PROGRAMA);
  if (corte === -1) throw new Error(`no encontré "${MARCA_PROGRAMA}" en ${ruta}: ¿es otra versión de convertir.js?`);
  const contexto = vm.createContext({
    require: createRequire(ruta),
    __dirname: dirPrototipo,
    // INCLUIR_BORRADORES se lee de process.argv al cargar (convertir.js:29).
    process: { argv: ["node", ruta, "--borradores"] },
    console,
  });
  vm.runInContext(fuente.slice(0, corte), contexto, { filename: ruta });
  // Las declaraciones const del script viven en el ámbito global del contexto, no como propiedades.
  const ignorar = vm.runInContext("IGNORAR", contexto) as string[];
  const leerMateria = contexto.leerMateria as (archivo: string) => MateriaOraculo;
  const archivos = readdirSync(dirPrototipo)
    .filter((f) => f.endsWith(".md") && !ignorar.includes(f))
    .sort();
  const materias = archivos.map((a) => leerMateria(a));
  const errores = vm.runInContext("errores", contexto) as string[];
  return { materias, errores: [...errores] };
}

const json = (x: unknown) => JSON.stringify(x);

/**
 * Compara lo migrado (ya leído por banco.mts) con lo que leyó el oráculo. Devuelve las diferencias (vacío si
 * no hay) y los totales del oráculo. Solo mira las materias del oráculo.
 */
export function compararConOraculo(
  oraculo: MateriaOraculo[],
  banco: Banco,
  semanas: Record<string, number> = SEMANAS,
): { diferencias: string[]; totales: Totales } {
  const diferencias: string[] = [];
  const totales: Totales = { materias: 0, temas: 0, habilidades: 0, misconcepciones: 0, preguntas: 0, borradores: 0, opciones: 0 };
  const igual = (donde: string, campo: string, migrado: unknown, prototipo: unknown) => {
    if (json(migrado) !== json(prototipo)) diferencias.push(`${donde}: ${campo} no coincide\n      migrado:   ${json(migrado)}\n      prototipo: ${json(prototipo)}`);
  };

  for (const om of oraculo) {
    totales.materias += 1;
    const subtemas = Object.keys(om.subtemas);
    const conKc = Object.keys(om.kcs).length > 0;
    totales.temas += subtemas.length;
    totales.preguntas += om.preguntas.length;
    totales.borradores += om.preguntas.filter((p) => p.borrador).length;
    totales.opciones += om.preguntas.reduce((n, p) => n + p.opciones.length, 0);
    totales.habilidades += conKc ? Object.keys(om.kcs).length : subtemas.length;
    totales.misconcepciones += conKc
      ? Object.keys(om.misconcepciones).length
      : subtemas.reduce((n, s) => n + erroresDe(om, s).length, 0);

    const materia = banco.materias.find((m) => m.carpeta === om.id);
    if (!materia) {
      diferencias.push(`${om.id}: la materia no está en la salida`);
      continue;
    }
    const enMateria = `${om.id}/materia.md`;
    igual(enMateria, "el código", materia.codigo, om.codigo);
    igual(enMateria, "el nombre", materia.nombre, om.nombre);
    igual(enMateria, "el libro", materia.libro, om.libro || null);
    igual(enMateria, "los temas", materia.temas.map((t) => t.clave), subtemas);

    const evaluacion = EVALUACIONES[om.contexto] as { clave: string; nombre: string } | undefined;
    igual(
      enMateria,
      "la evaluación",
      materia.evaluaciones.map((e) => ({ clave: e.clave, nombre: e.nombre, semana: e.semana, acumulativa: e.acumulativa, temas: e.temas })),
      [{ clave: evaluacion?.clave, nombre: evaluacion?.nombre, semana: semanas[om.id], acumulativa: false, temas: subtemas }],
    );

    const temaDe = new Map<string, Tema>(materia.temas.map((t) => [t.clave, t]));
    for (const clave of subtemas) {
      const tema = temaDe.get(clave);
      if (!tema) continue; // ya salió en "los temas"
      const enTema = `${om.id}/${clave}.md`;
      igual(enTema, "el nombre del tema", tema.nombre, om.subtemas[clave]);
      igual(enTema, "los prerrequisitos", tema.habilidades.flatMap((h) => h.prerrequisitos), []);
      if (conKc) {
        const kcs = Object.entries(om.kcs).filter(([, kc]) => kc.subtema === clave);
        igual(enTema, "las habilidades", tema.habilidades.map((h) => [h.clave, h.descripcion]), kcs.map(([k, kc]) => [k, kc.nombre]));
      } else {
        igual(enTema, "las habilidades", tema.habilidades.map((h) => [h.clave, h.descripcion]), [[clave, om.subtemas[clave]]]);
        // Una misconcepción por texto de error distinto del tema, de su única habilidad. El oráculo tiene las
        // preguntas ordenadas por id y no en el orden del archivo, así que se comparan ordenadas.
        const mcs = tema.misconcepciones;
        igual(enTema, "los errores", mcs.map((mc) => mc.descripcion).sort(), erroresDe(om, clave).sort());
        igual(enTema, "las claves de los errores", mcs.map((mc) => [mc.clave, mc.habilidad]), mcs.map((_, k) => [`${clave}-e${k + 1}`, clave]));
      }
    }
    if (conKc) {
      // La mc no dice en qué subtema estaba: se compara la lista de toda la materia, en el orden del archivo.
      const mcs = materia.temas.flatMap((t) => t.misconcepciones).map((mc) => [mc.clave, mc.habilidad, mc.descripcion]);
      igual(enMateria, "las misconcepciones", mcs, Object.entries(om.misconcepciones).map(([k, mc]) => [k, mc.kc, mc.texto]));
    }

    compararPreguntas(om, materia, conKc, diferencias, igual);
  }
  return { diferencias, totales };
}

/** Los textos de error distintos de las preguntas de un subtema del oráculo. */
function erroresDe(om: MateriaOraculo, subtema: string): string[] {
  return [...new Set(om.preguntas.filter((p) => p.subtema === subtema).flatMap((p) => p.opciones.filter((o) => !o.correcta).map((o) => o.error)))];
}

function compararPreguntas(
  om: MateriaOraculo,
  materia: Materia,
  conKc: boolean,
  diferencias: string[],
  igual: (donde: string, campo: string, migrado: unknown, prototipo: unknown) => void,
) {
  const migradas = new Map(materia.temas.flatMap((t) => t.preguntas.map((p) => [p.clave.toLowerCase(), { pregunta: p, tema: t }] as const)));
  const descripcion = new Map(materia.temas.flatMap((t) => t.misconcepciones.map((mc) => [mc.clave, mc.descripcion] as const)));
  for (const op of om.preguntas) {
    const encontrada = migradas.get(op.id);
    if (!encontrada) {
      diferencias.push(`${om.id}: la pregunta ${op.id} del prototipo no está en la salida`);
      continue;
    }
    migradas.delete(op.id);
    const { pregunta: p, tema } = encontrada;
    const donde = `${p.lugar.archivo}:${p.lugar.linea} ${p.clave}`;
    igual(donde, "el tema", tema.clave, op.subtema);
    igual(donde, "la dificultad", p.dificultad, op.dificultad);
    igual(
      donde,
      "el estado",
      [p.estado, p.origen, p.revisor, p.solucion, p.porRevisar],
      op.borrador ? ["borrador", "ia (desconocido)", null, null, false] : ["revisada", "humano", "prototipo", null, false],
    );
    igual(donde, "las habilidades", p.habilidades, conKc ? op.kcs : [op.subtema]);
    igual(donde, "el enunciado", p.enunciado, op.enunciado);
    igual(donde, "el número de opciones", p.opciones.length, op.opciones.length);
    p.opciones.forEach((o, k) => {
      const oo = op.opciones[k];
      if (!oo) return;
      // El error efectivo de una opción es su texto propio o, si no tiene, la descripción de su misconcepción.
      const efectivo = o.correcta ? "" : (o.error ?? (o.misconcepcion ? descripcion.get(o.misconcepcion) : undefined));
      const migrada: unknown[] = [o.letra, o.texto, o.correcta, efectivo];
      const prototipo: unknown[] = [oo.letra, oo.texto, oo.correcta, oo.error];
      if (conKc) {
        migrada.push(o.misconcepcion ?? "");
        prototipo.push(oo.mc);
      } else if (!o.correcta) {
        // Sin kc la opción queda "· [<tema>-e<n>]", sin texto propio.
        migrada.push(o.error);
        prototipo.push(null);
      }
      igual(donde, `la opción ${o.letra} (letra, texto, correcta, error${conKc ? ", mc" : ""})`, migrada, prototipo);
    });
  }
  for (const clave of migradas.keys()) diferencias.push(`${om.id}: la pregunta ${clave} de la salida no está en el prototipo`);
}

/** Corre las dos verificaciones e imprime el resumen. Devuelve si todo cuadra. */
export function verificar(dirPrototipo: string, salida: string, esperados: Totales | null = TOTALES_PROTOTIPO): boolean {
  let bien = true;
  console.log("\nVerificación:");

  const resultado = leerBanco(salida);
  console.log(`  Validador (banco.mts) sobre ${salida}: ${resultado.errores.length} errores, ${resultado.avisos.length} avisos (npm run contenido:validar los lista).`);
  for (const e of resultado.errores) console.log(`    ${formatearDiagnostico(e)}`);
  if (resultado.errores.length > 0) bien = false;

  let oraculo: ReturnType<typeof cargarOraculo>;
  try {
    oraculo = cargarOraculo(dirPrototipo);
  } catch (e) {
    console.log(`  ✗ no pude cargar convertir.js del prototipo: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  if (oraculo.errores.length > 0) {
    bien = false;
    console.log(`  ✗ convertir.js encuentra ${oraculo.errores.length} errores en el prototipo:`);
    for (const e of oraculo.errores) console.log(`    ${e}`);
  }
  const { diferencias, totales } = compararConOraculo(oraculo.materias, resultado.banco);
  if (esperados) {
    for (const campo of Object.keys(esperados) as (keyof Totales)[]) {
      if (totales[campo] !== esperados[campo]) {
        diferencias.push(`total de ${campo}: el prototipo tiene ${totales[campo]} y se esperaban ${esperados[campo]} (¿es otra versión del prototipo?)`);
      }
    }
  }
  const t = totales;
  console.log(
    `  Oráculo (convertir.js del prototipo, con --borradores): ${t.materias} materias, ${t.temas} temas, ${t.habilidades} habilidades, ` +
      `${t.misconcepciones} misconcepciones, ${t.preguntas} preguntas (${t.borradores} borradores), ${t.opciones} opciones; ` +
      `${diferencias.length} diferencias.`,
  );
  for (const d of diferencias) console.log(`    ${d}`);
  if (diferencias.length > 0) bien = false;

  console.log(bien ? "✓ La migración cuadra con el prototipo." : "✗ La migración NO cuadra con el prototipo.");
  return bien;
}

// ---------------------------------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------------------------------

export interface Argumentos {
  prototipo: string;
  salida: string;
  soloVerificar: boolean;
}

/** Lee los argumentos. Devuelve un texto si falta o sobra alguno. */
export function leerArgumentos(argv: string[]): Argumentos | string {
  let prototipo: string | null = null;
  let salida = SALIDA_POR_DEFECTO;
  let soloVerificar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === "--verificar") soloVerificar = true;
    else if (argumento === "--salida") {
      const ruta = argv[i + 1];
      if (!ruta || ruta.startsWith("--")) return "Falta la ruta después de --salida.";
      salida = resolve(ruta);
      i += 1;
    } else if (argumento.startsWith("--") || prototipo !== null) return `No entiendo el argumento "${argumento}".`;
    else prototipo = resolve(argumento);
  }
  if (prototipo === null) return "Falta la carpeta contenido/ del prototipo.";
  return { prototipo, salida, soloVerificar };
}

/** Corre la migración (o solo la verificación) y devuelve el código de salida. */
export function principal(argv: string[]): number {
  const argumentos = leerArgumentos(argv);
  if (typeof argumentos === "string") {
    console.error(`${argumentos}\n${USO}`);
    return 1;
  }
  const { prototipo, salida, soloVerificar } = argumentos;
  if (!statSync(prototipo, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`No encuentro la carpeta del prototipo: ${prototipo}`);
    return 1;
  }

  if (!soloVerificar) {
    const archivos = readdirSync(prototipo)
      .filter((f) => f.endsWith(".md") && !IGNORAR.includes(f))
      .sort();
    const errores: string[] = [];
    const nuevos: { carpeta: string; archivos: ArchivoBanco[]; preguntas: number }[] = [];
    for (const nombre of archivos) {
      const leida = leerPrototipo(nombre, readFileSync(join(prototipo, nombre), "utf8"));
      const migrada = migrarMateria(leida.materia);
      errores.push(...leida.errores, ...migrada.errores);
      const preguntas = leida.materia.subtemas.reduce((n, s) => n + s.preguntas.length, 0);
      nuevos.push({ carpeta: leida.materia.id, archivos: migrada.archivos, preguntas });
    }
    console.log(`Prototipo: ${prototipo} (${archivos.length} materias)`);
    if (errores.length > 0) {
      console.error(`\n✗ ${errores.length} errores en el prototipo; no se escribió nada:`);
      for (const e of errores) console.error(e);
      return 1;
    }
    for (const { carpeta, archivos: suyos, preguntas } of nuevos) {
      // Se sobrescribe la carpeta entera de la materia: un tema que ya no existe no debe quedar suelto.
      rmSync(join(salida, carpeta), { recursive: true, force: true });
      for (const a of suyos) {
        const destino = join(salida, a.ruta);
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, a.texto, "utf8");
      }
      console.log(`✓ escrita ${join(salida, carpeta)} (${suyos.length - 1} temas, ${preguntas} preguntas)`);
    }
  }

  if (!statSync(salida, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`No encuentro la carpeta de salida: ${salida}`);
    return 1;
  }
  return verificar(prototipo, salida) ? 0 : 1;
}

// Solo cuando se corre como programa, no cuando lo importa una prueba (ver convertir.mts).
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exitCode = principal(process.argv.slice(2));
