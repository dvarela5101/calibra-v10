/**
 * Materias y evaluaciones que el admin gestiona desde la app (HU-055, RN-20, D-62). Lectura de los formularios,
 * normalización, textos y mensajes según el error de la base. Es código puro, sin Next ni Supabase, para probarlo con
 * Vitest. La base vuelve a exigir lo mismo (el trigger `privado.al_escribir_materia` y la restricción de la semana) por
 * si alguien se salta la app.
 */

/** El largo del nombre, contado por puntos de código: es lo que cuenta `char_length` en la base. */
export const LARGO_MAXIMO_DEL_NOMBRE = 120;
/** El `integer` de la base: una semana más grande se rechaza antes de llegar. */
const SEMANA_MAXIMA = 2_147_483_647;

/** Cuatro letras, un guion y cuatro números, como `MATE-1214`. */
export const CODIGO_UNIANDES = /^[A-Z]{4}-[0-9]{4}$/;

export const ERRORES = {
  nombreDeMateria: "Escribe el nombre de la materia.",
  nombreDeEvaluacion: "Escribe el nombre de la evaluación.",
  nombreLargo: "El nombre puede tener hasta 120 caracteres.",
  /** Lo que dice el trigger de la base cuando el nombre no sirve y la app no lo había atrapado. */
  nombreDeLaBase: "El nombre debe tener entre 1 y 120 caracteres.",
  codigo: "El código debe tener cuatro letras, un guion y cuatro números, como MATE-1214.",
  semana: "La semana es un número entero mayor que 0.",
  nombreDeEvaluacionRepetido: "Ya hay una evaluación con ese nombre en esta materia.",
} as const;

export const AYUDA_DEL_CODIGO = "Cuatro letras, un guion y cuatro números, como MATE-1214.";
export const AVISO_DEL_CODIGO = "Los enlaces con el código anterior dejarán de encontrar esta materia.";

export const CAMBIOS_GUARDADOS = "Cambios guardados.";
export const GUARDAR_FALLO = "No pudimos guardar los cambios. Intenta de nuevo.";
export const SIN_PERMISO_PARA_CAMBIAR = "Tu cuenta no puede cambiar materias ni evaluaciones.";
export const BORRAR_FALLO = "No pudimos borrar. Intenta de nuevo.";
export const SIN_PERMISO_PARA_BORRAR = "Tu cuenta no puede borrar materias ni evaluaciones.";
export const MATERIA_NO_ENCONTRADA = "No encontramos esa materia. Recarga la página.";
export const EVALUACION_NO_ENCONTRADA = "No encontramos esa evaluación. Recarga la página.";
export const NO_SE_PUDO_COMPROBAR_EL_BORRADO = "No pudimos comprobar si se puede borrar. Recarga la página.";
export const NO_SE_PUDIERON_CARGAR = "No pudimos cargar las materias. Recarga la página; si sigue igual, avisa al equipo.";
export const SIN_MATERIAS = "Todavía no hay materias.";
export const SIN_EVALUACIONES = "Esta materia no tiene evaluaciones. Las trae el banco (carpeta contenido/).";

/** Mayúsculas y sin espacios en los bordes: como se guarda el código (el trigger de la base hace lo mismo). */
export function normalizarCodigo(texto: string): string {
  return texto.trim().toUpperCase();
}

const largoEnPuntosDeCodigo = (texto: string): number => Array.from(texto).length;

/** El error de un nombre ya recortado: vacío, o de más de 120 caracteres si no es el mismo que ya estaba guardado. */
function errorDeNombre(nombre: string, siEstaVacio: string, nombreGuardado: string | undefined): string | undefined {
  if (nombre === "") return siEstaVacio;
  const esElGuardado = nombreGuardado !== undefined && nombre === nombreGuardado.trim();
  if (largoEnPuntosDeCodigo(nombre) > LARGO_MAXIMO_DEL_NOMBRE && !esElGuardado) return ERRORES.nombreLargo;
  return undefined;
}

/** El campo de un formulario como texto; un archivo o un campo ausente cuentan como vacío. */
const campoDeTexto = (formulario: FormData, campo: string): string => {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor : "";
};

// --- Leer los formularios -------------------------------------------------------------------------------------------

export type DatosDeMateria = { nombre: string; codigo: string };
export type ErroresDeMateria = { nombre?: string; codigo?: string };
export type LecturaDeMateria =
  | { ok: true; datos: DatosDeMateria; valores: Record<string, string> }
  | { ok: false; errores: ErroresDeMateria; valores: Record<string, string> };

/**
 * Lee «Nombre» y «Código». `valores` es lo escrito tal cual, para que los campos lo conserven tras un error.
 *
 * El formato del código se exige al crear y cuando el código (normalizado) difiere del guardado, también normalizado: un
 * código histórico sin forma Uniandes (o con espacios y minúsculas) que no cambia no impide corregir el nombre. Igual el
 * largo del nombre: una materia del banco con más de 120 caracteres (`materia.md` no pone tope) puede cambiar de
 * código. La base hace lo mismo en `privado.al_escribir_materia` (HU-055, S3).
 */
export function leerMateria(
  formulario: FormData,
  guardada: { codigoGuardado?: string; nombreGuardado?: string } = {},
): LecturaDeMateria {
  const valores = { nombre: campoDeTexto(formulario, "nombre"), codigo: campoDeTexto(formulario, "codigo") };
  const nombre = valores.nombre.trim();
  const codigo = normalizarCodigo(valores.codigo);
  const errores: ErroresDeMateria = {};

  const errorDelNombre = errorDeNombre(nombre, ERRORES.nombreDeMateria, guardada.nombreGuardado);
  if (errorDelNombre) errores.nombre = errorDelNombre;

  const cambiaElCodigo = guardada.codigoGuardado === undefined || codigo !== normalizarCodigo(guardada.codigoGuardado);
  if (cambiaElCodigo && !CODIGO_UNIANDES.test(codigo)) errores.codigo = ERRORES.codigo;

  if (errores.nombre || errores.codigo) return { ok: false, errores, valores };
  return { ok: true, datos: { nombre, codigo }, valores };
}

export type DatosDeEvaluacion = { nombre: string; semana: number };
export type ErroresDeEvaluacion = { nombre?: string; semana?: string };
export type LecturaDeEvaluacion =
  | { ok: true; datos: DatosDeEvaluacion; valores: Record<string, string> }
  | { ok: false; errores: ErroresDeEvaluacion; valores: Record<string, string> };

/**
 * Lee «Nombre» y «Semana» de una evaluación. La semana es un entero mayor que 0 escrito con dígitos ASCII, hasta el
 * `integer` de la base y sin tope de semestre (HU-055, S5). El nombre se lee como el de la materia; si no cambió respecto
 * del guardado, su largo no se vuelve a exigir.
 */
export function leerEvaluacion(formulario: FormData, guardada: { nombreGuardado?: string } = {}): LecturaDeEvaluacion {
  const valores = { nombre: campoDeTexto(formulario, "nombre"), semana: campoDeTexto(formulario, "semana") };
  const nombre = valores.nombre.trim();
  const errores: ErroresDeEvaluacion = {};

  const errorDelNombre = errorDeNombre(nombre, ERRORES.nombreDeEvaluacion, guardada.nombreGuardado);
  if (errorDelNombre) errores.nombre = errorDelNombre;

  const textoDeLaSemana = valores.semana.trim();
  const semana = /^[0-9]+$/.test(textoDeLaSemana) ? Number(textoDeLaSemana) : Number.NaN;
  if (!Number.isSafeInteger(semana) || semana < 1 || semana > SEMANA_MAXIMA) errores.semana = ERRORES.semana;

  if (errores.nombre || errores.semana) return { ok: false, errores, valores };
  return { ok: true, datos: { nombre, semana }, valores };
}

/** ¿Otra evaluación de la misma materia ya se llama así? Compara sin espacios en los bordes y sin distinguir mayúsculas. */
export function nombreRepetido(nombre: string, hermanas: { id: string; nombre: string }[], idPropio: string): boolean {
  const clave = (texto: string) => texto.trim().toLowerCase();
  return hermanas.some((h) => h.id !== idPropio && clave(h.nombre) === clave(nombre));
}

// --- Textos de la lista y de la página -------------------------------------------------------------------------------

/** «Sin evaluaciones», «1 evaluación, 1 activa», «3 evaluaciones, ninguna activa»… */
export function textoDeEvaluaciones(total: number, activas: number): string {
  if (total === 0) return "Sin evaluaciones";
  const evaluaciones = total === 1 ? "1 evaluación" : `${total} evaluaciones`;
  const activos = activas === 0 ? "ninguna activa" : activas === 1 ? "1 activa" : `${activas} activas`;
  return `${evaluaciones}, ${activos}`;
}

/** «Semana 3 · Acumulativa · Activa»: lo que la persona ve de cada evaluación, escrito y no solo en color. */
export function lineaDeEvaluacion(e: { semana: number; acumulativo: boolean; activa: boolean }): string {
  return `Semana ${e.semana} · ${e.acumulativo ? "Acumulativa" : "No acumulativa"} · ${e.activa ? "Activa" : "Inactiva"}`;
}

export const textoDeMateriaCreada = (nombre: string, codigo: string): string => `Creamos la materia ${nombre} (${codigo}).`;
export const textoDeMateriaBorrada = (nombre: string): string => `Borramos la materia ${nombre}.`;
export const textoDeEvaluacionBorrada = (nombre: string): string => `Borramos la evaluación ${nombre}.`;
export const preguntaDeBorrarMateria = (nombre: string, codigo: string): string =>
  `¿Borrar la materia ${nombre} (${codigo})? No se puede deshacer.`;
export const preguntaDeBorrarEvaluacion = (nombre: string): string => `¿Borrar la evaluación ${nombre}? No se puede deshacer.`;

/** «Ya existe una materia con ese código: {nombre}.»; sin el nombre si no se pudo leer. */
export function textoDeCodigoRepetido(nombreDeQuienLoTiene: string | null): string {
  return nombreDeQuienLoTiene ? `Ya existe una materia con ese código: ${nombreDeQuienLoTiene}.` : "Ya existe una materia con ese código.";
}

/**
 * Un nombre que viaja en la URL (`?borrada=`, `?evaluacion_borrada=`) para el aviso de después de borrar: el primer
 * valor, sin espacios en los bordes y recortado a 120 caracteres. Es texto: quien lo pinta no lo interpreta como HTML.
 */
export function nombreDeLaConsulta(valor: string | string[] | undefined): string | null {
  const texto = (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
  if (texto === "") return null;
  return Array.from(texto).slice(0, LARGO_MAXIMO_DEL_NOMBRE).join("").trim() || null;
}

// --- Lo ligado ------------------------------------------------------------------------------------------------------

export type TipoDeBorrado = "materia" | "evaluacion";

/** Cada cosa que la base cuenta como ligada, en el orden fijo de `privado.ligado_de_*`, con cómo se nombra. */
const LIGADO: Record<TipoDeBorrado, { clave: string; palabra: string }[]> = {
  materia: [
    { clave: "evaluaciones", palabra: "evaluaciones" },
    { clave: "temas", palabra: "temas" },
    { clave: "certificados", palabra: "certificados" },
    { clave: "solicitudes", palabra: "solicitudes de monitor" },
    { clave: "diagnosticos", palabra: "diagnósticos" },
    { clave: "monitorias", palabra: "monitorías" },
  ],
  evaluacion: [
    { clave: "temas", palabra: "temas" },
    { clave: "diagnosticos", palabra: "diagnósticos" },
  ],
};

/** «a», «a y b», «a, b y c». */
function unirConY(palabras: string[]): string {
  if (palabras.length <= 1) return palabras.join("");
  return `${palabras.slice(0, -1).join(", ")} y ${palabras[palabras.length - 1]}`;
}

/** Lo ligado escrito para una persona, en el orden de la base. Una clave que este código no conoce se dice como viene. */
function listaDeLoLigado(ligado: string[], tipo: TipoDeBorrado): string {
  const conocidas = LIGADO[tipo];
  const palabras = conocidas.filter((c) => ligado.includes(c.clave)).map((c) => c.palabra);
  const desconocidas = ligado.filter((clave) => !conocidas.some((c) => c.clave === clave));
  return unirConY([...palabras, ...desconocidas]);
}

/** «No se puede borrar: tiene evaluaciones, temas y monitorías.» (solo lo que de verdad tiene). */
export function textoDeLoLigado(ligado: string[], tipo: TipoDeBorrado): string {
  return `No se puede borrar: tiene ${listaDeLoLigado(ligado, tipo)}.`;
}

/** Lo mismo, cuando alguien lo ligó entre que se abrió la página y se confirmó el borrado. */
export function textoDeLoLigadoAhora(ligado: string[], tipo: TipoDeBorrado): string {
  return `Ya no se puede borrar: tiene ${listaDeLoLigado(ligado, tipo)}. Recarga la página.`;
}

export type ResultadoDeBorrar =
  | { tipo: "borrada" }
  | { tipo: "no_existe" }
  | { tipo: "no_autorizado" }
  | { tipo: "ligada"; ligado: string[] };

/** Lo que responden `borrar_materia` y `borrar_evaluacion`: `borrada`, `no_existe`, `no_autorizado` o `ligada:a,b`. Otra cosa lanza. */
export function entenderResultadoDeBorrar(texto: unknown): ResultadoDeBorrar {
  if (texto === "borrada" || texto === "no_existe" || texto === "no_autorizado") return { tipo: texto };
  if (typeof texto === "string" && texto.startsWith("ligada:")) {
    const ligado = texto.slice("ligada:".length).split(",").filter((clave) => clave !== "");
    if (ligado.length > 0) return { tipo: "ligada", ligado };
  }
  throw new Error(`Respuesta inesperada al borrar: ${JSON.stringify(texto)}`);
}

// --- Errores de la base ---------------------------------------------------------------------------------------------

/** Lo que de un error de la base se lee: el código y la pista, nunca el `details`, que trae valores de la fila. */
export type ErrorDeLaBase = { code?: string | null; hint?: string | null };

export type ErrorDeEscritura =
  /** `23505`: el código ya lo tiene otra materia; quien lo muestra busca su nombre. */
  | { tipo: "codigo_repetido" }
  /** Un error de un campo: va junto a él. */
  | { tipo: "campo"; campo: "nombre" | "codigo" | "semana"; texto: string }
  /** Cualquier otro: va arriba del botón. */
  | { tipo: "general"; texto: string };

/**
 * El mensaje de un error al guardar. `23514` con la pista del trigger (`nombre`, `codigo`) o `22003` (la semana no cabe
 * en un `integer`) son del campo; `42501` es una cuenta sin permiso; lo demás, el error general.
 */
export function mensajeDeError(error: ErrorDeLaBase | null | undefined): ErrorDeEscritura {
  switch (error?.code) {
    case "23505":
      return { tipo: "codigo_repetido" };
    case "23514":
      if (error.hint === "nombre") return { tipo: "campo", campo: "nombre", texto: ERRORES.nombreDeLaBase };
      if (error.hint === "codigo") return { tipo: "campo", campo: "codigo", texto: ERRORES.codigo };
      if (error.hint === "semana") return { tipo: "campo", campo: "semana", texto: ERRORES.semana };
      return { tipo: "general", texto: GUARDAR_FALLO };
    case "22003":
      return { tipo: "campo", campo: "semana", texto: ERRORES.semana };
    case "42501":
      return { tipo: "general", texto: SIN_PERMISO_PARA_CAMBIAR };
    default:
      return { tipo: "general", texto: GUARDAR_FALLO };
  }
}
