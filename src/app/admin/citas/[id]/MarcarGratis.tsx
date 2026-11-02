"use client";

import { useActionState, type FormEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { CONSECUENCIAS_DE_GRATIS, TEXTOS_DEL_BOTON, type AccionDeGratis } from "@/lib/admin/gratis-reglas";
import { cambiarMarcaGratis, type EstadoMarca } from "./acciones";
import estilos from "./cita.module.css";

const estadoInicial: EstadoMarca = { error: null };

/** Defensa: un envío con la confirmación cerrada no llega a la acción, como al autorizar una cancelación. */
function soloConLaConfirmacionAbierta(evento: FormEvent<HTMLFormElement>) {
  if (!evento.currentTarget.closest("details")?.open) evento.preventDefault();
}

/**
 * HU-116: marcar una monitoría por pagar como de prueba (queda confirmada y gratis) o quitarle la marca. Va dentro de una
 * confirmación, como autorizar una cancelación (HU-052): un `<details>` que, al abrirse, dice qué cambia y trae el botón.
 * Quién y cuándo lo pone la base con la sesión.
 */
export function MarcarGratis({ idMonitoria, accion }: { idMonitoria: string; accion: AccionDeGratis }) {
  const [estado, enviar, enviando] = useActionState(cambiarMarcaGratis, estadoInicial);
  const textos = TEXTOS_DEL_BOTON[accion];

  return (
    // Abierto si volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.confirmar} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>{textos.abrir}</summary>
      <p id="gratis-consecuencias" className={estilos.consecuencias}>
        {CONSECUENCIAS_DE_GRATIS[accion]}
      </p>
      <form action={enviar} onSubmit={soloConLaConfirmacionAbierta} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_monitoria" value={idMonitoria} />
        <input type="hidden" name="gratis" value={accion === "marcar" ? "1" : "0"} />
        {estado.error && (
          <p role="alert" className={formulario.error}>
            {estado.error}
          </p>
        )}
        <button type="submit" aria-describedby="gratis-consecuencias" className={formulario.boton} disabled={enviando}>
          {enviando ? textos.enviando : textos.enviar}
        </button>
      </form>
    </details>
  );
}
