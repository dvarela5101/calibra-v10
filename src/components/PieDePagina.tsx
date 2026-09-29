import Link from "next/link";
import { RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import estilos from "./pie.module.css";

/** Pie de todas las páginas: el aviso de privacidad queda a un toque desde cualquier lugar (HU-008). */
export function PieDePagina() {
  return (
    <footer className={estilos.pie}>
      <Link href={RUTA_AVISO} className={estilos.enlace}>
        Aviso de privacidad
      </Link>
    </footer>
  );
}
