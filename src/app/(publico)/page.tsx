import { connection } from "next/server";
import { AccesoDeCabecera } from "@/components/AccesoDeCabecera";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { Pantalla } from "@/components/Pantalla";
import { Portada } from "@/components/portada/Portada";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { ultimoDiagnosticoDeLaSesion } from "@/lib/diagnostico/ultimo";
import { parametrosParaLaPortada } from "@/lib/portada/parametros";

/**
 * HU-011: la portada. Quien ya hizo un diagnóstico desde este navegador ve el último (D-53 d: uno solo, el más reciente, de
 * cualquier materia) con las dos salidas del resultado; todos los demás ven la landing (HU-108): sin sesión, sin diagnósticos
 * terminados (uno a medias no cuenta), una cuenta del equipo, una sesión que no hizo ese diagnóstico (D-53 e) o cualquier fallo de
 * lectura. Nunca un error: lo que falle queda en el registro del servidor (`ultimoDiagnosticoDeLaSesion`).
 */
export default async function Inicio() {
  // Dinámica en cada petición. Sin esto, con las variables de Supabase ausentes al compilar `crearClienteServidor()` sale con
  // `null` antes de `cookies()` y la portada saldría estática (`s-maxage` de un año): a todos les llegaría el inicio normal.
  await connection();
  const ultimo = await ultimoDiagnosticoDeLaSesion();
  if (ultimo) return <PortadaConResultado resultado={ultimo} />;
  // HU-108: la landing. Los plazos que citan las preguntas frecuentes se leen aquí, no dentro de un componente asíncrono.
  return <Portada parametros={await parametrosParaLaPortada()} />;
}

/**
 * El último diagnóstico, con el componente de HU-009 y sus propiedades por omisión: «Ver monitores de {materia}» y «Tomar otro
 * diagnóstico» son sus dos salidas, y cubren lo que el inicio normal ofrece. Sin `ranura`: el formulario de contacto al volver lo
 * decide HU-010.
 */
function PortadaConResultado({ resultado }: { resultado: ResultadoParaMostrar }) {
  return (
    <Pantalla acceso={<AccesoDeCabecera />}
      eyebrow={resultado.materia.nombre}
      titulo="Tu último diagnóstico"
      subtitulo="Lo hiciste desde este navegador. Puedes ver los monitores de la materia o tomar otro diagnóstico."
    >
      <ResultadoDelDiagnostico resultado={resultado} />
    </Pantalla>
  );
}
