import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiagnosticoDelMonitor } from "@/components/diagnostico/DiagnosticoDelMonitor";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { rutaDelDiagnosticoDeLaCita } from "@/lib/agenda/reglas";
import { cargarDiagnosticoDeLaCita } from "@/lib/agenda/servidor";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { TEXTOS, type VistaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import { formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

// Es de una persona concreta: no se indexa.
export const metadata: Metadata = { title: TEXTOS.tituloDeLaPestana, robots: { index: false } };

const RUTA_DE_LA_AGENDA = "/monitor/agenda";

/**
 * HU-022 (D-7, D-53 b, D-54, D-67): el diagnóstico ligado a una cita del monitor. Se lee con `public.diagnostico_de_mi_monitoria(id)`
 * y la sesión del monitor: la base filtra por `auth.uid()` y devuelve nada si la cita no existe, no es suya, es grupal o su estado
 * no se ve (pendiente de pago, cancelada, o realizada hace más de 30 días). Esta página no distingue esos casos: sin fila, o con un
 * id que no es UUID, sale el mismo 404 de cualquier ruta que no existe, el de `src/app/not-found.tsx`. Un fallo de la base o una
 * respuesta que no cuadra NO es un 404: un error no se esconde como «no existe».
 *
 * Quien no es monitor no llega: `exigirRol` manda al admin a su panel y al resto a `/ingresar`. Se le pasa la ruta sin el id cuando
 * este no es un UUID, para que un id basura no viaje en `?siguiente=`. Dinámica (lee la sesión de las cookies): `Cache-Control`
 * privado.
 */
export default async function DiagnosticoDeLaCita({ params }: PageProps<"/monitor/agenda/[id]">) {
  const { id } = await params;
  await exigirRol("monitor", esUuid(id) ? rutaDelDiagnosticoDeLaCita(id) : RUTA_DE_LA_AGENDA);
  if (!esUuid(id)) notFound();

  let vista: VistaDelMonitor | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    vista = await cargarDiagnosticoDeLaCita(supabase, id);
  } catch (error) {
    // Solo el mensaje: el de la base trae el código y el de la vista trae la ruta del dato malo, nunca su contenido.
    console.error("[diagnostico del monitor]", error instanceof Error ? error.message : "error desconocido");
    return (
      <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.tituloSinNombre}>
        <p role="alert" className={formulario.error}>
          {TEXTOS.errorDeCarga}
        </p>
        <Link href={RUTA_DE_LA_AGENDA} className={formulario.enlace}>
          {TEXTOS.volver}
        </Link>
      </Pantalla>
    );
  }
  if (!vista) notFound();

  const { cita } = vista;
  return (
    <Pantalla
      eyebrow={TEXTOS.eyebrow}
      titulo={`Diagnóstico de ${cita.nombreEstudiante}`}
      subtitulo={`${cita.nombreMateria} · ${formatearDiaConSemana(cita.fecha)}, ${horaCorta(cita.hora)} a ${horaDeFin(cita.hora, cita.duracionMin)}`}
    >
      <DiagnosticoDelMonitor vista={vista} />
      <Link href={RUTA_DE_LA_AGENDA} className={formulario.enlace}>
        {TEXTOS.volver}
      </Link>
    </Pantalla>
  );
}
