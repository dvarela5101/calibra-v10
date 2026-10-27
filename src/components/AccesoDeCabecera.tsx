import Link from "next/link";
import { enlacesDeAcceso } from "@/lib/auth/acceso";
import { obtenerSesion } from "@/lib/auth/sesion";
import estilos from "./acceso.module.css";

/**
 * D-75 a: «Iniciar sesión» y «Registrarse» en la cabecera de las pantallas del visitante, o el enlace a lo suyo para quien
 * ya tiene cuenta. Va como ranura de `Pantalla` (`acceso`) porque lee la sesión en el servidor y `Pantalla` también se pinta
 * dentro de componentes de cliente.
 */
export async function AccesoDeCabecera() {
  const sesion = await obtenerSesion();
  return (
    <nav aria-label="Tu cuenta" className={estilos.acceso}>
      {enlacesDeAcceso(sesion?.rol ?? null).map((enlace) => (
        <Link key={enlace.href} href={enlace.href} className={enlace.principal ? estilos.principal : estilos.enlace}>
          {enlace.texto}
        </Link>
      ))}
    </nav>
  );
}
