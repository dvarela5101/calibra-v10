import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { NO_SE_PUDIERON_CARGAR, SIN_MATERIAS, nombreDeLaConsulta, textoDeEvaluaciones, textoDeMateriaBorrada } from "@/lib/materias/reglas";
import { listarMaterias, type MateriaDeLaLista } from "@/lib/materias/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioMateria } from "./FormularioMateria";
import estilos from "./materias.module.css";

export const metadata: Metadata = { title: "Materias y evaluaciones · Calibra" };

const RUTA = "/admin/materias";
const EYEBROW = "Administración";
const TITULO = "Materias y evaluaciones";

/**
 * HU-055 (D-62): la lista de materias y el alta. Cualquier admin activo entra; a los demás `exigirRol` los lleva a su
 * panel o a `/ingresar`. Cada materia lleva su código, cuántas evaluaciones tiene y cuántas están activas, y un enlace a
 * su página, donde se corrige y se borra. Tras borrar una, la acción vuelve aquí con su nombre en `?borrada=`: es texto
 * que React escapa, en una página que exige admin.
 */
export default async function MateriasYEvaluaciones({ searchParams }: PageProps<"/admin/materias">) {
  await exigirRol("admin", RUTA);
  const borrada = nombreDeLaConsulta((await searchParams).borrada);
  const aviso = borrada && (
    <p role="status" className={formulario.exito}>
      {textoDeMateriaBorrada(borrada)}
    </p>
  );

  let materias: MateriaDeLaLista[];
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    materias = await listarMaterias(supabase);
  } catch (error) {
    console.error("[materias] no se pudieron leer las materias:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo={TITULO}>
        {aviso}
        <p role="alert" className={formulario.error}>
          {NO_SE_PUDIERON_CARGAR}
        </p>
        <Link href="/admin" className={formulario.enlace}>
          Volver a mi bandeja
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo={TITULO}
      subtitulo="Crea materias y corrige el nombre y el código de cada una y el nombre y la semana de sus evaluaciones. Los temas, las habilidades y las preguntas vienen del banco (carpeta contenido/)."
    >
      {aviso}

      <section aria-labelledby="nueva" className={estilos.seccion}>
        <h2 id="nueva" className={estilos.titulo}>
          Nueva materia
        </h2>
        <FormularioMateria modo="crear" />
      </section>

      <section aria-labelledby="materias" className={estilos.seccion}>
        <h2 id="materias" className={estilos.titulo}>
          Materias ({materias.length})
        </h2>
        {materias.length === 0 ? (
          <p className={formulario.ayuda}>{SIN_MATERIAS}</p>
        ) : (
          <ul className={estilos.lista}>
            {materias.map((m) => (
              <li key={m.id} className={estilos.tarjeta}>
                <Link href={`${RUTA}/${m.id}`} className={estilos.enlaceDeMateria}>
                  {m.nombre}
                </Link>
                <span className={estilos.dato}>{`${m.codigo} · ${textoDeEvaluaciones(m.evaluaciones, m.activas)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}
