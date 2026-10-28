"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { guardarLugar, type EstadoLugar } from "./acciones";
import estilos from "./agenda.module.css";

const estadoInicial: EstadoLugar = { error: null, exito: null };

type Props = {
  idMonitoria: string;
  presencial: boolean;
  /** El dato guardado, para empezar el campo con él. */
  valor: string | null;
  /** El id del renglón de fecha y hora de la tarjeta: el campo se repite en cada una y su descripción dice de cuál es. */
  descripcion: string;
};

/**
 * HU-107 (D-76): el monitor pone o cambia el lugar de la presencial o el enlace de la virtual de una monitoría. Las reglas las
 * aplica la base; sus mensajes se muestran tal cual.
 */
export function FormularioLugar({ idMonitoria, presencial, valor, descripcion }: Props) {
  const [estado, accion, enviando] = useActionState(guardarLugar, estadoInicial);
  const campo = `lugar-${idMonitoria}`;

  return (
    <form action={accion} className={estilos.lugar} noValidate>
      <input type="hidden" name="monitoria" value={idMonitoria} />
      <input type="hidden" name="presencial" value={presencial ? "si" : "no"} />
      <div className={formulario.campo}>
        <label htmlFor={campo} className={formulario.etiqueta}>
          {presencial ? "Lugar de la sesión" : "Enlace de la videollamada"}
        </label>
        <input
          id={campo}
          name="valor"
          type={presencial ? "text" : "url"}
          inputMode={presencial ? "text" : "url"}
          placeholder={presencial ? "Edificio y salón" : "https://"}
          defaultValue={valor ?? ""}
          autoComplete="off"
          aria-describedby={descripcion}
          required
          className={formulario.entrada}
        />
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

      <button type="submit" aria-describedby={descripcion} className={formulario.botonSecundario} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
