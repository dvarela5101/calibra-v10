import type { Metadata } from "next";
import { connection } from "next/server";
import { AccesoDeCabecera } from "@/components/AccesoDeCabecera";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { Pantalla } from "@/components/Pantalla";
import { Portada } from "@/components/portada/Portada";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { ultimoDiagnosticoDeLaSesion } from "@/lib/diagnostico/ultimo";
import { cifrasDelBancoParaLaPortada } from "@/lib/portada/cifras-del-banco";
import { parametrosParaLaPortada } from "@/lib/portada/parametros";
import { ALT_DE_LA_VISTA_PREVIA, DESCRIPCION_DEL_SITIO, NOMBRE_DEL_SITIO, TITULO_DEL_SITIO } from "@/lib/sitio";

// HU-135: la portada fija su `og:url` (el `openGraph` de una página reemplaza al del layout, por eso repite los demás campos).
// También la imagen: `opengraph-image.tsx` es del segmento raíz y, al reemplazar el `openGraph`, la portada se quedaba sin ella.
export const metadata: Metadata = {
  title: TITULO_DEL_SITIO,
  openGraph: {
    title: TITULO_DEL_SITIO,
    description: DESCRIPCION_DEL_SITIO,
    url: "/",
    siteName: NOMBRE_DEL_SITIO,
    locale: "es_CO",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, type: "image/png", alt: ALT_DE_LA_VISTA_PREVIA }],
  },
};

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
  // HU-134: las cifras del banco, también aquí y en paralelo; si no se leen, la portada sale sin números.
  const [parametros, cifras] = await Promise.all([parametrosParaLaPortada(), cifrasDelBancoParaLaPortada()]);
  return <Portada parametros={parametros} cifras={cifras} />;
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
