import type { Metadata } from "next";
import { PortadaDeMonitores } from "@/components/portada/PortadaDeMonitores";
import { parametrosParaLaPortada } from "@/lib/portada/parametros";
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
/**
 * HU-062 (P-19): quien quiere ser monitor deja sus datos para que lo contacten y agenden su evaluación. HU-109 (D-78 a): la página
 * es la landing de monitores, con el formulario al final; las mismas materias de la base nombran la sección de materias.
 * HU-111 (D-80 c): el formulario sale aunque la base no tenga materias: la persona escribe la suya en «Otra».
 */
export default async function QuieroSerMonitor() {
  const [materias, parametros] = await Promise.all([cargarMaterias(), parametrosParaLaPortada()]);

  return (
    <PortadaDeMonitores
      materias={materias?.map((m) => m.nombre) ?? null}
      parametros={parametros}
      solicitud={
        materias === null ? (
          <p role="alert" className={estilos.aviso}>
            No pudimos cargar las materias. Recarga la página en unos minutos.
          </p>
        ) : (
          // HU-111 (D-80 c): sin materias en la base, el formulario sale igual, con solo «Otra».
          <FormularioSolicitud materias={materias} />
        )
      }
    />
  );
}
