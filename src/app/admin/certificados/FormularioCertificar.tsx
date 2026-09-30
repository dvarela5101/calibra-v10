"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { certificar, type EstadoCertificacion } from "./acciones";
import estilos from "./certificados.module.css";

export type Opcion = { id: string; texto: string };

const estadoInicial: EstadoCertificacion = { error: null, exito: null, valores: {} };

/** HU-014: certificar a un monitor en una materia, con la fecha de su evaluación presencial (P-19). */
export function FormularioCertificar({ monitores, materias, hoy }: { monitores: Opcion[]; materias: Opcion[]; hoy: string }) {
  const [estado, accion, enviando] = useActionState(certificar, estadoInicial);
  const valor = (campo: string, porDefecto = "") => estado.valores[campo] ?? porDefecto;
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  // Solo los campos: el botón no se remonta, así no pierde el foco después de un error.
  const llave = JSON.stringify(estado.valores);

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <div key={llave} className={estilos.campos}>
        <div className={formulario.campo}>
          <label htmlFor="id_monitor" className={formulario.etiqueta}>
            Monitor
          </label>
          <select id="id_monitor" name="id_monitor" defaultValue={valor("id_monitor")} required className={formulario.entrada}>
            <option value="">Elige un monitor</option>
            {monitores.map((m) => (
              <option key={m.id} value={m.id}>
                {m.texto}
              </option>
            ))}
          </select>
        </div>

        <div className={formulario.campo}>
          <label htmlFor="id_materia" className={formulario.etiqueta}>
            Materia
          </label>
          <select id="id_materia" name="id_materia" defaultValue={valor("id_materia")} required className={formulario.entrada}>
            <option value="">Elige una materia</option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.texto}
              </option>
            ))}
          </select>
        </div>

        <div className={formulario.campo}>
          <label htmlFor="fecha_evaluacion" className={formulario.etiqueta}>
            Fecha de la evaluación presencial
          </label>
          <p id="evaluacion-ayuda" className={formulario.ayuda}>
            El día en que el monitor aprobó la evaluación con el equipo. Queda como constancia en el certificado.
          </p>
          <input
            id="fecha_evaluacion"
            name="fecha_evaluacion"
            type="date"
            max={hoy}
            defaultValue={valor("fecha_evaluacion", hoy)}
            aria-describedby="evaluacion-ayuda"
            required
            className={formulario.entrada}
          />
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

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Certificando…" : "Certificar"}
      </button>
    </form>
  );
}
