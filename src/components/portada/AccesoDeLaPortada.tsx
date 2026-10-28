import Link from "next/link";
import { EVENTOS } from "@/lib/analitica/eventos";
import { enlacesDeAccesoDeLaPortada, RUTA_DE_INGRESO } from "@/lib/auth/acceso";
import { obtenerSesion } from "@/lib/auth/sesion";
import { EnlaceConEvento } from "./EnlaceConEvento";
import estilos from "./portada.module.css";

/**
 * D-77 a (HU-108): el acceso de la cabecera de la landing. Sin cuenta, solo «Iniciar sesión», con borde y sin el color de
 * acento, y registra `clic_iniciar_sesion`; con cuenta, el enlace a lo suyo. Lee la sesión en el servidor, así que es
 * asíncrono: pruebas/preparacion.ts lo deja vacío para las pruebas de páginas y AccesoDeLaPortada.test.ts prueba el de verdad.
 */
export async function AccesoDeLaPortada() {
  const sesion = await obtenerSesion();
  return (
    <nav aria-label="Tu cuenta">
      {enlacesDeAccesoDeLaPortada(sesion?.rol ?? null).map((enlace) =>
        enlace.href === RUTA_DE_INGRESO ? (
          <EnlaceConEvento key={enlace.href} href={enlace.href} evento={EVENTOS.clicIniciarSesion} className={estilos.acceso}>
            {enlace.texto}
          </EnlaceConEvento>
        ) : (
          <Link key={enlace.href} href={enlace.href} className={estilos.acceso}>
            {enlace.texto}
          </Link>
        ),
      )}
    </nav>
  );
}
