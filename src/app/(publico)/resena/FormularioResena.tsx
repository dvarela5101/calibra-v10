"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { CALIFICACION_MAXIMA, CALIFICACION_MINIMA, LARGO_MAXIMO_COMENTARIO } from "@/lib/resenas/reglas";
import { calificar, type EstadoResena } from "./acciones";
import estilos from "./resena.module.css";

export const MENSAJE_YA_RESENADA = "Ya dejaste tu calificación de esta monitoría. Gracias por ayudar a otros estudiantes.";
export const MENSAJE_CON_REPORTE =
  "Reportaste que el monitor no asistió. Mientras el reporte esté en revisión, o si lo aceptamos, esta monitoría no se puede calificar.";
export const MENSAJE_NO_DISPONIBLE = "Esta monitoría no se puede calificar.";
const MENSAJE_NO_EXISTE = "Este enlace no sirve. Abre de nuevo el enlace del correo que te mandamos.";

const estadoInicial: EstadoResena = { resultado: "pendiente", error: null, valores: { calificacion: "", comentario: "" } };

const OPCIONES = Array.from({ length: CALIFICACION_MAXIMA - CALIFICACION_MINIMA + 1 }, (_, i) => CALIFICACION_MINIMA + i);

/** HU-035 (D-17): calificación de 1 a 5 y comentario opcional, sin estrellas. */
export function FormularioResena({ token }: { token: string }) {
  const [estado, accion, enviando] = useActionState(calificar, estadoInicial);

  if (estado.resultado === "registrada") {
    return (
      <div role="status" className={estilos.resultado}>
        <h2 className={estilos.tituloResultado}>Gracias por calificar</h2>
        <p className={formulario.exito}>Guardamos tu calificación. Ayuda a otros estudiantes a escoger monitor.</p>
      </div>
    );
  }
  if (estado.resultado !== "pendiente") {
    const mensaje = {
      ya_resenada: MENSAJE_YA_RESENADA,
      con_reporte: MENSAJE_CON_REPORTE,
      no_disponible: MENSAJE_NO_DISPONIBLE,
      no_existe: MENSAJE_NO_EXISTE,
    }[estado.resultado];
    return (
      <p role="status" className={estilos.resultado}>
        {mensaje}
      </p>
    );
  }

  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);
  const descritoPor = estado.error ? "resena-error" : undefined;

  return (
    <form key={llave} action={accion} className={formulario.formulario} noValidate>
      <input type="hidden" name="token" value={token} />

      <fieldset className={estilos.grupo} aria-describedby={["calificacion-ayuda", descritoPor].filter(Boolean).join(" ")}>
        <legend className={formulario.etiqueta}>Tu calificación</legend>
        <p id="calificacion-ayuda" className={formulario.ayuda}>
          {CALIFICACION_MINIMA} es la más baja y {CALIFICACION_MAXIMA} la más alta.
        </p>
        <div className={estilos.opciones}>
          {OPCIONES.map((n) => (
            <label key={n} className={estilos.opcion}>
              <input
                type="radio"
                name="calificacion"
                value={n}
                defaultChecked={estado.valores.calificacion === String(n)}
                className={estilos.radio}
              />
              <span className={estilos.numero}>{n}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={formulario.campo}>
        <label htmlFor="comentario" className={formulario.etiqueta}>
          Comentario (opcional)
        </label>
        <textarea
          id="comentario"
          name="comentario"
          rows={4}
          maxLength={LARGO_MAXIMO_COMENTARIO}
          defaultValue={estado.valores.comentario}
          aria-describedby={descritoPor}
          className={estilos.comentario}
        />
      </div>

      {estado.error && (
        <p id="resena-error" role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar calificación"}
      </button>
    </form>
  );
}
