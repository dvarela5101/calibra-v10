import { Pantalla } from "@/components/Pantalla";
import estilos from "./loading.module.css";

/**
 * HU-133: señal de carga al navegar a una ruta que tarda. Usa el esqueleto de `Pantalla` (marca arriba, misma columna y
 * mismos márgenes) para que al llegar la página no haya salto de diseño. Se reemplaza entera por la página, que trae su
 * propia cabecera, así que no se duplica nada; la portada (`data-landing`) aparece al terminar, con su propio pie.
 */
export default function Cargando() {
  return (
    <Pantalla titulo="Un momento">
      <div role="status" className={estilos.estado}>
        <span className={estilos.barra} aria-hidden="true" />
        <span className={estilos.texto}>Cargando la página…</span>
      </div>
    </Pantalla>
  );
}
