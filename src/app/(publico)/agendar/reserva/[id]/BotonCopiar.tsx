"use client";

import { useState } from "react";
import formulario from "@/components/formulario.module.css";

type Props = {
  /** Lo que se copia: el mismo texto del campo `idCampo`. */
  texto: string;
  /** El campo de solo lectura que muestra el texto; si el portapapeles falla, se selecciona para copiarlo a mano. */
  idCampo: string;
};

/**
 * Copia la llave de Calibra al portapapeles (HU-018, RN-40). El portapapeles solo existe con https o en
 * localhost, y el navegador puede negarlo: entonces la llave queda seleccionada en su campo para que la persona
 * la copie con el menú o el teclado. El resultado se anuncia en un `role="status"` que está en la página desde
 * el principio (si apareciera junto con el texto, un lector de pantalla podría no leerlo).
 */
export function BotonCopiar({ texto, idCampo }: Props) {
  const [aviso, setAviso] = useState<{ texto: string; copiada: boolean } | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso({ texto: "Copiada.", copiada: true });
    } catch {
      const campo = document.getElementById(idCampo);
      if (campo instanceof HTMLInputElement) {
        campo.focus();
        campo.select();
      }
      setAviso({ texto: "No pudimos copiarla: quedó seleccionada para que la copies.", copiada: false });
    }
  }

  return (
    <>
      <button type="button" onClick={copiar} className={formulario.botonSecundario}>
        Copiar llave
      </button>
      <p role="status" className={aviso?.copiada === false ? formulario.ayuda : formulario.exito}>
        {aviso?.texto}
      </p>
    </>
  );
}
