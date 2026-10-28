import estilos from "./portada.module.css";

/**
 * El trazo rojo a mano, como en un parcial corregido: rodea lo que lo contiene, mida lo que mida. Lo usan la pregunta de muestra
 * (HU-108) y la agenda de muestra de la landing de monitores (HU-109); va aparte porque las dos son de cliente.
 */
export function Trazo() {
  return (
    <svg className={estilos.trazo} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
      <ellipse cx="100" cy="30" rx="96" ry="26" transform="rotate(-3 100 30)" />
    </svg>
  );
}
