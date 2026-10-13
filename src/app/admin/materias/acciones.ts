"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import {
  BORRAR_FALLO,
  CAMBIOS_GUARDADOS,
  ERRORES,
  EVALUACION_NO_ENCONTRADA,
  GUARDAR_FALLO,
  MATERIA_NO_ENCONTRADA,
  SIN_PERMISO_PARA_BORRAR,
  leerEvaluacion,
  leerMateria,
  mensajeDeError,
  nombreRepetido,
  normalizarCodigo,
  textoDeCodigoRepetido,
  textoDeLoLigadoAhora,
  textoDeMateriaCreada,
  type ErrorDeLaBase,
  type ErroresDeEvaluacion,
  type ErroresDeMateria,
} from "@/lib/materias/reglas";
import {
  borrarEvaluacion as borrarEvaluacionDeLaBase,
  borrarMateria as borrarMateriaDeLaBase,
  crearMateria,
  evaluacionGuardada,
  guardarEvaluacion as guardarEvaluacionEnLaBase,
  guardarMateria,
  materiaGuardada,
  nombresDeLasEvaluaciones,
  quienTieneElCodigo,
  type ResultadoDeBorrarEvaluacion,
  type ResultadoDeBorrarMateria,
} from "@/lib/materias/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-055 (D-62): el admin crea y corrige materias, corrige el nombre y la semana de sus evaluaciones y borra lo que no
 * tiene nada ligado. Todo con la sesión del admin, nunca con la llave secreta: las políticas y los permisos por columna de
 * la base son la defensa, y `borrar_materia` y `borrar_evaluacion` vuelven a comprobar lo ligado con la fila bloqueada.
 * Cada acción empieza por `exigirRol`, porque se puede llamar sin pasar por la página. `valores` devuelve lo escrito para
 * no vaciar el formulario tras un error.
 */
export type EstadoMateria = { errores: ErroresDeMateria; error: string | null; exito: string | null; valores: Record<string, string> };
export type EstadoEvaluacion = { errores: ErroresDeEvaluacion; error: string | null; exito: string | null; valores: Record<string, string> };
export type EstadoBorrado = { error: string | null };

const RUTA = "/admin/materias";
const RUTA_DE_UNA_MATERIA = "/admin/materias/[id]";

/** El cliente de la sesión del admin. */
async function clienteDeLaSesion() {
  const supabase = await crearClienteServidor();
  if (!supabase) throw new Error("Faltan las variables de Supabase.");
  return supabase;
}

/** Lo que va al registro: el código del error y nada de sus detalles, que traen valores de la fila. */
function registrar(que: string, error: unknown) {
  console.error(`[materias] ${que}:`, error instanceof Error ? error.message : error);
}

/** Un campo del formulario tal cual se escribió; un archivo o un campo ausente cuentan como vacío. */
const crudo = (datos: FormData, campo: string): string => {
  const valor = datos.get(campo);
  return typeof valor === "string" ? valor : "";
};
const texto = (datos: FormData, campo: string): string => crudo(datos, campo).trim();
const valoresDe = (datos: FormData, campos: string[]): Record<string, string> => Object.fromEntries(campos.map((c) => [c, crudo(datos, c)]));

const conErrorGeneral = (valores: Record<string, string>, error: string): EstadoMateria => ({ errores: {}, error, exito: null, valores });

/**
 * Lo que dice la pantalla cuando la base rechazó guardar una materia. Un código repetido nombra a quien lo tiene; si eso
 * no se puede leer, el mensaje sale sin el nombre.
 */
async function estadoDeErrorDeMateria(
  supabase: Awaited<ReturnType<typeof clienteDeLaSesion>>,
  error: ErrorDeLaBase,
  valores: Record<string, string>,
  idPropio?: string,
): Promise<EstadoMateria> {
  const entendido = mensajeDeError(error);
  if (entendido.tipo === "codigo_repetido") {
    const nombre = await quienTieneElCodigo(supabase, normalizarCodigo(valores.codigo), idPropio);
    return { errores: { codigo: textoDeCodigoRepetido(nombre) }, error: null, exito: null, valores };
  }
  if (entendido.tipo === "campo" && entendido.campo !== "semana") {
    return { errores: { [entendido.campo]: entendido.texto }, error: null, exito: null, valores };
  }
  // Lo que no tiene un aviso propio no lo puede corregir el admin: queda en el registro para diagnosticarlo.
  const mensaje = entendido.tipo === "general" ? entendido.texto : GUARDAR_FALLO;
  if (mensaje === GUARDAR_FALLO) registrar("no se pudo guardar la materia", `código ${error.code ?? "sin código"}`);
  return conErrorGeneral(valores, mensaje);
}

/** Crea una materia con el código en mayúsculas. Puede nacer sin evaluaciones (D-62 b): las trae el banco. */
export async function crear(_anterior: EstadoMateria, datos: FormData): Promise<EstadoMateria> {
  await exigirRol("admin", RUTA);
  const lectura = leerMateria(datos);
  if (!lectura.ok) return { errores: lectura.errores, error: null, exito: null, valores: lectura.valores };

  try {
    const supabase = await clienteDeLaSesion();
    const resultado = await crearMateria(supabase, lectura.datos);
    if (resultado.tipo === "error") return await estadoDeErrorDeMateria(supabase, resultado.error, lectura.valores);
    revalidatePath(RUTA);
    return { errores: {}, error: null, exito: textoDeMateriaCreada(resultado.fila.nombre, resultado.fila.codigo), valores: {} };
  } catch (error) {
    registrar("no se pudo crear la materia", error);
    return conErrorGeneral(lectura.valores, GUARDAR_FALLO);
  }
}

/** Cambia el nombre y el código de una materia. Sus certificados, franjas, monitorías y demás siguen ligados por el `id`. */
export async function guardar(_anterior: EstadoMateria, datos: FormData): Promise<EstadoMateria> {
  await exigirRol("admin", RUTA);
  const valores = valoresDe(datos, ["nombre", "codigo"]);
  const id = texto(datos, "id");
  if (!esUuid(id)) return conErrorGeneral(valores, MATERIA_NO_ENCONTRADA);

  try {
    const supabase = await clienteDeLaSesion();
    // El formato del código se exige solo si cambia, y el largo del nombre también: se compara con lo guardado en la base.
    const actual = await materiaGuardada(supabase, id);
    if (!actual) return conErrorGeneral(valores, MATERIA_NO_ENCONTRADA);
    const lectura = leerMateria(datos, { codigoGuardado: actual.codigo, nombreGuardado: actual.nombre });
    if (!lectura.ok) return { errores: lectura.errores, error: null, exito: null, valores: lectura.valores };

    const resultado = await guardarMateria(supabase, id, lectura.datos);
    if (resultado.tipo === "no_existe") return conErrorGeneral(valores, MATERIA_NO_ENCONTRADA);
    if (resultado.tipo === "error") return await estadoDeErrorDeMateria(supabase, resultado.error, valores, id);
    revalidatePath(RUTA);
    revalidatePath(RUTA_DE_UNA_MATERIA, "page");
    return {
      errores: {},
      error: null,
      exito: CAMBIOS_GUARDADOS,
      valores: { nombre: resultado.fila.nombre, codigo: resultado.fila.codigo },
    };
  } catch (error) {
    registrar("no se pudo guardar la materia", error);
    return conErrorGeneral(valores, GUARDAR_FALLO);
  }
}

const conErrorGeneralDeEvaluacion = (valores: Record<string, string>, error: string): EstadoEvaluacion => ({
  errores: {},
  error,
  exito: null,
  valores,
});

/** Cambia el nombre y la semana de una evaluación. Su estado activo, sus temas y si es acumulativa no se tocan (D-62 b). */
export async function guardarEvaluacion(_anterior: EstadoEvaluacion, datos: FormData): Promise<EstadoEvaluacion> {
  await exigirRol("admin", RUTA);
  const valores = valoresDe(datos, ["nombre", "semana"]);
  const id = texto(datos, "id");
  if (!esUuid(id)) return conErrorGeneralDeEvaluacion(valores, EVALUACION_NO_ENCONTRADA);

  try {
    const supabase = await clienteDeLaSesion();
    const actual = await evaluacionGuardada(supabase, id);
    if (!actual) return conErrorGeneralDeEvaluacion(valores, EVALUACION_NO_ENCONTRADA);

    const lectura = leerEvaluacion(datos, { nombreGuardado: actual.nombre });
    const errores: ErroresDeEvaluacion = lectura.ok ? {} : { ...lectura.errores };
    // Sin llave única en la base (los fixtures repiten nombres): un nombre nuevo no repite el de otra de la misma materia. Si el
    // nombre no cambió no se compara: corregir solo la semana de una evaluación cuyo nombre ya comparte otra hermana (el banco no
    // exige nombres únicos) tiene que poder guardarse.
    const nombre = lectura.ok ? lectura.datos.nombre : lectura.valores.nombre.trim();
    const cambiaElNombre = nombre !== actual.nombre.trim();
    if (!errores.nombre && nombre !== "" && cambiaElNombre) {
      const hermanas = await nombresDeLasEvaluaciones(supabase, actual.idMateria);
      if (nombreRepetido(nombre, hermanas, id)) errores.nombre = ERRORES.nombreDeEvaluacionRepetido;
    }
    if (!lectura.ok || errores.nombre) return { errores, error: null, exito: null, valores };

    const resultado = await guardarEvaluacionEnLaBase(supabase, id, lectura.datos);
    if (resultado.tipo === "no_existe") return conErrorGeneralDeEvaluacion(valores, EVALUACION_NO_ENCONTRADA);
    if (resultado.tipo === "error") {
      const entendido = mensajeDeError(resultado.error);
      if (entendido.tipo === "campo" && entendido.campo !== "codigo") {
        return { errores: { [entendido.campo]: entendido.texto }, error: null, exito: null, valores };
      }
      // Lo que no tiene un aviso propio no lo puede corregir el admin: queda en el registro para diagnosticarlo.
      const mensaje = entendido.tipo === "general" ? entendido.texto : GUARDAR_FALLO;
      if (mensaje === GUARDAR_FALLO) registrar("no se pudo guardar la evaluación", `código ${resultado.error.code ?? "sin código"}`);
      return conErrorGeneralDeEvaluacion(valores, mensaje);
    }
    revalidatePath(RUTA);
    revalidatePath(RUTA_DE_UNA_MATERIA, "page");
    return {
      errores: {},
      error: null,
      exito: CAMBIOS_GUARDADOS,
      valores: { nombre: resultado.fila.nombre, semana: String(resultado.fila.semana) },
    };
  } catch (error) {
    registrar("no se pudo guardar la evaluación", error);
    return conErrorGeneralDeEvaluacion(valores, GUARDAR_FALLO);
  }
}

/**
 * Borra una materia que no tiene nada ligado (D-62 c). La base lo vuelve a comprobar con la fila bloqueada: si entre que
 * se abrió la página y se confirmó alguien ligó algo, no borra y se le dice qué. Con éxito vuelve a la lista con el nombre
 * en la URL, como `/admin/equipo?desactivado=`; el `redirect` va fuera del `try`.
 */
export async function borrar(_anterior: EstadoBorrado, datos: FormData): Promise<EstadoBorrado> {
  await exigirRol("admin", RUTA);
  const id = texto(datos, "id");
  if (!esUuid(id)) return { error: MATERIA_NO_ENCONTRADA };

  let resultado: ResultadoDeBorrarMateria;
  try {
    resultado = await borrarMateriaDeLaBase(await clienteDeLaSesion(), id);
  } catch (error) {
    registrar("no se pudo borrar la materia", error);
    return { error: BORRAR_FALLO };
  }
  switch (resultado.tipo) {
    case "no_existe":
      return { error: MATERIA_NO_ENCONTRADA };
    case "no_autorizado":
      return { error: SIN_PERMISO_PARA_BORRAR };
    case "ligada":
      return { error: textoDeLoLigadoAhora(resultado.ligado, "materia") };
  }
  revalidatePath(RUTA);
  revalidatePath(RUTA_DE_UNA_MATERIA, "page");
  redirect(`${RUTA}?${new URLSearchParams({ borrada: resultado.nombre })}`);
}

/** Borra una evaluación sin temas ni diagnósticos (D-62 c), con las mismas garantías que `borrar`. Vuelve a la página de su materia. */
export async function borrarEvaluacion(_anterior: EstadoBorrado, datos: FormData): Promise<EstadoBorrado> {
  await exigirRol("admin", RUTA);
  const id = texto(datos, "id");
  if (!esUuid(id)) return { error: EVALUACION_NO_ENCONTRADA };

  let resultado: ResultadoDeBorrarEvaluacion;
  try {
    resultado = await borrarEvaluacionDeLaBase(await clienteDeLaSesion(), id);
  } catch (error) {
    registrar("no se pudo borrar la evaluación", error);
    return { error: BORRAR_FALLO };
  }
  switch (resultado.tipo) {
    case "no_existe":
      return { error: EVALUACION_NO_ENCONTRADA };
    case "no_autorizado":
      return { error: SIN_PERMISO_PARA_BORRAR };
    case "ligada":
      return { error: textoDeLoLigadoAhora(resultado.ligado, "evaluacion") };
  }
  revalidatePath(RUTA);
  revalidatePath(RUTA_DE_UNA_MATERIA, "page");
  redirect(`${RUTA}/${resultado.idMateria}?${new URLSearchParams({ evaluacion_borrada: resultado.nombre })}`);
}
