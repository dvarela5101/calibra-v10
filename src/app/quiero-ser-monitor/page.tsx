import type { Metadata } from "next";
import { Pantalla } from "@/components/Pantalla";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioSolicitud, type MateriaParaElegir } from "./FormularioSolicitud";
import estilos from "./solicitud.module.css";

export const metadata: Metadata = { title: "Quiero ser monitor · Calibra" };

/** Las materias se leen al pedir la página: la lista cambia cuando el equipo agrega una. */
async function cargarMaterias(): Promise<MateriaParaElegir[] | null> {
  const supabase = await crearClienteServidor();
  if (!supabase) return null;
  const { data, error } = await supabase.from("materia").select("id, nombre").order("nombre");
  if (error) {
    console.error("[solicitudes] no se pudieron leer las materias:", error.code ?? error.message);
    return null;
  }
  return data ?? [];
}

// Fuera del grupo (publico): pedir ser monitor no crea una sesión anónima de estudiante.
/** HU-062 (P-19): quien quiere ser monitor deja sus datos para que lo contacten y agenden su evaluación. */
export default async function QuieroSerMonitor() {
  const materias = await cargarMaterias();

  return (
    <Pantalla
      eyebrow="Monitores"
      titulo="Quiero ser monitor"
      subtitulo="Déjanos tus datos y las materias en las que quieres certificarte. Te contactamos para agendar una evaluación presencial; si la apruebas, te invitamos a crear tu cuenta de monitor."
    >
      {materias === null ? (
        <p role="alert" className={estilos.aviso}>
          No pudimos cargar las materias. Recarga la página en unos minutos.
        </p>
      ) : materias.length === 0 ? (
        <p className={estilos.aviso}>Todavía no hay materias abiertas para certificarse. Vuelve pronto.</p>
      ) : (
        <FormularioSolicitud materias={materias} />
      )}
    </Pantalla>
  );
}
