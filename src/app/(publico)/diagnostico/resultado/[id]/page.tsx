import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { leerMiDiagnostico } from "@/lib/diagnostico/lectura";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { esUuid } from "@/lib/diagnostico/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

// Es personal: no se indexa.
export const metadata: Metadata = { title: "Tu resultado · Calibra", robots: { index: false } };

/**
 * HU-009: el resultado de un diagnóstico terminado, con dirección propia (sigue ahí al recargar). Lo que ve es lo que quedó
 * guardado, no algo calculado en el navegador. Se lee con `public.mi_diagnostico(id)` y la sesión de quien visita: la base
 * filtra al dueño (la sesión que hizo el diagnóstico o la cuenta de Estudiante de su Lead) y descarta al monitor y al admin,
 * que sí podrían leer la fila de `diagnostico`. Sin sesión, con una cuenta del equipo, con un id que no es UUID o sin fila, sale
 * el `not-found.tsx` de este segmento: no dice cuál de los casos pasó.
 *
 * Dinámica (lee la sesión de las cookies): `Cache-Control` privado.
 */
export default async function ResultadoDeUnDiagnostico({ params }: PageProps<"/diagnostico/resultado/[id]">) {
  // Nunca se prerenderiza: lo que ve cada persona depende de su sesión y debe salir con `Cache-Control` privado (criterio 13), también
  // si esta compilación no trae las variables de Supabase y por eso `obtenerSesion` ni siquiera llega a leer las cookies.
  await connection();
  const { id } = await params;
  if (!esUuid(id)) notFound();

  const sesion = await obtenerSesion();
  // La cuenta del equipo no es la dueña de ningún diagnóstico: ni se le pregunta a la base.
  if (!sesion || tienePanel(sesion.rol)) notFound();

  let resultado: ResultadoParaMostrar | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await leerMiDiagnostico(supabase, id);
  } catch (error) {
    // También un resultado guardado que no cuadra (`ErrorDeResultadoGuardado`): el mensaje no trae contenido.
    console.error("[diagnostico] no se pudo cargar el resultado:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.tituloDelResultado}>
        <p role="alert" className={formulario.error}>
          {TEXTOS.errorDeCargaDelResultado}
        </p>
      </Pantalla>
    );
  }
  if (!resultado) notFound();

  // HU-010 pone aquí su formulario de contacto.
  const ranura: ReactNode = null;

  return (
    <Pantalla eyebrow={resultado.materia.nombre} titulo={TEXTOS.tituloDelResultado}>
      <ResultadoDelDiagnostico resultado={resultado} ranura={ranura} />
    </Pantalla>
  );
}
