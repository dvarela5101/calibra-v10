import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";

export default function Inicio() {
  return (
    <Pantalla
      eyebrow="Nueva versión en construcción"
      titulo="Descubre en qué tema fallas antes de tu monitoría"
      subtitulo="Calibra conecta a estudiantes de ciclo básico con monitores certificados. Una prueba corta muestra en qué habilidad está el error, y el monitor llega a la sesión sabiendo por dónde empezar."
    >
      {/* HU-009: el diagnóstico se toma sin iniciar sesión. */}
      <Link href={rutaDeDiagnostico()} className={formulario.boton}>
        Hacer el diagnóstico
      </Link>
      {/* HU-016 (D-4) y HU-017: desde la lista de monitores se agenda. */}
      <Link href={rutaDeMonitores()} className={formulario.enlace}>
        Ver monitores certificados
      </Link>
    </Pantalla>
  );
}
