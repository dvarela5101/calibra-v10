import Link from "next/link";
import { RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import estilos from "./pie.module.css";

/**
 * Pie de todas las páginas: el aviso de privacidad queda a un toque desde cualquier lugar (HU-008), y
 * también "Quiero ser monitor" (HU-062), por donde entra quien quiere certificarse.
 */
export function PieDePagina() {
  return (
    <footer className={estilos.pie}>
      <Link href={RUTA_AVISO} className={estilos.enlace}>
        Aviso de privacidad
      </Link>
      <Link href="/quiero-ser-monitor" className={estilos.enlace}>
        Quiero ser monitor
      </Link>
    </footer>
  );
}
