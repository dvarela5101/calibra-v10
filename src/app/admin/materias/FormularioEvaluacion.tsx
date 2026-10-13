"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { GUARDAR_FALLO } from "@/lib/materias/reglas";
import { guardarEvaluacion, type EstadoEvaluacion } from "./acciones";
import estilos from "./materias.module.css";
import { sinCaerse } from "./sinCaerse";

const estadoInicial: EstadoEvaluacion = { errores: {}, error: null, exito: null, valores: {} };

const guardarSinCaerse = sinCaerse(guardarEvaluacion, (_anterior, datos): EstadoEvaluacion => ({
  errores: {},
  error: GUARDAR_FALLO,
  exito: null,
  valores: { nombre: String(datos.get("nombre") ?? ""), semana: String(datos.get("semana") ?? "") },
}));

type Props = {
  evaluacion: { id: string; nombre: string; semana: number };
  /** El id del título de la tarjeta (el h3 con el nombre): le da nombre accesible al formulario. */
  idTitulo: string;
};

/**
 * HU-055 (D-62 b): corregir el nombre y la semana de una evaluación del banco. Su estado activo, sus temas y si es
 * acumulativa no se tocan desde la app. Los `id` de los campos llevan el de la evaluación: hay uno por tarjeta.
 */
export function FormularioEvaluacion({ evaluacion, idTitulo }: Props) {
  const [estado, accion, enviando] = useActionState(guardarSinCaerse, estadoInicial);
  const nombre = estado.valores.nombre ?? evaluacion.nombre;
  const semana = estado.valores.semana ?? String(evaluacion.semana);
  // Como en FormularioMateria: la llave remonta solo los campos tras cada respuesta con valores nuevos.
  const llave = JSON.stringify(estado.valores);
  const idNombre = `evaluacion-nombre-${evaluacion.id}`;
  const idSemana = `evaluacion-semana-${evaluacion.id}`;

  return (
    <form action={accion} aria-labelledby={idTitulo} className={formulario.formulario} noValidate>
      <input type="hidden" name="id" value={evaluacion.id} />
      <div key={llave} className={estilos.campos}>
        <div className={formulario.campo}>
          <label htmlFor={idNombre} className={formulario.etiqueta}>
            Nombre
          </label>
          <input
            id={idNombre}
            name="nombre"
            type="text"
            defaultValue={nombre}
            autoComplete="off"
            required
            aria-invalid={estado.errores.nombre ? true : undefined}
            aria-describedby={estado.errores.nombre ? `${idNombre}-error` : undefined}
            className={formulario.entrada}
          />
          {estado.errores.nombre && (
            <p id={`${idNombre}-error`} role="alert" className={formulario.error}>
              {estado.errores.nombre}
            </p>
          )}
        </div>

        <div className={formulario.campo}>
          <label htmlFor={idSemana} className={formulario.etiqueta}>
            Semana
          </label>
          <input
            id={idSemana}
            name="semana"
            type="text"
            inputMode="numeric"
            defaultValue={semana}
            autoComplete="off"
            required
            aria-invalid={estado.errores.semana ? true : undefined}
            aria-describedby={estado.errores.semana ? `${idSemana}-error` : undefined}
            className={formulario.entrada}
          />
          {estado.errores.semana && (
            <p id={`${idSemana}-error`} role="alert" className={formulario.error}>
              {estado.errores.semana}
            </p>
          )}
        </div>
      </div>

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

      <button type="submit" className={formulario.botonSecundario} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar evaluación"}
      </button>
    </form>
  );
}
