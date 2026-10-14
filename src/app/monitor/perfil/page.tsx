import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { PerfilDelMonitor } from "@/components/PerfilDelMonitor";
import { exigirRol } from "@/lib/auth/sesion";
import { RUTA_PERFIL } from "@/lib/monitores/perfil";
import { RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioPerfil } from "./FormularioPerfil";
import estilos from "./perfil.module.css";

export const metadata: Metadata = { title: "Mi perfil · Calibra" };

/**
 * HU-049 (D-58 a): el monitor edita su carrera, su semestre y su presentación, y ve cómo queda su tarjeta. Entra aunque
 * todavía no tenga certificados: la tarjeta solo se muestra cuando lo esté (D-4).
 */
export default async function MiPerfil() {
  const sesion = await exigirRol("monitor", RUTA_PERFIL);
  const supabase = await crearClienteServidor();
  const [{ data: monitor }, { data: perfil, error }] = await Promise.all([
    supabase!.from("monitor").select("nombre").eq("id", sesion.idUsuario).maybeSingle(),
    supabase!.from("perfil_monitor").select("carrera, semestre, presentacion").eq("id_monitor", sesion.idUsuario).maybeSingle(),
  ]);
  if (error) console.error("[monitor] no se pudo leer el perfil:", error.code);

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo="Mi perfil"
      subtitulo="Cuéntales a los estudiantes quién eres antes de que agenden contigo."
    >
      <p className={formulario.ayuda}>
        Cuando estés certificado, estudiantes y visitantes ven tu carrera, tu semestre y tu presentación en tu tarjeta de la
        lista de monitores. Los tres son opcionales. Más en el{" "}
        <Link href={RUTA_AVISO} target="_blank" rel="noopener" className={formulario.enlaceEnTexto}>
          aviso de privacidad (se abre en otra pestaña)
        </Link>
        .
      </p>

      {error || !perfil ? (
        <p role="alert" className={formulario.error}>
          No pudimos cargar tu perfil. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      ) : (
        <>
          <FormularioPerfil
            carrera={perfil.carrera ?? ""}
            semestre={perfil.semestre?.toString() ?? ""}
            presentacion={perfil.presentacion ?? ""}
          />

          <section aria-labelledby="vista-previa" className={estilos.seccion}>
            <h2 id="vista-previa" className={estilos.titulo}>
              Así te ven los estudiantes
            </h2>
            <div className={estilos.tarjeta} data-testid="vista-previa">
              <p className={estilos.nombre}>{monitor?.nombre ?? "Tu nombre"}</p>
              <PerfilDelMonitor perfil={perfil} />
              <p className={formulario.ayuda}>Debajo van tus fechas libres de esa materia.</p>
            </div>
          </section>
        </>
      )}

      <Link href="/monitor" className={formulario.enlace}>
        Volver a mi panel
      </Link>
    </Pantalla>
  );
}
