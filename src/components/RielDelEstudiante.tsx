import estilos from "./riel.module.css";

export type PasoDelEstudiante = "prueba" | "diagnostico" | "monitor" | "sesion";

/** Los cuatro pasos del recorrido del estudiante, hasta agendar la monitoría, como el carril del prototipo (D-74 d). */
export const PASOS_DEL_ESTUDIANTE: readonly { id: PasoDelEstudiante; nombre: string; pista: string }[] = [
  { id: "prueba", nombre: "Prueba", pista: "Preguntas de tu parcial" },
  { id: "diagnostico", nombre: "Diagnóstico", pista: "Qué habilidades dominas" },
  { id: "monitor", nombre: "Monitor", pista: "Llega con tu diagnóstico" },
  { id: "sesion", nombre: "Sesión", pista: "Fecha, pago y contacto" },
];

/**
 * El avance del estudiante, a la izquierda en pantallas anchas (en el celular no sale). No lleva enlaces: muestra en qué paso
 * va, con la pleca en color en los pasos ya recorridos y en el actual.
 */
export function RielDelEstudiante({ actual }: { actual: PasoDelEstudiante }) {
  const indice = PASOS_DEL_ESTUDIANTE.findIndex((paso) => paso.id === actual);
  return (
    <aside aria-label="Tu avance" className={estilos.riel}>
      <ol className={estilos.pasos}>
        {PASOS_DEL_ESTUDIANTE.map((paso, i) => (
          <li
            key={paso.id}
            className={`${estilos.paso} ${i < indice ? estilos.hecho : ""} ${i === indice ? estilos.actual : ""}`}
            aria-current={i === indice ? "step" : undefined}
          >
            <span className={estilos.nombre}>{paso.nombre}</span>
            <span className={estilos.pista}>{paso.pista}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
