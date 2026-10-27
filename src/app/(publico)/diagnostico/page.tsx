import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { AccesoDeCabecera } from "@/components/AccesoDeCabecera";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { pantallaInicial, type MateriaConEvaluaciones } from "@/lib/diagnostico/pantalla";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import type { EnCurso } from "@/lib/diagnostico/reglas";
import { cargarEvaluacionesActivas } from "@/lib/diagnostico/selector";
import { diagnosticoEnCurso } from "@/lib/diagnostico/servidor";
import { Recorrido } from "./Recorrido";

export const metadata: Metadata = { title: "Diagnóstico · Calibra" };

/**
 * HU-009: elegir la materia, responder el diagnóstico y ver el mensaje de D-51. Es dinámica: lee la sesión de las cookies, así
 * que Next la responde con `Cache-Control` privado y el HTML de una persona no se sirve a otra.
 *
 * El servidor manda: si la sesión ya tiene un diagnóstico en curso (recargó o cerró la pestaña), la página pinta la pregunta
 * pendiente y no el selector. La cuenta del equipo ve el selector y la acción responde el aviso al pulsar «Empezar».
 */
export default async function Diagnostico() {
  // Nunca se prerenderiza: lo que ve cada persona depende de su sesión y debe salir con `Cache-Control` privado (criterio 13), también
  // si esta compilación no trae las variables de Supabase y por eso `obtenerSesion` ni siquiera llega a leer las cookies.
  await connection();
  let enCurso: EnCurso | null = null;
  let materias: MateriaConEvaluaciones[];
  try {
    const sesion = await obtenerSesion();
    // Sin sesión (la primera visita, la anónima nace en el navegador) y con una cuenta del equipo no hay nada en curso que leer.
    const leerEnCurso = sesion && !tienePanel(sesion.rol) ? diagnosticoEnCurso(sesion) : Promise.resolve(null);
    const [pendiente, evaluaciones] = await Promise.all([leerEnCurso, cargarEvaluacionesActivas()]);
    enCurso = pendiente?.estado === "en_curso" ? pendiente : null;
    materias = evaluaciones;
  } catch (error) {
    // `cookies()` (en `obtenerSesion`) corta el prerenderizado lanzando un error de Next: no es un fallo y no se atrapa.
    unstable_rethrow(error);
    console.error("[diagnostico] no se pudo cargar:", error instanceof Error ? error.message : error);
    return (
      <Pantalla acceso={<AccesoDeCabecera />} paso="prueba" eyebrow={TEXTOS.eyebrow} titulo="Diagnóstico">
        <p role="alert" className={formulario.error}>
          {TEXTOS.errorDeCarga}
        </p>
      </Pantalla>
    );
  }

  return <Recorrido inicial={pantallaInicial(enCurso)} materias={materias} acceso={<AccesoDeCabecera />} />;
}
