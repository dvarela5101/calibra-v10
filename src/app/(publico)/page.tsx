import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";
import styles from "./page.module.css";

export default function Inicio() {
  return (
    <Pantalla
      eyebrow="Nueva versión en construcción"
      titulo="Descubre en qué tema fallas antes de tu monitoría"
      subtitulo="Calibra conecta a estudiantes de ciclo básico con monitores certificados. Una prueba corta muestra en qué subtema está el error, y el monitor llega a la sesión sabiendo por dónde empezar."
    >
      <section className={styles.aviso} aria-labelledby="aviso-titulo">
        <h2 id="aviso-titulo" className={styles.avisoTitulo}>
          Estamos preparando esta versión
        </h2>
        <p>Muy pronto podrás tomar el diagnóstico desde aquí. Mientras tanto, ya puedes elegir un monitor certificado y apartar tu monitoría.</p>
      </section>
      {/* HU-016 (D-4) y HU-017: desde la lista de monitores se agenda. */}
      <Link href={rutaDeMonitores()} className={formulario.enlace}>
        Ver monitores certificados
      </Link>
    </Pantalla>
  );
}
