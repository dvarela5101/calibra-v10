"use client";

import { useActionState, useState } from "react";
import { abrirFranja, type EstadoFranja } from "@/app/monitor/franjas/acciones";
import formulario from "@/components/formulario.module.css";
import { MAX_SEMANAS, MIN_SEMANAS, nombreDelDiaEnMinuscula, textoDeRepeticion, type Repite } from "@/lib/calendario/reglas";
import estilos from "./calendario.module.css";

const DURACIONES = [60, 90, 120] as const;
const VACIO: EstadoFranja = { error: null, exito: null, valores: {} };

/**
 * HU-140 (D-94 b): abrir una franja desde el calendario, en el día elegido, con su repetición. El día no se manda: la acción lo
 * deduce de `fecha`. Los ids llevan el prefijo `nueva-` para no chocar con los de `FormularioFranja`. Tras guardar, la acción
 * revalida `/monitor` y el calendario se pinta de nuevo. El éxito va en un `<p>` sin `role="status"`: el panel solo tiene uno, el
 * del recordatorio de finalizar.
 */
export function FormularioNuevaFranja({ fecha }: { fecha: string }) {
  const [estado, enviar, enviando] = useActionState<EstadoFranja, FormData>(abrirFranja, VACIO);
  const valor = (campo: string, porDefecto: string) => estado.valores[campo] ?? porDefecto;
  const [repite, setRepite] = useState<Repite>("siempre");
  const [semanas, setSemanas] = useState("4");
  const dia = nombreDelDiaEnMinuscula(fecha);
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  const opcionesDeRepeticion: { valor: Repite; texto: string }[] = [
    { valor: "una", texto: "Solo este día" },
    { valor: "semanas", texto: `Cada ${dia} durante N semanas` },
    { valor: "siempre", texto: "Todas las semanas, sin fecha final" },
  ];

  return (
    <form action={enviar} className={`${formulario.formulario} ${estilos.formulario}`} noValidate key={llave}>
      <input type="hidden" name="fecha" value={fecha} />

      <div className={estilos.par}>
        <div className={formulario.campo}>
          <label htmlFor="nueva-hora" className={formulario.etiqueta}>
            Empieza
          </label>
          <input id="nueva-hora" name="hora" type="time" step={300} defaultValue={valor("hora", "")} required className={formulario.entrada} />
        </div>
        <div className={formulario.campo}>
          <label htmlFor="nueva-duracion" className={formulario.etiqueta}>
            Dura
          </label>
          <select id="nueva-duracion" name="duracion_min" defaultValue={valor("duracion_min", "60")} className={formulario.entrada}>
            {DURACIONES.map((minutos) => (
              <option key={minutos} value={minutos}>
                {minutos} minutos
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={formulario.campo}>
        <label htmlFor="nueva-precio" className={formulario.etiqueta}>
          Precio por persona (pesos)
        </label>
        <input
          id="nueva-precio"
          name="precio"
          type="text"
          inputMode="numeric"
          defaultValue={valor("precio", "")}
          aria-describedby="nueva-precio-ayuda"
          required
          className={formulario.entrada}
        />
        <p id="nueva-precio-ayuda" className={formulario.ayuda}>
          Sin decimales, por ejemplo 25000.
        </p>
      </div>

      <fieldset className={estilos.grupo}>
        <legend className={formulario.etiqueta}>Tipo de clase</legend>
        {(["virtual", "presencial"] as const).map((opcion) => (
          <label key={opcion} className={estilos.opcion}>
            <input
              type="radio"
              name="modalidad"
              value={opcion}
              defaultChecked={valor("modalidad", "presencial") === opcion}
              className={estilos.radio}
            />
            <span className={estilos.punto} aria-hidden="true" />
            {opcion === "virtual" ? "Virtual" : "Presencial"}
          </label>
        ))}
      </fieldset>

      <fieldset className={estilos.grupo}>
        <legend className={formulario.etiqueta}>Se repite</legend>
        {opcionesDeRepeticion.map((opcion) => (
          <label key={opcion.valor} className={estilos.opcion}>
            <input
              type="radio"
              name="repite"
              value={opcion.valor}
              checked={repite === opcion.valor}
              onChange={() => setRepite(opcion.valor)}
              className={estilos.radio}
            />
            <span className={estilos.punto} aria-hidden="true" />
            {opcion.texto}
          </label>
        ))}
        <div className={formulario.campo}>
          <label htmlFor="nueva-semanas" className={formulario.etiqueta}>
            Cuántas semanas (de {MIN_SEMANAS} a {MAX_SEMANAS})
          </label>
          <input
            id="nueva-semanas"
            name="semanas"
            type="number"
            inputMode="numeric"
            min={MIN_SEMANAS}
            max={MAX_SEMANAS}
            value={semanas}
            onChange={(e) => setSemanas(e.target.value)}
            disabled={repite !== "semanas"}
            className={formulario.entrada}
          />
        </div>
        <p className={estilos.vistaPrevia}>{textoDeRepeticion(fecha, repite, semanas)}</p>
      </fieldset>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.exito && <p className={formulario.exito}>{estado.exito}</p>}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Guardando…" : "Abrir franja"}
      </button>
    </form>
  );
}
