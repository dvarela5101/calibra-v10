"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { LARGO_CARRERA, LARGO_PRESENTACION, type CampoDelPerfil } from "@/lib/monitores/perfil";
import { guardarPerfil, type EstadoPerfil } from "./acciones";
import estilos from "./perfil.module.css";

const estadoInicial: EstadoPerfil = { errores: {}, error: null, exito: null, valores: null };

type Props = { carrera: string; semestre: string; presentacion: string };

/**
 * HU-049: carrera, semestre y presentación. Tras un error se ve lo que el monitor escribió, con el mensaje junto al
 * campo; tras guardar, lo guardado (la página se vuelve a pintar con los valores normalizados).
 */
export function FormularioPerfil(guardado: Props) {
  const [estado, accion, enviando] = useActionState(guardarPerfil, estadoInicial);
  const valores = estado.valores ?? guardado;
  // La llave remonta los campos cuando cambian los valores (React vacía el formulario al enviar).
  const llave = JSON.stringify(valores);

  const atributos = (campo: CampoDelPerfil) => {
    const error = estado.errores[campo];
    return {
      id: campo,
      name: campo,
      defaultValue: valores[campo],
      "aria-invalid": error ? true : undefined,
      "aria-describedby": [`${campo}-ayuda`, error ? `${campo}-error` : null].filter(Boolean).join(" "),
    };
  };
  const errorDe = (campo: CampoDelPerfil) =>
    estado.errores[campo] && (
      <p id={`${campo}-error`} className={formulario.error}>
        {estado.errores[campo]}
      </p>
    );
  const hayErrores = Object.keys(estado.errores).length > 0;

  return (
    <form action={accion} className={formulario.formulario} noValidate key={llave}>
      <div className={formulario.campo}>
        <label htmlFor="carrera" className={formulario.etiqueta}>
          Carrera (opcional)
        </label>
        <p id="carrera-ayuda" className={formulario.ayuda}>
          Hasta {LARGO_CARRERA} caracteres.
        </p>
        <input type="text" autoComplete="off" className={formulario.entrada} {...atributos("carrera")} />
        {errorDe("carrera")}
      </div>

      <div className={formulario.campo}>
        <label htmlFor="semestre" className={formulario.etiqueta}>
          Semestre (opcional)
        </label>
        <p id="semestre-ayuda" className={formulario.ayuda}>
          Un número del 1 al 12.
        </p>
        <input type="text" inputMode="numeric" autoComplete="off" className={formulario.entrada} {...atributos("semestre")} />
        {errorDe("semestre")}
      </div>

      <div className={formulario.campo}>
        <label htmlFor="presentacion" className={formulario.etiqueta}>
          Presentación (opcional)
        </label>
        <p id="presentacion-ayuda" className={formulario.ayuda}>
          Hasta {LARGO_PRESENTACION} caracteres. Cada línea se ve como un párrafo. No escribas teléfonos, correos ni enlaces.
        </p>
        <textarea rows={6} className={estilos.presentacion} {...atributos("presentacion")} />
        {errorDe("presentacion")}
      </div>

      {hayErrores && (
        <p role="alert" className={formulario.error}>
          No guardamos nada: revisa los campos marcados.
        </p>
      )}
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.exito && (
        <p role="status" className={formulario.exito}>
          {estado.exito}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar mi perfil"}
      </button>
    </form>
  );
}
