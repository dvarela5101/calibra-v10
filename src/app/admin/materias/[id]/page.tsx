import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import {
  NO_SE_PUDIERON_CARGAR,
  NO_SE_PUDO_COMPROBAR_EL_BORRADO,
  SIN_EVALUACIONES,
  lineaDeEvaluacion,
  nombreDeLaConsulta,
  preguntaDeBorrarEvaluacion,
  preguntaDeBorrarMateria,
  textoDeEvaluacionBorrada,
  textoDeLoLigado,
} from "@/lib/materias/reglas";
import { cargarMateria, ligadoDeEvaluacion, ligadoDeMateria, type EvaluacionDeLaMateria, type MateriaConEvaluaciones } from "@/lib/materias/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { BorrarConConfirmacion } from "../BorrarConConfirmacion";
import { FormularioEvaluacion } from "../FormularioEvaluacion";
import { FormularioMateria } from "../FormularioMateria";
import estilos from "../materias.module.css";

export const metadata: Metadata = { title: "Materia · Calibra" };

const EYEBROW = "Materias y evaluaciones";

/** Lo ligado de una materia o de una evaluación; `null` si no se pudo leer (y entonces no se ofrece borrar: falla cerrada). */
type Ligado = string[] | null;

async function leerLigado(que: string, lectura: () => Promise<string[]>): Promise<Ligado> {
  try {
    return await lectura();
  } catch (error) {
    console.error(`[materias] no se pudo leer lo ligado a ${que}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * HU-055 (D-62): la materia con sus datos para corregir, sus evaluaciones por semana (nombre y semana se corrigen; lo
 * demás lo trae el banco) y el borrado. El botón de borrar sale solo cuando la base dijo que no hay nada ligado; con algo
 * ligado, la página dice qué. Si no se pudo preguntar lo ligado, no hay botón y se avisa. Un `id` que no es UUID o que no
 * existe da la página «no encontrada». El borrado de una evaluación vuelve aquí con su nombre en `?evaluacion_borrada=`.
 */
export default async function MateriaYSusEvaluaciones({ params, searchParams }: PageProps<"/admin/materias/[id]">) {
  const { id } = await params;
  await exigirRol("admin", `/admin/materias/${id}`);
  if (!esUuid(id)) notFound();
  const evaluacionBorrada = nombreDeLaConsulta((await searchParams).evaluacion_borrada);

  let materia: MateriaConEvaluaciones | null;
  let ligadoDeLaMateria: Ligado = null;
  let ligadoDeCadaEvaluacion: Ligado[] = [];
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    materia = await cargarMateria(supabase, id);
    if (materia) {
      [ligadoDeLaMateria, ...ligadoDeCadaEvaluacion] = await Promise.all([
        leerLigado("la materia", () => ligadoDeMateria(supabase, id)),
        ...materia.evaluaciones.map((e) => leerLigado("la evaluación", () => ligadoDeEvaluacion(supabase, e.id))),
      ]);
    }
  } catch (error) {
    console.error("[materias] no se pudo leer la materia:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar la materia">
        <p role="alert" className={formulario.error}>
          {NO_SE_PUDIERON_CARGAR}
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!materia) notFound();

  return (
    <Pantalla eyebrow={EYEBROW} titulo={materia.nombre}>
      {evaluacionBorrada && (
        <p role="status" className={formulario.exito}>
          {textoDeEvaluacionBorrada(evaluacionBorrada)}
        </p>
      )}

      <section aria-labelledby="datos" className={estilos.seccion}>
        <h2 id="datos" className={estilos.titulo}>
          Datos de la materia
        </h2>
        <FormularioMateria modo="editar" materia={{ id: materia.id, nombre: materia.nombre, codigo: materia.codigo }} />
      </section>

      <section aria-labelledby="evaluaciones" className={estilos.seccion}>
        <h2 id="evaluaciones" className={estilos.titulo}>
          Evaluaciones ({materia.evaluaciones.length})
        </h2>
        {materia.evaluaciones.length === 0 ? (
          <p className={formulario.ayuda}>{SIN_EVALUACIONES}</p>
        ) : (
          <ul className={estilos.lista}>
            {materia.evaluaciones.map((e, i) => (
              <TarjetaDeEvaluacion key={e.id} evaluacion={e} ligado={ligadoDeCadaEvaluacion[i]} />
            ))}
          </ul>
        )}
      </section>

      <div className={estilos.seccion}>
        {ligadoDeLaMateria === null ? (
          <p role="alert" className={formulario.error}>
            {NO_SE_PUDO_COMPROBAR_EL_BORRADO}
          </p>
        ) : ligadoDeLaMateria.length > 0 ? (
          <p className={estilos.dato}>{textoDeLoLigado(ligadoDeLaMateria, "materia")}</p>
        ) : (
          <BorrarConConfirmacion tipo="materia" id={materia.id} pregunta={preguntaDeBorrarMateria(materia.nombre, materia.codigo)} etiqueta="Borrar materia" />
        )}
      </div>

      <Link href="/admin/materias" className={formulario.enlace}>
        Volver a las materias
      </Link>
      <VolverALaBandeja />
    </Pantalla>
  );
}

function TarjetaDeEvaluacion({ evaluacion: e, ligado }: { evaluacion: EvaluacionDeLaMateria; ligado: Ligado }) {
  const idTitulo = `evaluacion-${e.id}`;
  return (
    <li className={`${estilos.tarjeta} ${estilos.evaluacion}`}>
      <h3 id={idTitulo} className={estilos.cabeza}>
        {e.nombre}
      </h3>
      <p className={estilos.dato}>{lineaDeEvaluacion(e)}</p>
      <FormularioEvaluacion evaluacion={{ id: e.id, nombre: e.nombre, semana: e.semana }} idTitulo={idTitulo} />
      {ligado === null ? (
        <p role="alert" className={formulario.error}>
          {NO_SE_PUDO_COMPROBAR_EL_BORRADO}
        </p>
      ) : ligado.length > 0 ? (
        <p className={estilos.dato}>{textoDeLoLigado(ligado, "evaluacion")}</p>
      ) : (
        <BorrarConConfirmacion tipo="evaluacion" id={e.id} pregunta={preguntaDeBorrarEvaluacion(e.nombre)} etiqueta="Borrar" descritoPor={idTitulo} />
      )}
    </li>
  );
}

function VolverALaBandeja() {
  return (
    <Link href="/admin" className={formulario.enlace}>
      Volver a mi bandeja
    </Link>
  );
}
