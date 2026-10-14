import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { FormularioContacto } from "@/components/contacto/FormularioContacto";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { leerMiDiagnostico } from "@/lib/diagnostico/lectura";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { esUuid } from "@/lib/diagnostico/reglas";
import { resumenDeError } from "@/lib/leads/reglas";
import { leadDeLaSesion, type LeadDeSesion } from "@/lib/leads/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { dejarContactoDelDiagnostico } from "./acciones";
import estilos from "./resultado.module.css";

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

  const ranura = await contactoDelResultado(sesion.idUsuario, id);

  return (
    <Pantalla eyebrow={resultado.materia.nombre} titulo={TEXTOS.tituloDelResultado}>
      <ResultadoDelDiagnostico resultado={resultado} ranura={ranura} />
    </Pantalla>
  );
}

/** D-68 a: el título del bloque. No promete el correo con el enlace (HU-031). */
const TITULO_DEL_CONTACTO = "Déjanos tu contacto para agendar una monitoría y que Calibra te pueda escribir";

/**
 * HU-010 (P-34, D-68): el contacto va después del resultado, como paso siguiente, sin taparlo. Quien ya es Lead (la sesión
 * propia, la confirmada por P-23 o la cuenta de Estudiante) no ve el formulario: ve «Ya tenemos tu contacto» y puede cambiar
 * sus datos en la pantalla de HU-068, que actualiza su Lead. Si no se sabe si es Lead, el resultado sale solo.
 */
async function contactoDelResultado(idSesion: string, idDiagnostico: string): Promise<ReactNode> {
  let lead: LeadDeSesion | null;
  try {
    lead = await leadDeLaSesion(idSesion);
  } catch (error) {
    console.error("[diagnostico] no se pudo saber si la sesión ya es Lead:", resumenDeError(error));
    return null;
  }

  if (lead) {
    const editar = `/agendar/contacto?editar=1&siguiente=${encodeURIComponent(`/diagnostico/resultado/${idDiagnostico}`)}`;
    return (
      <section aria-labelledby="contacto-guardado" className={estilos.bloque}>
        <h2 id="contacto-guardado" className={estilos.titulo}>
          Ya tenemos tu contacto
        </h2>
        <p className={formulario.ayuda}>Con él agendas tus monitorías y Calibra te puede escribir.</p>
        <Link href={editar} className={formulario.enlace}>
          Cambiar mis datos
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="contacto" className={estilos.bloque}>
      <h2 id="contacto" className={estilos.titulo}>
        {TITULO_DEL_CONTACTO}
      </h2>
      <FormularioContacto
        accion={dejarContactoDelDiagnostico}
        ocultos={{ id_diagnostico: idDiagnostico }}
        iniciales={{ nombre: "", correo: "", numero_telefono: "" }}
        ayudaDelCorreo="Por ahí te escribimos y te confirmamos tus citas."
        textoDelBoton="Guardar mis datos"
      />
    </section>
  );
}
