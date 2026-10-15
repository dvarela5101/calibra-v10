import Link from "next/link";
import { connection } from "next/server";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";
import { ultimoDiagnosticoDeLaSesion } from "@/lib/diagnostico/ultimo";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";

/**
 * HU-011: la portada. Quien ya hizo un diagnóstico desde este navegador ve el último (D-53 d: uno solo, el más reciente, de
 * cualquier materia) con las dos salidas del resultado; todos los demás ven el inicio de siempre: sin sesión, sin diagnósticos
 * terminados (uno a medias no cuenta), una cuenta del equipo, una sesión que no hizo ese diagnóstico (D-53 e) o cualquier fallo de
 * lectura. Nunca un error: lo que falle queda en el registro del servidor (`ultimoDiagnosticoDeLaSesion`).
 */
export default async function Inicio() {
  // Dinámica en cada petición. Sin esto, con las variables de Supabase ausentes al compilar `crearClienteServidor()` sale con
  // `null` antes de `cookies()` y la portada saldría estática (`s-maxage` de un año): a todos les llegaría el inicio normal.
  await connection();
  const ultimo = await ultimoDiagnosticoDeLaSesion();
  return ultimo ? <PortadaConResultado resultado={ultimo} /> : <InicioNormal />;
}

/** El inicio de HU-009, tal cual. */
function InicioNormal() {
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

/**
 * El último diagnóstico, con el componente de HU-009 y sus propiedades por omisión: «Ver monitores de {materia}» y «Tomar otro
 * diagnóstico» son sus dos salidas, y cubren lo que el inicio normal ofrece. Sin `ranura`: el formulario de contacto al volver lo
 * decide HU-010.
 */
function PortadaConResultado({ resultado }: { resultado: ResultadoParaMostrar }) {
  return (
    <Pantalla
      eyebrow={resultado.materia.nombre}
      titulo="Tu último diagnóstico"
      subtitulo="Lo hiciste desde este navegador. Puedes ver los monitores de la materia o tomar otro diagnóstico."
    >
      <ResultadoDelDiagnostico resultado={resultado} />
    </Pantalla>
  );
}
