// Chequeo de copia de una materia (HU-061, paso 6 de contenido/PROCESO.md; D-50 g).
//
//   node .claude/skills/reprocesar-materia/chequeo-copia.mjs <materia> --texto <carpeta> [opciones]
//
//   <materia>          carpeta de la materia en contenido/ (calculo-diferencial)
//   --texto <carpeta>  texto extraído del material (archivos .txt o .md, también en subcarpetas), en la
//                      carpeta de trabajo y nunca dentro del clon. Lo que se leyó como imagen debe estar
//                      transcrito ahí: el chequeo solo ve lo que hay en esa carpeta.
//   --banco <ruta>     otra carpeta de banco (por defecto, contenido/ del clon)
//   --palabras N       largo de la secuencia compartida que cuenta como copia (por defecto 8)
//   --huella N         largo mínimo, en caracteres, de un fragmento matemático para la pista (por defecto 8)
//   --desde-id N       la pista solo mira las preguntas P<N> en adelante (las nuevas); sin esto mira todas
//   --detalle          agrega de qué archivo del texto extraído salió cada coincidencia. Es para la carpeta
//                      de trabajo: no lo pegues en el PR ni en el registro de la HU
//   --json             imprime el resultado como JSON
//
// Hace dos cosas:
//   1. Compara TODO el texto de la carpeta de la materia (enunciados, opciones, soluciones, habilidades,
//      misconcepciones y textos libres) con el texto extraído, palabra por palabra una vez normalizado
//      (minúsculas, sin tildes, sin signos; las letras y los números pegados se separan, así que "x²-4"
//      de un PDF y "$x^2-4$" de una pregunta dan las mismas palabras). Una secuencia de 8 palabras o más
//      iguales es una copia.
//   2. Pista para el verificador: marca las preguntas cuyo enunciado trae un fragmento matemático (con al
//      menos 2 números) idéntico a uno del material. Es una heurística: sirve para saber qué mirar, no
//      prueba que no hay copia. La decisión "misma función con los mismos números" (D-50 g) es del
//      verificador, que sí lee el material.
//
// Nunca imprime texto del material, solo cifras y el lugar de la coincidencia en el texto nuevo.
//
// Salida: 0 sin coincidencias; 2 con alguna secuencia compartida o pregunta marcada; 1 si el uso, el
// banco o la carpeta de texto tienen un problema.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatearDiagnostico, leerBanco } from "../../../scripts/contenido/banco.mts";

export const BANCO_POR_DEFECTO = join(import.meta.dirname, "..", "..", "..", "contenido");
export const PALABRAS_POR_DEFECTO = 8;
export const HUELLA_POR_DEFECTO = 8;

const USO =
  "Uso: node .claude/skills/reprocesar-materia/chequeo-copia.mjs <materia> --texto <carpeta> [--banco <ruta>] [--palabras N] [--huella N] [--desde-id N] [--detalle] [--json]";

const SEPARADOR = " · ";
const FUNCIONES = new Set(["lim", "sin", "sen", "cos", "tan", "sec", "csc", "cot", "ln", "log", "exp"]);
// Palabras de dos letras que no son variables: en un fragmento matemático lo cortan.
const PALABRAS_CORTAS = new Set(["de", "en", "es", "la", "el", "lo", "un", "se", "si", "no", "su", "al", "ni", "ya", "me", "te", "mi", "tu", "le"]);
const RE_OPCION = /^\s*-\s*[A-D]\)\s*(.*)$/;
const RE_COLA_OPCION = /^(.*?)(?: · (?:CORRECTA|\[[a-z0-9_-]+\](?: (.*))?))?$/;

/**
 * Las palabras de un texto, normalizadas: minúsculas, sin tildes (NFKD también baja ² a 2 y separa las
 * ligaduras de los PDF), sin comandos de TeX (salvo los nombres de función), y separando letras de números.
 */
export function tokenizar(texto) {
  const t = texto
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\([a-z]+)/g, (_, nombre) => (FUNCIONES.has(nombre) ? ` ${nombre} ` : " "));
  return (t.match(/[a-z]+|[0-9]+/g) ?? []).map((p) => (p === "sen" ? "sin" : p));
}

/**
 * El texto de un archivo del banco como una lista de palabras con su línea. `null` es una barrera: una
 * secuencia no la cruza. Se saltan el frontmatter y los encabezados `###`, que son metadatos, y de las
 * líneas `kc:`, `mc:` y de opciones solo se toma el texto escrito por una persona.
 */
export function flujoDeArchivo(texto) {
  const palabras = [];
  const lineas = [];
  const poner = (p, linea) => {
    palabras.push(p);
    lineas.push(linea);
  };
  const barrera = (linea) => {
    if (palabras.length > 0 && palabras[palabras.length - 1] !== null) poner(null, linea);
  };
  const segmento = (s, linea) => {
    barrera(linea);
    for (const p of tokenizar(s)) poner(p, linea);
    barrera(linea);
  };

  const todas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  let i = 0;
  if (todas[0]?.trim() === "---") {
    i = 1;
    while (i < todas.length && todas[i].trim() !== "---") i += 1;
    i += 1;
  }
  for (; i < todas.length; i += 1) {
    const linea = i + 1;
    const x = todas[i];
    if (x.trim() === "" || /^###(\s|$)/.test(x)) {
      barrera(linea);
    } else if (/^kc:\s/.test(x)) {
      segmento(x.split(SEPARADOR)[1] ?? "", linea);
    } else if (/^mc:\s/.test(x)) {
      segmento(x.split(SEPARADOR).slice(2).join(SEPARADOR), linea);
    } else if (RE_OPCION.test(x)) {
      const cola = RE_COLA_OPCION.exec(x.match(RE_OPCION)[1]);
      segmento(cola?.[1] ?? "", linea);
      if (cola?.[2]) segmento(cola[2], linea);
    } else {
      for (const p of tokenizar(x.replace(/^\s*solución:\s*/i, ""))) poner(p, linea);
    }
  }
  return { palabras, lineas };
}

/** Los tramos de un enunciado que parecen matemática: sin palabras de la lengua y con al menos 2 números. */
export function fragmentosMatematicos(enunciado, huella = HUELLA_POR_DEFECTO) {
  const fragmentos = [];
  let actual = [];
  const cerrar = () => {
    const numeros = actual.filter((p) => /^[0-9]+$/.test(p)).length;
    if (numeros >= 2 && actual.join("").length >= huella) fragmentos.push(actual);
    actual = [];
  };
  for (const p of tokenizar(enunciado)) {
    const esPalabra = /^[a-z]+$/.test(p) && ((p.length >= 3 && !FUNCIONES.has(p)) || PALABRAS_CORTAS.has(p));
    if (esPalabra) cerrar();
    else actual.push(p);
  }
  cerrar();
  return fragmentos;
}

/**
 * Compara el texto nuevo con el extraído. Es pura: no toca el disco.
 * `nuevos` y `fuentes` son listas de { ruta, texto }; `preguntas`, de { clave, enunciado, archivo, linea }.
 */
export function chequear({ nuevos, fuentes, preguntas = [], palabras = PALABRAS_POR_DEFECTO, huella = HUELLA_POR_DEFECTO }) {
  // Índice de las ventanas de `palabras` palabras del texto nuevo.
  const flujos = nuevos.map((n) => ({ ruta: n.ruta, ...flujoDeArchivo(n.texto) }));
  const indice = new Map();
  const iniciales = new Set();
  let palabrasNuevas = 0;
  flujos.forEach((f, idx) => {
    palabrasNuevas += f.palabras.filter((p) => p !== null).length;
    for (let i = 0; i + palabras <= f.palabras.length; i += 1) {
      const ventana = f.palabras.slice(i, i + palabras);
      if (ventana.includes(null)) continue;
      const llave = ventana.join(" ");
      if (!indice.has(llave)) indice.set(llave, []);
      indice.get(llave).push({ archivo: idx, inicio: i });
      iniciales.add(ventana[0]);
    }
  });

  const cubiertas = flujos.map(() => new Map()); // inicio de ventana -> fuentes que la traen
  const fragmentos = preguntas.map((q) => ({ q, lista: fragmentosMatematicos(q.enunciado, huella), coincidencias: 0 }));
  let palabrasFuente = 0;

  for (const fuente of fuentes) {
    const tokens = tokenizar(fuente.texto);
    palabrasFuente += tokens.length;
    for (let j = 0; j + palabras <= tokens.length; j += 1) {
      if (!iniciales.has(tokens[j])) continue;
      const aciertos = indice.get(tokens.slice(j, j + palabras).join(" "));
      if (!aciertos) continue;
      for (const { archivo, inicio } of aciertos) {
        const previas = cubiertas[archivo].get(inicio) ?? [];
        if (previas.length < 3) previas.push({ ruta: fuente.ruta, posicion: j });
        cubiertas[archivo].set(inicio, previas);
      }
    }
    if (fragmentos.some((f) => f.lista.length > 0)) {
      const cadena = `,${tokens.join(",")},`;
      for (const f of fragmentos) {
        for (const frag of f.lista) if (cadena.includes(`,${frag.join(",")},`)) f.coincidencias += 1;
      }
    }
  }

  // Ventanas seguidas del texto nuevo = una sola secuencia compartida.
  const secuencias = [];
  cubiertas.forEach((mapa, idx) => {
    const inicios = [...mapa.keys()].sort((a, b) => a - b);
    let desde = 0;
    while (desde < inicios.length) {
      let hasta = desde;
      while (hasta + 1 < inicios.length && inicios[hasta + 1] === inicios[hasta] + 1) hasta += 1;
      secuencias.push({
        ruta: flujos[idx].ruta,
        linea: flujos[idx].lineas[inicios[desde]],
        palabras: inicios[hasta] - inicios[desde] + palabras,
        fuentes: mapa.get(inicios[desde]),
      });
      desde = hasta + 1;
    }
  });

  const pistas = fragmentos
    .filter((f) => f.coincidencias > 0)
    .map((f) => ({ pregunta: f.q.clave, ruta: f.q.archivo, linea: f.q.linea, fragmentos: f.coincidencias }));
  return { palabrasNuevas, palabrasFuente, archivosNuevos: nuevos.length, archivosFuente: fuentes.length, preguntasMiradas: preguntas.length, secuencias, pistas };
}

/** El reporte en texto. Sin `detalle` no dice de qué archivo del material salió nada. */
export function formatear(materia, r, { palabras, detalle }) {
  const s = [`Chequeo de copia de ${materia}`];
  s.push(`Texto extraído leído: ${r.archivosFuente} archivos, ${r.palabrasFuente} palabras`);
  s.push(`Texto nuevo revisado: ${r.archivosNuevos} archivos, ${r.palabrasNuevas} palabras`);
  s.push(`Secuencias compartidas de ${palabras} palabras o más: ${r.secuencias.length}`);
  for (const x of r.secuencias) {
    const de = detalle ? `; texto extraído: ${x.fuentes.map((f) => `${f.ruta} (palabra ${f.posicion})`).join(", ")}` : "";
    s.push(`  ${x.ruta}:${x.linea}  ${x.palabras} palabras${de}`);
  }
  s.push(`Preguntas con un fragmento matemático igual al del material (pista para el verificador): ${r.pistas.length} de ${r.preguntasMiradas}`);
  for (const x of r.pistas) s.push(`  ${x.ruta}:${x.linea}  ${x.pregunta}  ${x.fragmentos} fragmento${x.fragmentos === 1 ? "" : "s"}`);
  s.push("");
  s.push(
    r.secuencias.length === 0 && r.pistas.length === 0
      ? "Sin coincidencias. La pista no reemplaza al verificador."
      : "Hay coincidencias: reescribe esos textos y vuelve a correr el chequeo. Las preguntas marcadas pasan al verificador.",
  );
  return s.join("\n");
}

/** Archivos de texto de una carpeta, con la ruta relativa a ella. */
function leerTextos(carpeta, extensiones) {
  const salida = [];
  const recorrer = (actual) => {
    for (const e of readdirSync(actual, { withFileTypes: true })) {
      const ruta = join(actual, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (extensiones.some((x) => e.name.toLowerCase().endsWith(x))) salida.push({ ruta: relative(carpeta, ruta).split("\\").join("/"), texto: readFileSync(ruta, "utf8") });
    }
  };
  recorrer(carpeta);
  return salida;
}

/** Lee los argumentos. Devuelve un texto si hay uno que no entiende. */
export function leerArgumentos(argv) {
  const a = { materia: null, texto: null, banco: BANCO_POR_DEFECTO, palabras: PALABRAS_POR_DEFECTO, huella: HUELLA_POR_DEFECTO, desdeId: null, detalle: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--detalle") a.detalle = true;
    else if (x === "--json") a.json = true;
    else if (["--texto", "--banco", "--palabras", "--huella", "--desde-id"].includes(x)) {
      const v = argv[i + 1];
      i += 1;
      if (!v || v.startsWith("--")) return `Falta el valor después de ${x}.`;
      if (x === "--texto") a.texto = resolve(v);
      else if (x === "--banco") a.banco = resolve(v);
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) return `${x} pide un entero positivo.`;
        if (x === "--palabras") a.palabras = n;
        else if (x === "--huella") a.huella = n;
        else a.desdeId = n;
      }
    } else if (x.startsWith("--")) return `No entiendo el argumento "${x}".`;
    else if (a.materia === null) a.materia = x;
    else return `Sobra el argumento "${x}".`;
  }
  if (a.materia === null) return "Falta la materia.";
  if (a.texto === null) return "Falta --texto <carpeta>.";
  return a;
}

/** Corre el script y devuelve el código de salida. */
export function principal(argv) {
  const a = leerArgumentos(argv);
  if (typeof a === "string") {
    console.error(`${a}\n${USO}`);
    return 1;
  }
  for (const [nombre, ruta] of [["del banco", a.banco], ["del texto extraído", a.texto]]) {
    if (!existsSync(ruta) || !statSync(ruta).isDirectory()) {
      console.error(`No encuentro la carpeta ${nombre}: ${ruta}`);
      return 1;
    }
  }
  const resultado = leerBanco(a.banco);
  if (resultado.errores.length > 0) {
    console.error(`El banco tiene ${resultado.errores.length} errores; corrige con npm run contenido:validar antes del chequeo:`);
    for (const e of resultado.errores.slice(0, 10)) console.error(`  ${formatearDiagnostico(e)}`);
    return 1;
  }
  const materia = resultado.banco.materias.find((m) => m.carpeta === a.materia);
  if (!materia) {
    console.error(`No hay una materia "${a.materia}" en el banco. Hay: ${resultado.banco.materias.map((m) => m.carpeta).join(", ")}.`);
    return 1;
  }
  const fuentes = leerTextos(a.texto, [".txt", ".md"]);
  if (fuentes.length === 0) {
    console.error(`No hay archivos .txt ni .md en ${a.texto}: sin texto extraído el chequeo no vale.`);
    return 1;
  }

  const nuevos = leerTextos(join(a.banco, a.materia), [".md"]).map((n) => ({ ...n, ruta: `${a.materia}/${n.ruta}` }));
  const numero = (clave) => {
    const m = /^P(\d+)$/.exec(clave);
    return m ? Number(m[1]) : null;
  };
  const preguntas = materia.temas
    .flatMap((t) => t.preguntas)
    .filter((p) => a.desdeId === null || (numero(p.clave) ?? 0) >= a.desdeId)
    .map((p) => ({ clave: p.clave, enunciado: p.enunciado, archivo: p.lugar.archivo, linea: p.lugar.linea }));

  const r = chequear({ nuevos, fuentes, preguntas, palabras: a.palabras, huella: a.huella });
  if (!a.detalle) for (const x of r.secuencias) delete x.fuentes;
  console.log(a.json ? JSON.stringify(r, null, 2) : formatear(a.materia, r, { palabras: a.palabras, detalle: a.detalle }));
  return r.secuencias.length === 0 && r.pistas.length === 0 ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2));
}
