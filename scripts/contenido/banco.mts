// Lector y validador del banco de preguntas por habilidades (HU-005), con la cobertura, los conteos y el
// reporte que imprime convertir.mts. El formato está en docs/diseno/2026-09-29-banco-por-habilidades.md.
//
// El banco es markdown leído línea por línea, sin librería de markdown: "_" y "^" dentro de $…$ se leerían
// como énfasis. Los archivos pueden venir con CRLF (Windows, autocrlf) o LF (CI) y con BOM, así que se
// parte con /\r?\n/ y se quita el BOM.
//
// El armado del enunciado (cercas incluidas), la partición de las opciones y la revisión de la matemática
// son los de contenido/convertir.js del prototipo, portados sin cambiar su comportamiento: así los
// enunciados y opciones migrados quedan idénticos a los que el prototipo le mostraba al estudiante.
//
// analizarBanco no toca el disco (las pruebas le pasan textos en línea); leerBanco lee la carpeta.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { revisarMate, tramosMate } from "./matematica.mts";
import type {
  ArchivoBanco,
  Banco,
  Cobertura,
  Conteos,
  Diagnostico,
  EstadoPregunta,
  Evaluacion,
  Habilidad,
  Letra,
  Materia,
  Misconcepcion,
  Opcion,
  OpcionesCarga,
  Pregunta,
  ReferenciaHabilidad,
  ResultadoBanco,
  Tema,
} from "./modelo.mts";

const CLAVE = /^[a-z0-9][a-z0-9_-]*$/;
const CLAVE_PREGUNTA = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CARPETA = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CODIGO = /^[A-Z]{4}-\d{4}$/;
const PRERREQUISITO = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*)\/)?([a-z0-9][a-z0-9_-]*)$/;
/** Separa los campos de encabezados y de líneas kc:/mc:. El "·" pegado (x·y) es multiplicación. */
const SEPARADOR = " · ";
// Línea de opción, como en el prototipo (convertir.js:335).
const RE_OPCION = /^\s*-\s*([A-D])\)\s*(.*)$/;
// "### ": abre una pregunta en un tema y una evaluación en materia.md, aunque esté mal formado.
const RE_ENCABEZADO = /^###(\s|$)/;
// En "## Preguntas", cualquier línea que parezca un encabezado ("###P2", " ### P2", "#### P2") abre un bloque
// nuevo y leerEncabezado la rechaza. Si no, quedaría pegada a la solución de la pregunta anterior y la
// pregunta se perdería sin error.
const RE_ENCABEZADO_LAXO = /^\s{0,3}#{3,}/;
// Un encabezado de pregunta de verdad corta una cerca que quedó sin cerrar (convertir.js:225), en vez de
// tragarse el resto del archivo.
const RE_PREGUNTA_EN_CERCA = /^###\s+[A-Za-z0-9_-]+\s*·\s*dificultad/;
const RE_SECCION = /^##(\s|$)/;
const MINIMO_REVISADAS = 3;
const MINIMO_DIFICULTADES = 2;
const MINIMO_PREGUNTAS_MISCONCEPCION = 2;

/** Una línea con su número en el archivo (desde 1). */
export interface LineaNumerada {
  texto: string;
  numero: number;
}

type Anotar = (archivo: string, linea: number, mensaje: string) => void;
interface Diag {
  error: Anotar;
  aviso: Anotar;
}

function lineasDe(texto: string): string[] {
  return texto.replace(/^﻿/, "").split(/\r?\n/);
}

/** Texto libre (introducciones): sin líneas en blanco al principio ni al final, cada línea con trimEnd. */
function textoLibre(lineas: string[]): string {
  const recortadas = lineas.map((l) => l.trimEnd());
  while (recortadas.length > 0 && !recortadas[0]) recortadas.shift();
  while (recortadas.length > 0 && !recortadas[recortadas.length - 1]) recortadas.pop();
  return recortadas.join("\n");
}

function validarMate(diag: Diag, archivo: string, linea: number, campo: string, texto: string) {
  for (const problema of revisarMate(texto)) diag.error(archivo, linea, `${campo} ${problema}`);
}

const donde = (lugar: { archivo: string; linea: number }) => `${lugar.archivo}:${lugar.linea}`;

// ---------------------------------------------------------------------------------------------------
// Piezas portadas del prototipo
// ---------------------------------------------------------------------------------------------------

/**
 * Parte un enunciado en prosa y bloques de código (convertir.js:45-59). Para un bloque, `texto` es el
 * programa sin las cercas.
 */
export function partirCercas(texto: string): { codigo: boolean; texto: string }[] {
  const partes: { codigo: boolean; texto: string }[] = [];
  let codigo = false;
  let lineas: string[] = [];
  const cerrar = () => {
    if (lineas.length || codigo) partes.push({ codigo, texto: lineas.join("\n") });
    lineas = [];
  };
  for (const l of texto.split("\n")) {
    if (l === "```") {
      cerrar();
      codigo = !codigo;
      continue;
    }
    lineas.push(l);
  }
  cerrar();
  return partes;
}

/**
 * Arma el enunciado con las líneas que siguen al encabezado de la pregunta, como convertir.js (líneas
 * 220-253 y 375-386): la prosa recortada y unida con un espacio, las líneas en blanco descartadas, y cada
 * cerca ``` en líneas propias con su código tal cual (solo trimEnd, conserva la sangría). Ejemplo:
 * "¿Qué imprime este programa?\n```\ndef doble(x):\n    print(x * 2)\n```".
 *
 * Se detiene en la primera opción ("- A) ...") que no esté dentro de una cerca. `linea` es la línea donde
 * empieza el enunciado (0 si quedó vacío) y `usadas`, cuántas líneas consumió.
 */
export function armarEnunciado(
  lineas: LineaNumerada[],
  clave: string,
): { texto: string; linea: number; usadas: number; problemas: { linea: number; mensaje: string }[] } {
  const problemas: { linea: number; mensaje: string }[] = [];
  let texto = "";
  let linea = 0;
  // Línea donde se abrió la cerca (0 = no hay una abierta).
  let cercaAbierta = 0;
  let cercaConCodigo = false;
  let ultimoFueCerca = false;
  let i = 0;
  for (; i < lineas.length; i += 1) {
    const l = lineas[i].texto;
    const nl = lineas[i].numero;
    // Dentro de una cerca cada línea se toma en crudo, con su sangría y sus líneas en blanco.
    if (cercaAbierta) {
      if (l.trimEnd() === "```") {
        if (!cercaConCodigo) problemas.push({ linea: cercaAbierta, mensaje: `la cerca de código de ${clave} está vacía` });
        texto += "\n```";
        cercaAbierta = 0;
        ultimoFueCerca = true;
      } else {
        texto += "\n" + l.trimEnd();
        if (l.trim()) cercaConCodigo = true;
      }
      continue;
    }
    if (/^```/.test(l)) {
      if (l.trimEnd() !== "```") {
        problemas.push({
          linea: nl,
          mensaje: "la cerca de apertura va sola en su línea: escribe ``` sin nada después (nada de ```python)",
        });
      }
      if (!texto) linea = nl;
      texto += (texto ? "\n" : "") + "```";
      cercaAbierta = nl;
      cercaConCodigo = false;
      continue;
    }
    if (RE_OPCION.test(l)) break;
    if (l.trim()) {
      if (!texto) linea = nl;
      // La prosa seguida se une con un espacio; tras una cerca va en línea nueva.
      texto += (texto ? (ultimoFueCerca ? "\n" : " ") : "") + l.trim();
      ultimoFueCerca = false;
    }
  }
  if (cercaAbierta) {
    problemas.push({ linea: cercaAbierta, mensaje: `la cerca de código de ${clave} no se cierra. Falta una línea con solo \`\`\`` });
    texto += "\n```";
  }
  return { texto, linea, usadas: i, problemas };
}

/**
 * Parte lo que sigue a "- A) " en el texto de la opción y la cola (convertir.js:337-358). El separador es
 * el ÚLTIMO "·" aislado (con espacio o el borde de la línea a cada lado) que no esté dentro de $…$: el "·"
 * pegado (x·ln(x)) es multiplicación, y así "x · ln(x) · [mc]" parte donde debe.
 */
export function partirOpcion(bruto: string): { texto: string; cola: string } {
  const rangosMate = tramosMate(bruto)
    .tramos.filter((t) => t.mate)
    .map((t) => [t.desde, t.desde + t.texto.length]);
  const enMate = (pos: number) => rangosMate.some((r) => pos >= r[0] && pos < r[1]);
  let corte = -1;
  let largo = 0;
  const reSep = /(^|\s)·(\s|$)/g;
  let mSep: RegExpExecArray | null;
  while ((mSep = reSep.exec(bruto)) !== null) {
    const pos = mSep.index + mSep[1].length;
    reSep.lastIndex = mSep.index + 1;
    if (enMate(pos)) continue;
    corte = pos;
    largo = 1 + mSep[2].length;
  }
  const texto = (corte === -1 ? bruto : bruto.slice(0, corte)).trim();
  const cola = (corte === -1 ? "" : bruto.slice(corte + largo)).trim();
  return { texto, cola };
}

// ---------------------------------------------------------------------------------------------------
// Preguntas
// ---------------------------------------------------------------------------------------------------

function leerOpcion(diag: Diag, archivo: string, linea: number, letra: Letra, bruto: string, clave: string): Opcion {
  const { texto, cola } = partirOpcion(bruto);
  const lugar = { archivo, linea };
  const de = `la opción ${letra} de ${clave}`;
  if (!texto) diag.error(archivo, linea, `${de} no tiene texto`);
  else validarMate(diag, archivo, linea, `el texto de ${de}`, texto);
  if (/^CORRECTA$/i.test(cola)) return { letra, texto, correcta: true, misconcepcion: null, error: null, lugar };
  // - B) texto · [clave-mc] texto propio del error (opcional)
  const m = /^\[([a-z0-9_-]+)\]\s*(.*)$/.exec(cola);
  if (!m) {
    diag.error(archivo, linea, `${de} no dice qué error delata: termina en "· CORRECTA" o en "· [clave-de-la-misconcepción]" (con un texto propio opcional después)`);
    return { letra, texto, correcta: false, misconcepcion: null, error: cola || null, lugar };
  }
  const error = m[2].trim() || null;
  if (error) validarMate(diag, archivo, linea, `el error de ${de}`, error);
  return { letra, texto, correcta: false, misconcepcion: m[1], error, lugar };
}

interface Encabezado {
  clave: string;
  dificultad: 1 | 2 | 3;
  habilidades: string[];
  estado: EstadoPregunta;
  origen: string;
  revisor: string | null;
  porRevisar: boolean;
}

const FORMA_ENCABEZADO = '"### P1 · dificultad 2 · kc: clave · revisada · origen: humano · revisó: Nombre"';

/** `### <clave> · dificultad <1|2|3> · kc: a, b · <estado> · origen: ... · revisó: ... · ⚠ revisar`. */
function leerEncabezado(diag: Diag, archivo: string, linea: LineaNumerada): Encabezado | null {
  const n = linea.numero;
  const [clave = "", dificultad = "", ...tokens] = linea.texto.replace(/^###\s*/, "").trimEnd().split(SEPARADOR).map((s) => s.trim());
  const mDif = /^dificultad\s+(\S+)$/.exec(dificultad);
  // "###P2" (sin espacio), " ### P2" o "#### P2" abren bloque (RE_ENCABEZADO_LAXO) para no perderse, pero
  // no son un encabezado válido.
  if (!/^###\s/.test(linea.texto) || !CLAVE_PREGUNTA.test(clave) || !mDif) {
    diag.error(archivo, n, `encabezado de pregunta mal formado. Debe ser ${FORMA_ENCABEZADO}`);
    return null;
  }
  let completo = true;
  if (!/^[123]$/.test(mDif[1])) {
    diag.error(archivo, n, `la dificultad de ${clave} debe ser 1, 2 o 3 (dice "${mDif[1]}")`);
    completo = false;
  }
  let habilidades: string[] | null = null;
  let estado: EstadoPregunta | null = null;
  let origen: string | null = null;
  let revisor: string | null = null;
  let porRevisar = false;
  const vistos = new Set<string>();
  // Cada token va una vez: si se repite, se reporta y se ignora la repetición.
  const repetido = (tipo: string) => {
    if (!vistos.has(tipo)) {
      vistos.add(tipo);
      return false;
    }
    diag.error(archivo, n, `el encabezado de ${clave} tiene ${tipo} más de una vez`);
    return true;
  };
  for (const token of tokens) {
    let m: RegExpExecArray | null;
    if ((m = /^kc:\s*(.*)$/.exec(token))) {
      if (repetido('"kc:"')) continue;
      const claves = m[1].split(",").map((s) => s.trim());
      if (claves.some((c) => !CLAVE.test(c))) {
        diag.error(archivo, n, `"kc:" de ${clave} está mal formado: van claves de habilidad separadas por comas, como "kc: a, b"`);
        completo = false;
        continue;
      }
      if (new Set(claves).size !== claves.length) diag.error(archivo, n, `la pregunta ${clave} repite una habilidad en "kc:"`);
      habilidades = [...new Set(claves)];
    } else if (token === "borrador" || token === "revisada" || token === "retirada") {
      if (repetido("un estado")) continue;
      estado = token;
    } else if ((m = /^origen:\s*(.*)$/.exec(token))) {
      if (repetido('"origen:"')) continue;
      const mIa = /^ia\s*\(([^()]*)\)$/.exec(m[1]);
      if (m[1] === "humano") origen = "humano";
      else if (mIa && mIa[1].trim()) origen = `ia (${mIa[1].trim()})`;
      else {
        diag.error(archivo, n, `el origen de ${clave} debe ser "humano" o "ia (<modelo>)" (dice "${m[1]}")`);
        completo = false;
      }
    } else if ((m = /^revisó:\s*(.*)$/.exec(token))) {
      if (repetido('"revisó:"')) continue;
      if (m[1].trim()) revisor = m[1].trim();
      else diag.error(archivo, n, `"revisó:" de ${clave} está vacío: escribe quién la revisó`);
    } else if (/^⚠️?\s*revisar$/.test(token)) {
      if (repetido('"⚠ revisar"')) continue;
      porRevisar = true;
    } else {
      diag.error(
        archivo,
        n,
        `no entiendo "${token}" en el encabezado de ${clave}. Después de la dificultad van "kc: ...", el estado (borrador, revisada o retirada), "origen: ...", "revisó: ..." y, opcional, "⚠ revisar"`,
      );
    }
  }
  if (!habilidades && !vistos.has('"kc:"')) diag.error(archivo, n, `la pregunta ${clave} no dice qué habilidades mide: agrega "· kc: clave" al encabezado`);
  if (!estado) diag.error(archivo, n, `la pregunta ${clave} no tiene estado: agrega "· borrador", "· revisada" o "· retirada" al encabezado`);
  if (!origen && !vistos.has('"origen:"')) diag.error(archivo, n, `la pregunta ${clave} no tiene origen: agrega "· origen: humano" o "· origen: ia (<modelo>)"`);
  // Un "revisó:" vacío ya se reportó arriba.
  if (estado === "revisada" && !revisor && !vistos.has('"revisó:"')) {
    diag.error(archivo, n, `la pregunta ${clave} está revisada pero no dice quién la revisó: agrega "· revisó: Nombre"`);
  }
  if (!completo || !habilidades || !estado || !origen) return null;
  return { clave, dificultad: Number(mDif[1]) as 1 | 2 | 3, habilidades, estado, origen, revisor, porRevisar };
}

/**
 * `solución: <texto>` hasta el final del bloque. Conserva los saltos de línea (cada línea con trimEnd),
 * quita las líneas en blanco del principio y del final, y admite cercas de código.
 */
function leerSolucion(diag: Diag, archivo: string, clave: string, primera: LineaNumerada, resto: LineaNumerada[]): string | null {
  const lineas = [{ texto: primera.texto.trim(), numero: primera.numero }, ...resto.map((l) => ({ texto: l.texto.trimEnd(), numero: l.numero }))];
  while (lineas.length > 0 && !lineas[0].texto.trim()) lineas.shift();
  while (lineas.length > 0 && !lineas[lineas.length - 1].texto.trim()) lineas.pop();
  if (lineas.length === 0) {
    diag.error(archivo, primera.numero, `la solución de ${clave} está vacía`);
    return null;
  }
  let cercaAbierta = 0;
  let cercaConCodigo = false;
  for (const { texto, numero } of lineas) {
    if (cercaAbierta) {
      if (texto === "```") {
        if (!cercaConCodigo) diag.error(archivo, cercaAbierta, `la cerca de código de la solución de ${clave} está vacía`);
        cercaAbierta = 0;
      } else if (texto.trim()) cercaConCodigo = true;
      continue;
    }
    if (/^```/.test(texto)) {
      if (texto !== "```") {
        diag.error(archivo, numero, "la cerca de apertura va sola en su línea: escribe ``` sin nada después (nada de ```python)");
      }
      cercaAbierta = numero;
      cercaConCodigo = false;
      continue;
    }
    // Un "## Errores" o "# Título" con espacios delante no corta la pregunta: sin esto acabaría dentro de
    // la solución sin ningún error.
    if (/^\s{0,3}#/.test(texto)) {
      diag.error(archivo, numero, `la solución de ${clave} tiene una línea que parece un encabezado ("${texto.trim()}"): los encabezados van al principio de la línea, fuera de la solución`);
      continue;
    }
    // Solo la prosa: el código puede llevar $ o \.
    validarMate(diag, archivo, numero, `la solución de ${clave}`, texto);
  }
  if (cercaAbierta) diag.error(archivo, cercaAbierta, `la cerca de código de la solución de ${clave} no se cierra. Falta una línea con solo \`\`\``);
  return lineas.map((l) => l.texto).join("\n");
}

/** Un bloque de pregunta: el encabezado y sus líneas hasta el siguiente "### ", "## " o el fin del archivo. */
function leerPregunta(diag: Diag, archivo: string, bloque: LineaNumerada[]): Pregunta | null {
  const cabeza = bloque[0];
  const encabezado = leerEncabezado(diag, archivo, cabeza);
  // Aunque el encabezado esté mal, se revisa el cuerpo para reportar todo de una vez.
  const clave = encabezado?.clave ?? (cabeza.texto.replace(/^###\s*/, "").split(SEPARADOR)[0].trim() || "(sin clave)");

  const enunciado = armarEnunciado(bloque.slice(1), clave);
  for (const p of enunciado.problemas) diag.error(archivo, p.linea, p.mensaje);
  if (!enunciado.texto) diag.error(archivo, cabeza.numero, `la pregunta ${clave} no tiene enunciado`);
  else {
    // El enunciado puede ocupar varias líneas: se revisa ya unido y el error apunta a su primera línea.
    // Solo la prosa: el código puede llevar $ o \.
    const partes = partirCercas(enunciado.texto);
    for (const parte of partes) {
      if (!parte.codigo) validarMate(diag, archivo, enunciado.linea, `el enunciado de ${clave}`, parte.texto);
    }
    if (partes.every((parte) => parte.codigo)) {
      diag.aviso(archivo, enunciado.linea, `el enunciado de ${clave} es solo código: falta la frase que dice qué se pregunta`);
    }
  }

  // Las opciones, seguidas (puede haber líneas en blanco entre ellas).
  const opciones: Opcion[] = [];
  let i = 1 + enunciado.usadas;
  for (; i < bloque.length; i += 1) {
    const m = RE_OPCION.exec(bloque[i].texto);
    if (m) opciones.push(leerOpcion(diag, archivo, bloque[i].numero, m[1] as Letra, m[2], clave));
    else if (bloque[i].texto.trim()) break;
  }
  if (opciones.length !== 4) diag.error(archivo, cabeza.numero, `la pregunta ${clave} tiene ${opciones.length} opciones, deben ser 4 (A, B, C y D)`);
  else if (opciones.map((o) => o.letra).join("") !== "ABCD") {
    diag.error(archivo, cabeza.numero, `las opciones de ${clave} deben ir en orden: A, B, C y D`);
  }
  const correctas = opciones.filter((o) => o.correcta).length;
  if (correctas !== 1) {
    diag.error(archivo, cabeza.numero, `la pregunta ${clave} tiene ${correctas} opciones marcadas CORRECTA, debe ser exactamente 1`);
  }

  // Después de las opciones solo caben líneas en blanco y la solución.
  let solucion: string | null = null;
  for (; i < bloque.length; i += 1) {
    const { texto, numero } = bloque[i];
    if (!texto.trim()) continue;
    const mSol = /^solución:(.*)$/.exec(texto);
    if (mSol) {
      solucion = leerSolucion(diag, archivo, clave, { texto: mSol[1], numero }, bloque.slice(i + 1));
      break;
    }
    if (/^```/.test(texto)) {
      diag.error(archivo, numero, "una cerca de código solo va en el enunciado (antes de las opciones) o en la solución");
      // Se salta el bloque de código entero para no reportar cada una de sus líneas.
      i += 1;
      while (i < bloque.length && bloque[i].texto.trimEnd() !== "```") i += 1;
      continue;
    }
    diag.error(archivo, numero, `línea inesperada después de las opciones de ${clave}: solo puede seguir "solución: ..."`);
  }

  if (!encabezado) return null;
  return {
    clave: encabezado.clave,
    dificultad: encabezado.dificultad,
    habilidades: encabezado.habilidades,
    estado: encabezado.estado,
    origen: encabezado.origen,
    revisor: encabezado.revisor,
    porRevisar: encabezado.porRevisar,
    enunciado: enunciado.texto,
    opciones,
    solucion,
    lugar: { archivo, linea: cabeza.numero },
  };
}

// ---------------------------------------------------------------------------------------------------
// Archivo de tema
// ---------------------------------------------------------------------------------------------------

/** `kc: clave · descripción[ · prerrequisitos: a, otra-materia/b]`. */
function leerHabilidad(diag: Diag, archivo: string, carpeta: string, n: number, linea: string): Habilidad | null {
  const resto = linea.replace(/^kc:\s*/, "");
  const i1 = resto.indexOf(SEPARADOR);
  if (i1 === -1) {
    diag.error(archivo, n, 'línea "kc:" mal formada. Debe ser "kc: clave · descripción" (y opcional "· prerrequisitos: a, otra-materia/b")');
    return null;
  }
  const clave = resto.slice(0, i1).trim();
  if (!CLAVE.test(clave)) {
    diag.error(archivo, n, `la clave de habilidad "${clave}" no sirve: minúsculas, dígitos, "-" o "_", empezando por letra o dígito`);
    return null;
  }
  // Si el ÚLTIMO campo empieza por "prerrequisitos:", son los prerrequisitos y la descripción es lo del medio.
  let descripcion = resto.slice(i1 + SEPARADOR.length);
  const iu = descripcion.lastIndexOf(SEPARADOR);
  const ultimo = (iu === -1 ? descripcion : descripcion.slice(iu + SEPARADOR.length)).trim();
  const prerrequisitos: ReferenciaHabilidad[] = [];
  if (ultimo.startsWith("prerrequisitos:")) {
    descripcion = iu === -1 ? "" : descripcion.slice(0, iu);
    const refs = ultimo.slice("prerrequisitos:".length).split(",").map((s) => s.trim());
    if (refs.every((r) => !r)) diag.error(archivo, n, `la lista de prerrequisitos de "${clave}" está vacía`);
    else {
      for (const ref of refs) {
        const m = PRERREQUISITO.exec(ref);
        if (!m) {
          diag.error(archivo, n, `el prerrequisito "${ref}" de "${clave}" está mal escrito: "clave" (misma materia) o "carpeta-de-la-materia/clave"`);
          continue;
        }
        // "carpeta-propia/clave" es lo mismo que "clave".
        const materia = m[1] && m[1] !== carpeta ? m[1] : null;
        if (prerrequisitos.some((p) => p.materia === materia && p.clave === m[2])) {
          diag.error(archivo, n, `el prerrequisito "${ref}" de "${clave}" está repetido`);
          continue;
        }
        prerrequisitos.push({ materia, clave: m[2] });
      }
    }
  }
  descripcion = descripcion.trim();
  if (!descripcion) diag.error(archivo, n, `la habilidad "${clave}" no tiene descripción`);
  else validarMate(diag, archivo, n, `la descripción de la habilidad "${clave}"`, descripcion);
  return { clave, descripcion, prerrequisitos, lugar: { archivo, linea: n } };
}

/** `mc: clave · clave-de-la-habilidad · descripción` (la descripción puede contener " · "). */
function leerMisconcepcion(diag: Diag, archivo: string, n: number, linea: string): Misconcepcion | null {
  const resto = linea.replace(/^mc:\s*/, "");
  const i1 = resto.indexOf(SEPARADOR);
  const i2 = i1 === -1 ? -1 : resto.indexOf(SEPARADOR, i1 + SEPARADOR.length);
  if (i2 === -1) {
    diag.error(archivo, n, 'línea "mc:" mal formada. Debe ser "mc: clave · clave-de-la-habilidad · descripción del error"');
    return null;
  }
  const clave = resto.slice(0, i1).trim();
  const habilidad = resto.slice(i1 + SEPARADOR.length, i2).trim();
  const descripcion = resto.slice(i2 + SEPARADOR.length).trim();
  if (!CLAVE.test(clave) || !CLAVE.test(habilidad)) {
    diag.error(archivo, n, 'línea "mc:" mal formada: la clave del error y la de la habilidad van en minúsculas, dígitos, "-" o "_"');
    return null;
  }
  if (!descripcion) diag.error(archivo, n, `la misconcepción "${clave}" no tiene descripción`);
  else validarMate(diag, archivo, n, `la descripción de la misconcepción "${clave}"`, descripcion);
  return { clave, habilidad, descripcion, lugar: { archivo, linea: n } };
}

const SECCIONES_TEMA = ["## Habilidades", "## Errores", "## Preguntas"] as const;

/** `<tema>.md`: "# Nombre", texto libre, y las secciones Habilidades, Errores y Preguntas, en ese orden. */
function leerTema(diag: Diag, archivo: string, clave: string, carpeta: string, texto: string): Tema {
  const lineas = lineasDe(texto);
  const tema: Tema = {
    clave,
    nombre: "",
    orden: 0,
    introduccion: "",
    habilidades: [],
    misconcepciones: [],
    preguntas: [],
    lugar: { archivo, linea: 1 },
  };
  const intro: string[] = [];
  const vistas = new Map<string, number>();
  let seccion: "inicio" | "intro" | "habilidades" | "errores" | "preguntas" | "ignorar" = "inicio";
  let ultima = -1;
  let bloque: LineaNumerada[] | null = null;
  let enCerca = false;
  const cerrarBloque = () => {
    if (bloque) {
      const pregunta = leerPregunta(diag, archivo, bloque);
      if (pregunta) tema.preguntas.push(pregunta);
    }
    bloque = null;
    enCerca = false;
  };

  for (let i = 0; i < lineas.length; i += 1) {
    const l = lineas[i];
    const n = i + 1;
    // Dentro de una cerca de una pregunta todo es código, salvo el encabezado de otra pregunta.
    if (bloque && enCerca) {
      if (RE_PREGUNTA_EN_CERCA.test(l)) {
        cerrarBloque();
        bloque = [{ texto: l, numero: n }];
        continue;
      }
      if (l.trimEnd() === "```") enCerca = false;
      bloque.push({ texto: l, numero: n });
      continue;
    }
    if (RE_SECCION.test(l)) {
      cerrarBloque();
      if (seccion === "inicio") diag.error(archivo, n, 'falta el título del tema: la primera línea debe ser "# Nombre del tema"');
      const nombre = l.trim();
      const indice = (SECCIONES_TEMA as readonly string[]).indexOf(nombre);
      if (indice === -1) {
        diag.error(archivo, n, `sección desconocida "${nombre}". Un tema tiene, en este orden: ${SECCIONES_TEMA.join(", ")}`);
        seccion = "ignorar";
        continue;
      }
      if (vistas.has(nombre)) {
        diag.error(archivo, n, `la sección "${nombre}" está repetida (ya está en la línea ${vistas.get(nombre)})`);
        seccion = "ignorar";
        continue;
      }
      if (indice < ultima) {
        diag.error(archivo, n, `la sección "${nombre}" va antes de "${SECCIONES_TEMA[ultima]}": el orden es ${SECCIONES_TEMA.join(", ")}`);
      }
      vistas.set(nombre, n);
      ultima = Math.max(ultima, indice);
      seccion = (["habilidades", "errores", "preguntas"] as const)[indice];
      continue;
    }
    switch (seccion) {
      case "inicio": {
        if (!l.trim()) break;
        seccion = "intro";
        const mTitulo = /^#(\s+(.*))?$/.exec(l);
        if (mTitulo) {
          tema.nombre = (mTitulo[2] ?? "").trim();
          tema.lugar = { archivo, linea: n };
          if (!tema.nombre) diag.error(archivo, n, "el título del tema está vacío");
          else validarMate(diag, archivo, n, "el nombre del tema", tema.nombre);
        } else {
          diag.error(archivo, n, 'falta el título del tema: la primera línea debe ser "# Nombre del tema"');
          intro.push(l);
        }
        break;
      }
      case "intro":
        intro.push(l);
        break;
      case "habilidades":
        if (!l.trim()) break;
        if (/^kc:/.test(l)) {
          const habilidad = leerHabilidad(diag, archivo, carpeta, n, l);
          if (habilidad) tema.habilidades.push(habilidad);
        } else diag.error(archivo, n, 'en "## Habilidades" solo van líneas "kc: clave · descripción" y líneas en blanco');
        break;
      case "errores":
        if (!l.trim()) break;
        if (/^mc:/.test(l)) {
          const misconcepcion = leerMisconcepcion(diag, archivo, n, l);
          if (misconcepcion) tema.misconcepciones.push(misconcepcion);
        } else diag.error(archivo, n, 'en "## Errores" solo van líneas "mc: clave · habilidad · descripción" y líneas en blanco');
        break;
      case "preguntas":
        if (RE_ENCABEZADO_LAXO.test(l)) {
          cerrarBloque();
          bloque = [{ texto: l, numero: n }];
        } else if (bloque) {
          if (/^```/.test(l)) enCerca = true;
          bloque.push({ texto: l, numero: n });
        } else if (l.trim()) {
          diag.error(archivo, n, 'texto fuera de una pregunta: cada pregunta empieza con "### P1 · dificultad 2 · ..."');
        }
        break;
      case "ignorar":
        break;
    }
  }
  cerrarBloque();

  if (seccion === "inicio") diag.error(archivo, 1, 'el tema está vacío: falta el título "# Nombre del tema" y sus secciones');
  for (const nombre of SECCIONES_TEMA) {
    if (!vistas.has(nombre)) diag.error(archivo, 1, `falta la sección "${nombre}". Un tema tiene, en este orden: ${SECCIONES_TEMA.join(", ")}`);
  }
  const lineaHabilidades = vistas.get("## Habilidades");
  if (lineaHabilidades !== undefined && tema.habilidades.length === 0) {
    diag.error(archivo, lineaHabilidades, 'el tema no tiene habilidades: necesita al menos una línea "kc: clave · descripción"');
  }
  tema.introduccion = textoLibre(intro);
  return tema;
}

// ---------------------------------------------------------------------------------------------------
// materia.md
// ---------------------------------------------------------------------------------------------------

interface EvaluacionLeida {
  evaluacion: Evaluacion;
  /** Línea de "temas:" (0 si falta), para ubicar los errores de sus temas. */
  lineaTemas: number;
}

interface MateriaLeida {
  codigo: string;
  lineaCodigo: number;
  nombre: string;
  libro: string | null;
  introduccion: string;
  temas: { clave: string; linea: number }[];
  evaluaciones: EvaluacionLeida[];
  /** Línea de "## Evaluaciones" (0 si falta). */
  lineaEvaluaciones: number;
}

const FORMA_EVALUACION = '"### clave · Nombre · semana N" (y "· acumulativa" al final si aplica)';

function leerMateriaMd(diag: Diag, archivo: string, texto: string): MateriaLeida {
  const lineas = lineasDe(texto);
  const datos = new Map<string, { valor: string; linea: number }>();
  let i = 0;
  if (lineas[0].trim() === "---") {
    let cerrado = false;
    for (i = 1; i < lineas.length; i += 1) {
      const l = lineas[i];
      if (l.trim() === "---") {
        cerrado = true;
        i += 1;
        break;
      }
      if (!l.trim()) continue;
      const m = /^([A-Za-z_]+):\s*(.*)$/.exec(l);
      if (!m) diag.error(archivo, i + 1, 'línea mal formada en el frontmatter: debe ser "clave: valor"');
      else if (!["codigo", "nombre", "libro"].includes(m[1])) {
        diag.error(archivo, i + 1, `clave desconocida "${m[1]}" en el frontmatter: solo van codigo, nombre y libro`);
      } else if (datos.has(m[1])) diag.error(archivo, i + 1, `"${m[1]}" está repetida en el frontmatter`);
      else datos.set(m[1], { valor: m[2].trim(), linea: i + 1 });
    }
    if (!cerrado) diag.error(archivo, 1, 'no encontré el "---" que cierra el frontmatter');
  } else {
    diag.error(archivo, 1, 'materia.md debe empezar con el frontmatter: una línea "---", "codigo: ...", "nombre: ..." y otra línea "---"');
  }

  const codigo = datos.get("codigo");
  if (!codigo) diag.error(archivo, 1, 'falta "codigo" en el frontmatter');
  else if (!CODIGO.test(codigo.valor)) {
    diag.error(archivo, codigo.linea, `el código "${codigo.valor}" no tiene la forma de un código Uniandes: cuatro mayúsculas, guion y cuatro dígitos (MATE-1214)`);
  }
  const nombre = datos.get("nombre");
  if (!nombre?.valor) diag.error(archivo, nombre?.linea ?? 1, 'falta "nombre" en el frontmatter');

  const leida: MateriaLeida = {
    codigo: codigo?.valor ?? "",
    lineaCodigo: codigo?.linea ?? 1,
    nombre: nombre?.valor ?? "",
    libro: datos.get("libro")?.valor || null,
    introduccion: "",
    temas: [],
    evaluaciones: [],
    lineaEvaluaciones: 0,
  };

  const intro: string[] = [];
  const vistas = new Map<string, number>();
  let seccion: "intro" | "temas" | "evaluaciones" | "ignorar" = "intro";
  // La evaluación cuyo encabezado se acaba de leer (null si el encabezado está mal: su "temas:" se ignora).
  let actual: EvaluacionLeida | null = null;
  let actualMalFormada = false;
  for (; i < lineas.length; i += 1) {
    const l = lineas[i];
    const n = i + 1;
    if (RE_SECCION.test(l)) {
      const nombreSeccion = l.trim();
      if (nombreSeccion !== "## Temas" && nombreSeccion !== "## Evaluaciones") {
        diag.error(archivo, n, `sección desconocida "${nombreSeccion}": materia.md solo tiene "## Temas" y "## Evaluaciones"`);
        seccion = "ignorar";
      } else if (vistas.has(nombreSeccion)) {
        diag.error(archivo, n, `la sección "${nombreSeccion}" está repetida (ya está en la línea ${vistas.get(nombreSeccion)})`);
        seccion = "ignorar";
      } else {
        vistas.set(nombreSeccion, n);
        seccion = nombreSeccion === "## Temas" ? "temas" : "evaluaciones";
        if (seccion === "evaluaciones") leida.lineaEvaluaciones = n;
      }
      continue;
    }
    if (seccion === "intro") intro.push(l);
    else if (seccion === "temas") {
      if (!l.trim()) continue;
      const m = /^-\s+(.*)$/.exec(l);
      const clave = m?.[1].trim() ?? "";
      if (!m || !CLAVE.test(clave)) {
        diag.error(archivo, n, 'en "## Temas" solo van líneas "- clave-del-tema" (el nombre del archivo sin .md)');
      } else if (leida.temas.some((t) => t.clave === clave)) {
        diag.error(archivo, n, `el tema "${clave}" está repetido en "## Temas"`);
      } else leida.temas.push({ clave, linea: n });
    } else if (seccion === "evaluaciones") {
      if (!l.trim()) continue;
      if (RE_ENCABEZADO.test(l)) {
        actual = leerEncabezadoEvaluacion(diag, archivo, n, l);
        actualMalFormada = actual === null;
        if (actual) leida.evaluaciones.push(actual);
        continue;
      }
      const mTemas = /^temas:(.*)$/.exec(l);
      if (mTemas && (actual || actualMalFormada)) {
        if (!actual) continue;
        if (actual.lineaTemas) {
          diag.error(archivo, n, `la evaluación "${actual.evaluacion.clave}" ya tiene su línea "temas:" (línea ${actual.lineaTemas})`);
          continue;
        }
        leerTemasEvaluacion(diag, archivo, n, mTemas[1], actual);
        continue;
      }
      diag.error(archivo, n, `línea extraña en "## Evaluaciones": cada evaluación es ${FORMA_EVALUACION} seguida de una línea "temas: a, b"`);
    }
  }
  for (const nombreSeccion of ["## Temas", "## Evaluaciones"]) {
    if (!vistas.has(nombreSeccion)) diag.error(archivo, 1, `falta la sección "${nombreSeccion}" en materia.md`);
  }
  for (const { evaluacion, lineaTemas } of leida.evaluaciones) {
    if (!lineaTemas) diag.error(archivo, evaluacion.lugar.linea, `a la evaluación "${evaluacion.clave}" le falta la línea "temas: a, b" debajo del encabezado`);
  }
  leida.introduccion = textoLibre(intro);
  return leida;
}

/** `### <clave> · <nombre> · semana <n>[ · acumulativa]`. */
function leerEncabezadoEvaluacion(diag: Diag, archivo: string, n: number, linea: string): EvaluacionLeida | null {
  const campos = linea.replace(/^###\s*/, "").trimEnd().split(SEPARADOR).map((s) => s.trim());
  const [clave = "", nombre = "", semana = "", extra] = campos;
  const mSemana = /^semana\s+(\d+)$/.exec(semana);
  if (campos.length > 4 || !mSemana || (extra !== undefined && extra !== "acumulativa") || !nombre) {
    diag.error(archivo, n, `encabezado de evaluación mal formado. Debe ser ${FORMA_EVALUACION}`);
    return null;
  }
  if (!CLAVE.test(clave)) {
    diag.error(archivo, n, `la clave de evaluación "${clave}" no sirve: minúsculas, dígitos, "-" o "_", como "parcial-1"`);
    return null;
  }
  const numeroSemana = Number(mSemana[1]);
  if (numeroSemana <= 0) {
    diag.error(archivo, n, `la semana de "${clave}" debe ser un entero mayor que 0`);
    return null;
  }
  return {
    evaluacion: {
      clave,
      nombre,
      semana: numeroSemana,
      acumulativa: extra === "acumulativa",
      temasPropios: [],
      temas: [],
      activa: false,
      lugar: { archivo, linea: n },
    },
    lineaTemas: 0,
  };
}

function leerTemasEvaluacion(diag: Diag, archivo: string, n: number, texto: string, leida: EvaluacionLeida) {
  const { evaluacion } = leida;
  leida.lineaTemas = n;
  const claves = texto.trim() ? texto.split(",").map((s) => s.trim()) : [];
  for (const clave of claves) {
    if (!CLAVE.test(clave)) {
      diag.error(archivo, n, `"temas:" de "${evaluacion.clave}" está mal formada: van claves de tema separadas por comas, como "temas: a, b"`);
    } else if (evaluacion.temasPropios.includes(clave)) {
      diag.error(archivo, n, `el tema "${clave}" está repetido en "temas:" de "${evaluacion.clave}"`);
    } else evaluacion.temasPropios.push(clave);
  }
  if (claves.length === 0 && !evaluacion.acumulativa) {
    diag.error(archivo, n, `la evaluación "${evaluacion.clave}" no tiene temas: "temas:" solo puede quedar vacía en una evaluación acumulativa`);
  }
}

// ---------------------------------------------------------------------------------------------------
// El banco completo
// ---------------------------------------------------------------------------------------------------

/**
 * Lee y valida el banco a partir de sus archivos (rutas relativas a la raíz del banco, con "/"). No toca
 * el disco. Los archivos sueltos de la raíz (README.md, PROCESO.md) se ignoran; cada carpeta es una materia.
 */
export function analizarBanco(archivos: ArchivoBanco[]): ResultadoBanco {
  const errores: Diagnostico[] = [];
  const avisos: Diagnostico[] = [];
  const diag: Diag = {
    error: (archivo, linea, mensaje) => errores.push({ archivo, linea, mensaje }),
    aviso: (archivo, linea, mensaje) => avisos.push({ archivo, linea, mensaje }),
  };

  const porCarpeta = new Map<string, ArchivoBanco[]>();
  for (const archivo of archivos) {
    const ruta = archivo.ruta.replaceAll("\\", "/");
    const barra = ruta.indexOf("/");
    if (barra === -1) continue;
    const carpeta = ruta.slice(0, barra);
    porCarpeta.set(carpeta, [...(porCarpeta.get(carpeta) ?? []), { ruta, texto: archivo.texto }]);
  }

  const materias: Materia[] = [];
  // La línea del código no está en el modelo; solo hace falta para ubicar un código repetido.
  const lineasCodigo = new Map<Materia, number>();
  for (const carpeta of [...porCarpeta.keys()].sort()) {
    const rutaMateria = `${carpeta}/materia.md`;
    const suyos = porCarpeta.get(carpeta) ?? [];
    if (!CARPETA.test(carpeta)) {
      diag.error(rutaMateria, 1, `la carpeta "${carpeta}" no sirve como clave de materia: minúsculas y dígitos separados por guiones, como "calculo-integral"`);
    }
    const md = suyos.find((a) => a.ruta === rutaMateria);
    if (!md) diag.error(rutaMateria, 1, `falta materia.md en la carpeta "${carpeta}"`);
    const leida: MateriaLeida = md
      ? leerMateriaMd(diag, rutaMateria, md.texto)
      : { codigo: "", lineaCodigo: 1, nombre: "", libro: null, introduccion: "", temas: [], evaluaciones: [], lineaEvaluaciones: 0 };

    const archivosTema = new Map<string, ArchivoBanco>();
    for (const archivo of suyos) {
      if (archivo === md) continue;
      const m = /^([^/]+)\.md$/.exec(archivo.ruta.slice(carpeta.length + 1));
      if (!m || m[1] === "materia" || !CLAVE.test(m[1])) {
        diag.error(archivo.ruta, 1, 'archivo inesperado: en la carpeta de una materia solo van materia.md y un "<clave-del-tema>.md" por tema (minúsculas, dígitos, "-" o "_")');
        continue;
      }
      archivosTema.set(m[1], archivo);
    }

    const temas: Tema[] = [];
    leida.temas.forEach(({ clave, linea }, indice) => {
      const archivo = archivosTema.get(clave);
      if (!archivo) {
        diag.error(rutaMateria, linea, `el tema "${clave}" no tiene su archivo ${clave}.md en la carpeta`);
        return;
      }
      const tema = leerTema(diag, archivo.ruta, clave, carpeta, archivo.texto);
      tema.orden = indice + 1;
      temas.push(tema);
    });
    // Un archivo de tema que materia.md no lista es un error, pero se lee igual para reportar todo de una vez.
    for (const clave of [...archivosTema.keys()].sort()) {
      if (leida.temas.some((t) => t.clave === clave)) continue;
      const archivo = archivosTema.get(clave) as ArchivoBanco;
      diag.error(archivo.ruta, 1, `el tema "${clave}" no está en la sección "## Temas" de materia.md`);
      const tema = leerTema(diag, archivo.ruta, clave, carpeta, archivo.texto);
      tema.orden = leida.temas.length + temas.length + 1;
      temas.push(tema);
    }

    const materia: Materia = {
      carpeta,
      codigo: leida.codigo,
      nombre: leida.nombre,
      libro: leida.libro,
      introduccion: leida.introduccion,
      temas,
      evaluaciones: leida.evaluaciones.map((e) => e.evaluacion),
      lugar: { archivo: rutaMateria, linea: 1 },
    };
    if (md && leida.lineaEvaluaciones && leida.evaluaciones.length === 0) {
      diag.error(rutaMateria, leida.lineaEvaluaciones, "la materia no tiene evaluaciones: necesita al menos una (RN-20)");
    }
    materias.push(materia);
    lineasCodigo.set(materia, leida.lineaCodigo);
    validarMateria(diag, materia, leida);
  }

  validarCodigos(diag, materias, lineasCodigo);
  validarPrerrequisitos(diag, materias);
  const cobertura = calcularCobertura(materias);

  const orden = (a: Diagnostico, b: Diagnostico) => (a.archivo < b.archivo ? -1 : a.archivo > b.archivo ? 1 : a.linea - b.linea);
  errores.sort(orden);
  avisos.sort(orden);
  return { banco: { materias }, errores, avisos, cobertura };
}

/** Reglas dentro de una materia: claves únicas, referencias existentes y expansión de las evaluaciones. */
function validarMateria(diag: Diag, materia: Materia, leida: MateriaLeida) {
  const habilidades = new Map<string, { habilidad: Habilidad; tema: Tema }>();
  const misconcepciones = new Map<string, Misconcepcion>();
  const preguntas = new Map<string, Pregunta>();
  for (const tema of materia.temas) {
    for (const habilidad of tema.habilidades) {
      const otra = habilidades.get(habilidad.clave);
      if (otra) diag.error(habilidad.lugar.archivo, habilidad.lugar.linea, `la habilidad "${habilidad.clave}" está repetida (ya está en ${donde(otra.habilidad.lugar)})`);
      else habilidades.set(habilidad.clave, { habilidad, tema });
    }
    for (const misconcepcion of tema.misconcepciones) {
      const otra = misconcepciones.get(misconcepcion.clave);
      if (otra) diag.error(misconcepcion.lugar.archivo, misconcepcion.lugar.linea, `la misconcepción "${misconcepcion.clave}" está repetida (ya está en ${donde(otra.lugar)})`);
      else misconcepciones.set(misconcepcion.clave, misconcepcion);
    }
    for (const pregunta of tema.preguntas) {
      // Las claves de pregunta no distinguen mayúsculas: P1 y p1 son la misma.
      const otra = preguntas.get(pregunta.clave.toLowerCase());
      if (otra) diag.error(pregunta.lugar.archivo, pregunta.lugar.linea, `la pregunta "${pregunta.clave}" está repetida en la materia (ya está en ${donde(otra.lugar)})`);
      else preguntas.set(pregunta.clave.toLowerCase(), pregunta);
    }
  }

  for (const misconcepcion of misconcepciones.values()) {
    if (!habilidades.has(misconcepcion.habilidad)) {
      diag.error(misconcepcion.lugar.archivo, misconcepcion.lugar.linea, `la misconcepción "${misconcepcion.clave}" es de la habilidad "${misconcepcion.habilidad}", que no existe en la materia`);
    }
  }

  for (const tema of materia.temas) {
    for (const pregunta of tema.preguntas) {
      const { archivo, linea } = pregunta.lugar;
      for (const clave of pregunta.habilidades) {
        const declarada = habilidades.get(clave);
        if (!declarada) diag.error(archivo, linea, `la pregunta ${pregunta.clave} mide la habilidad "${clave}", que no existe en la materia`);
        else if (declarada.tema !== tema) {
          diag.aviso(archivo, linea, `la pregunta ${pregunta.clave} mide "${clave}", que es del tema "${declarada.tema.clave}"`);
        }
      }
      for (const opcion of pregunta.opciones) {
        if (opcion.correcta || !opcion.misconcepcion) continue;
        const misconcepcion = misconcepciones.get(opcion.misconcepcion);
        if (!misconcepcion) {
          diag.error(opcion.lugar.archivo, opcion.lugar.linea, `la opción ${opcion.letra} de ${pregunta.clave} usa la misconcepción "${opcion.misconcepcion}", que no existe en la materia`);
        } else if (habilidades.has(misconcepcion.habilidad) && !pregunta.habilidades.includes(misconcepcion.habilidad)) {
          diag.aviso(
            opcion.lugar.archivo,
            opcion.lugar.linea,
            `la opción ${opcion.letra} de ${pregunta.clave} usa "${misconcepcion.clave}", que es de la habilidad "${misconcepcion.habilidad}" y la pregunta no la mide`,
          );
        }
      }
      const deIa = pregunta.origen.startsWith("ia (");
      if (deIa && !pregunta.solucion && pregunta.estado === "revisada") {
        diag.error(archivo, linea, `la pregunta ${pregunta.clave} es de origen IA y está revisada sin "solución:": la solución es obligatoria en las preguntas de IA`);
      }
      if (deIa && !pregunta.solucion && pregunta.estado === "borrador") {
        diag.aviso(archivo, linea, `la pregunta ${pregunta.clave} es un borrador de IA sin "solución:": hay que escribirla antes de marcarla revisada`);
      }
      if (pregunta.estado === "revisada" && pregunta.porRevisar) {
        diag.aviso(archivo, linea, `la pregunta ${pregunta.clave} está revisada pero conserva la marca "⚠ revisar"`);
      }
    }
  }

  // Evaluaciones: claves únicas, temas existentes y expansión de las acumulativas.
  const ordenTema = new Map(materia.temas.map((t) => [t.clave, t.orden]));
  const listados = new Set(leida.temas.map((t) => t.clave));
  const vistas = new Map<string, Evaluacion>();
  for (const { evaluacion, lineaTemas } of leida.evaluaciones) {
    const otra = vistas.get(evaluacion.clave);
    if (otra) diag.error(evaluacion.lugar.archivo, evaluacion.lugar.linea, `la evaluación "${evaluacion.clave}" está repetida (ya está en ${donde(otra.lugar)})`);
    else vistas.set(evaluacion.clave, evaluacion);
    for (const clave of evaluacion.temasPropios) {
      if (!listados.has(clave)) {
        diag.error(evaluacion.lugar.archivo, lineaTemas, `el tema "${clave}" de la evaluación "${evaluacion.clave}" no está en "## Temas"`);
      }
    }
  }
  // Una acumulativa suma los temas (ya expandidos) de las evaluaciones con semana estrictamente menor; por
  // eso se expanden en orden de semana.
  const porSemana = [...materia.evaluaciones].sort((a, b) => a.semana - b.semana);
  for (const evaluacion of porSemana) {
    const temas = new Set(evaluacion.temasPropios.filter((t) => ordenTema.has(t)));
    if (evaluacion.acumulativa) {
      for (const anterior of porSemana) if (anterior.semana < evaluacion.semana) for (const t of anterior.temas) temas.add(t);
    }
    evaluacion.temas = [...temas].sort((a, b) => (ordenTema.get(a) ?? 0) - (ordenTema.get(b) ?? 0));
    // Las no acumulativas sin temas ya se reportaron en su línea "temas:".
    if (evaluacion.acumulativa && evaluacion.temas.length === 0) {
      diag.error(
        evaluacion.lugar.archivo,
        evaluacion.lugar.linea,
        `la evaluación "${evaluacion.clave}" queda sin temas: es acumulativa, pero no tiene temas propios ni evaluaciones anteriores (de semana menor) con temas`,
      );
    }
  }
}

/** El código es la llave de la materia en la base: dos carpetas con el mismo código se pisarían. */
function validarCodigos(diag: Diag, materias: Materia[], lineasCodigo: Map<Materia, number>) {
  const vistos = new Map<string, Materia>();
  for (const materia of materias) {
    if (!materia.codigo) continue;
    const otra = vistos.get(materia.codigo);
    if (otra) {
      diag.error(materia.lugar.archivo, lineasCodigo.get(materia) ?? 1, `el código ${materia.codigo} ya es de la materia "${otra.carpeta}"`);
    } else vistos.set(materia.codigo, materia);
  }
}

/** Prerrequisitos existentes (en la misma materia o en otra carpeta del banco) y sin ciclos. */
function validarPrerrequisitos(diag: Diag, materias: Materia[]) {
  const nodo = (carpeta: string, clave: string) => `${carpeta}/${clave}`;
  const habilidades = new Map<string, Habilidad>();
  const carpetas = new Set(materias.map((m) => m.carpeta));
  for (const materia of materias) {
    for (const tema of materia.temas) {
      for (const habilidad of tema.habilidades) {
        if (!habilidades.has(nodo(materia.carpeta, habilidad.clave))) habilidades.set(nodo(materia.carpeta, habilidad.clave), habilidad);
      }
    }
  }
  const aristas = new Map<string, string[]>();
  const carpetaDe = new Map<string, string>();
  for (const materia of materias) {
    for (const tema of materia.temas) {
      for (const habilidad of tema.habilidades) {
        const desde = nodo(materia.carpeta, habilidad.clave);
        if (habilidades.get(desde) !== habilidad) continue; // repetida: ya se reportó
        carpetaDe.set(desde, materia.carpeta);
        const destinos: string[] = [];
        for (const ref of habilidad.prerrequisitos) {
          const hacia = nodo(ref.materia ?? materia.carpeta, ref.clave);
          if (habilidades.has(hacia)) destinos.push(hacia);
          else if (ref.materia && !carpetas.has(ref.materia)) {
            diag.error(habilidad.lugar.archivo, habilidad.lugar.linea, `el prerrequisito "${hacia}" de "${habilidad.clave}" no existe: no hay una materia "${ref.materia}" en el banco`);
          } else {
            const nombre = ref.materia ? hacia : ref.clave;
            diag.error(habilidad.lugar.archivo, habilidad.lugar.linea, `el prerrequisito "${nombre}" de "${habilidad.clave}" no existe${ref.materia ? "" : " en la materia"}`);
          }
        }
        aristas.set(desde, destinos);
      }
    }
  }

  // Búsqueda en profundidad: una arista hacia un nodo que está en el camino actual cierra un ciclo. Cada
  // ciclo se reporta una vez, en la habilidad cuyo prerrequisito lo cierra.
  const estado = new Map<string, "en-camino" | "listo">();
  const camino: string[] = [];
  const visitar = (actual: string) => {
    estado.set(actual, "en-camino");
    camino.push(actual);
    for (const siguiente of aristas.get(actual) ?? []) {
      const visto = estado.get(siguiente);
      if (visto === "en-camino") {
        const carpeta = carpetaDe.get(actual);
        const recorrido = [...camino.slice(camino.indexOf(siguiente)), siguiente]
          .map((n) => (n.startsWith(`${carpeta}/`) ? n.slice(`${carpeta}/`.length) : n))
          .join(" → ");
        const habilidad = habilidades.get(actual) as Habilidad;
        diag.error(habilidad.lugar.archivo, habilidad.lugar.linea, `ciclo de prerrequisitos: ${recorrido}`);
      } else if (!visto) visitar(siguiente);
    }
    camino.pop();
    estado.set(actual, "listo");
  };
  for (const n of aristas.keys()) if (!estado.has(n)) visitar(n);
}

/** Cobertura con las preguntas revisadas (con o sin --borradores) y evaluaciones activas. */
function calcularCobertura(materias: Materia[]): Cobertura {
  const cobertura: Cobertura = { habilidades: [], misconcepciones: [] };
  for (const materia of materias) {
    const revisadas = materia.temas.flatMap((t) => t.preguntas).filter((p) => p.estado === "revisada");
    const cumple = new Map<string, boolean>();
    for (const tema of materia.temas) {
      for (const habilidad of tema.habilidades) {
        const suyas = revisadas.filter((p) => p.habilidades.includes(habilidad.clave));
        const dificultades = [...new Set(suyas.map((p) => p.dificultad))].sort((a, b) => a - b);
        const ok = suyas.length >= MINIMO_REVISADAS && dificultades.length >= MINIMO_DIFICULTADES;
        cumple.set(habilidad.clave, ok);
        cobertura.habilidades.push({ materia: materia.carpeta, clave: habilidad.clave, revisadas: suyas.length, dificultades, cumple: ok });
      }
    }
    for (const tema of materia.temas) {
      for (const misconcepcion of tema.misconcepciones) {
        // Preguntas distintas: la misma trampa en dos opciones de una pregunta cuenta una vez.
        const preguntas = revisadas.filter((p) => p.opciones.some((o) => !o.correcta && o.misconcepcion === misconcepcion.clave)).length;
        cobertura.misconcepciones.push({
          materia: materia.carpeta,
          clave: misconcepcion.clave,
          habilidad: misconcepcion.habilidad,
          preguntas,
          cumple: preguntas >= MINIMO_PREGUNTAS_MISCONCEPCION,
        });
      }
    }
    // Activa: todas las habilidades declaradas en sus temas (ya expandidos) cumplen. Decisión de la dueña
    // del producto (30-sep-2026): la cobertura de misconcepciones se reporta pero no decide.
    for (const evaluacion of materia.evaluaciones) {
      const suyas = materia.temas.filter((t) => evaluacion.temas.includes(t.clave)).flatMap((t) => t.habilidades);
      evaluacion.activa = evaluacion.temas.length > 0 && suyas.every((h) => cumple.get(h.clave) === true);
    }
  }
  return cobertura;
}

/** Lee el banco del disco: cada carpeta de la raíz es una materia; los archivos sueltos de la raíz se ignoran. */
export function leerBanco(raiz: string): ResultadoBanco {
  const archivos: ArchivoBanco[] = [];
  const recorrer = (carpeta: string, relativa: string) => {
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = `${relativa}/${entrada.name}`;
      if (entrada.isDirectory()) recorrer(join(carpeta, entrada.name), ruta);
      else archivos.push({ ruta, texto: readFileSync(join(carpeta, entrada.name), "utf8") });
    }
  };
  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    if (entrada.isDirectory()) recorrer(join(raiz, entrada.name), entrada.name);
  }
  return analizarBanco(archivos);
}

// ---------------------------------------------------------------------------------------------------
// Conteos y reporte
// ---------------------------------------------------------------------------------------------------

/** Si la pregunta se carga: las revisadas siempre, los borradores con --borradores, las retiradas nunca. */
export function seCarga(p: Pregunta, opciones: OpcionesCarga): boolean {
  return p.estado === "revisada" || (opciones.borradores && p.estado === "borrador");
}

/** Filas que la carga dejaría en cada tabla. */
export function contar(banco: Banco, opciones: OpcionesCarga): Conteos {
  const conteos: Conteos = {
    materias: 0,
    temas: 0,
    habilidades: 0,
    prerrequisitos: 0,
    misconcepciones: 0,
    preguntas: 0,
    opciones: 0,
    preguntaHabilidad: 0,
    evaluaciones: 0,
    evaluacionTema: 0,
  };
  for (const materia of banco.materias) {
    conteos.materias += 1;
    conteos.evaluaciones += materia.evaluaciones.length;
    for (const evaluacion of materia.evaluaciones) conteos.evaluacionTema += evaluacion.temas.length;
    for (const tema of materia.temas) {
      conteos.temas += 1;
      conteos.habilidades += tema.habilidades.length;
      for (const habilidad of tema.habilidades) conteos.prerrequisitos += habilidad.prerrequisitos.length;
      conteos.misconcepciones += tema.misconcepciones.length;
      for (const pregunta of tema.preguntas) {
        if (!seCarga(pregunta, opciones)) continue;
        conteos.preguntas += 1;
        conteos.opciones += pregunta.opciones.length;
        conteos.preguntaHabilidad += pregunta.habilidades.length;
      }
    }
  }
  return conteos;
}

/** Nombre de la tabla de cada conteo, para el reporte. */
export const TABLAS: Record<keyof Conteos, string> = {
  materias: "materia",
  temas: "tema",
  habilidades: "habilidad",
  prerrequisitos: "habilidad_prerrequisito",
  misconcepciones: "misconcepcion",
  preguntas: "pregunta",
  opciones: "opcion",
  preguntaHabilidad: "pregunta_habilidad",
  evaluaciones: "evaluacion",
  evaluacionTema: "evaluacion_tema",
};

/** Las filas de unos conteos, alineadas: "  tabla   n". */
export function formatearConteos(conteos: Conteos): string[] {
  const claves = Object.keys(TABLAS) as (keyof Conteos)[];
  const ancho = Math.max(...claves.map((c) => TABLAS[c].length));
  return claves.map((c) => `  ${TABLAS[c].padEnd(ancho)}  ${String(conteos[c]).padStart(5)}`);
}

/** "a", "a y b", "a, b y c". */
function enumerar(xs: (string | number)[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

const plural = (n: number, singular: string, varios: string) => `${n} ${n === 1 ? singular : varios}`;

/** `archivo:linea  mensaje`: el formato que entienden los editores para saltar a la línea. */
export function formatearDiagnostico(d: Diagnostico): string {
  return `${d.archivo}:${d.linea}  ${d.mensaje}`;
}

/** El reporte del convertidor: conteos, cobertura, evaluaciones, avisos y errores (al final, para que se vean). */
export function formatearReporte(resultado: ResultadoBanco, opciones: OpcionesCarga): string {
  const { banco, errores, avisos, cobertura } = resultado;
  const salida: string[] = [];
  salida.push(`Banco de preguntas: ${plural(banco.materias.length, "materia", "materias")} (${banco.materias.map((m) => m.carpeta).join(", ") || "ninguna"})`);

  salida.push("");
  salida.push(
    opciones.borradores
      ? "Filas que se cargarían (revisadas y borradores, --borradores):"
      : "Filas que se cargarían (solo revisadas; con --borradores también los borradores):",
  );
  salida.push(...formatearConteos(contar(banco, opciones)));

  salida.push("");
  salida.push(`Cobertura por habilidad (meta: ${MINIMO_REVISADAS} preguntas revisadas o más, en ${MINIMO_DIFICULTADES} dificultades o más):`);
  const ancho = Math.max(0, ...cobertura.habilidades.map((h) => h.clave.length));
  for (const materia of banco.materias) {
    const suyas = cobertura.habilidades.filter((h) => h.materia === materia.carpeta);
    if (suyas.length === 0) continue;
    salida.push(`  ${materia.carpeta}`);
    for (const h of suyas) {
      const dificultades = h.dificultades.length === 0 ? "" : `, ${h.dificultades.length === 1 ? "dificultad" : "dificultades"} ${enumerar(h.dificultades)}`;
      salida.push(`    ${h.cumple ? "✓" : "✗"} ${h.clave.padEnd(ancho)}  ${plural(h.revisadas, "revisada", "revisadas")}${dificultades}`);
    }
  }
  const habilidadesQueCumplen = cobertura.habilidades.filter((h) => h.cumple).length;
  salida.push(`  Cumplen ${habilidadesQueCumplen} de ${cobertura.habilidades.length}.`);

  salida.push("");
  salida.push(`Cobertura por misconcepción (meta: ofrecida en ${MINIMO_PREGUNTAS_MISCONCEPCION} preguntas revisadas o más; se reporta, no decide):`);
  for (const materia of banco.materias) {
    const suyas = cobertura.misconcepciones.filter((m) => m.materia === materia.carpeta);
    if (suyas.length === 0) continue;
    const faltan = suyas.filter((m) => !m.cumple);
    const detalle = faltan.length === 0 ? "" : `. No cumplen: ${faltan.map((m) => `${m.clave} (${m.preguntas})`).join(", ")}`;
    salida.push(`  ${materia.carpeta}: cumplen ${suyas.length - faltan.length} de ${suyas.length}${detalle}`);
  }

  salida.push("");
  salida.push("Evaluaciones (activa si todas las habilidades de sus temas cumplen la cobertura):");
  let activas = 0;
  let total = 0;
  for (const materia of banco.materias) {
    for (const evaluacion of materia.evaluaciones) {
      total += 1;
      if (evaluacion.activa) activas += 1;
      const cabeza = `${materia.carpeta}/${evaluacion.clave} (${evaluacion.nombre}, semana ${evaluacion.semana}${evaluacion.acumulativa ? ", acumulativa" : ""}; temas: ${evaluacion.temas.join(", ") || "ninguno"})`;
      if (evaluacion.activa) {
        salida.push(`  ✓ ${cabeza}: activa`);
        continue;
      }
      const claves = new Set(materia.temas.filter((t) => evaluacion.temas.includes(t.clave)).flatMap((t) => t.habilidades.map((h) => h.clave)));
      const faltan = cobertura.habilidades
        .filter((c) => c.materia === materia.carpeta && claves.has(c.clave) && !c.cumple)
        .map((c) => `${c.clave} (${plural(c.revisadas, "revisada", "revisadas")}, ${plural(c.dificultades.length, "dificultad", "dificultades")})`);
      const motivo = evaluacion.temas.length === 0 ? "no tiene temas" : `no cumplen ${faltan.join(", ")}`;
      salida.push(`  ✗ ${cabeza}: inactiva; ${motivo}`);
    }
  }
  salida.push(`  Activas: ${activas} de ${total}.`);

  if (avisos.length > 0) {
    salida.push("");
    salida.push(`Avisos (${avisos.length}, no impiden la carga):`);
    salida.push(...avisos.map(formatearDiagnostico));
  }
  if (errores.length > 0) {
    salida.push("");
    salida.push(`Errores (${errores.length}):`);
    salida.push(...errores.map(formatearDiagnostico));
  }
  salida.push("");
  salida.push(
    errores.length > 0
      ? `✗ ${plural(errores.length, "error", "errores")}: el banco no se carga hasta corregirlos.`
      : `✓ Sin errores${avisos.length > 0 ? ` (${plural(avisos.length, "aviso", "avisos")})` : ""}.`,
  );
  return salida.join("\n");
}
