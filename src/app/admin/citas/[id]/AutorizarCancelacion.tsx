"use client";

import { useActionState, type FormEvent, type KeyboardEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { AYUDA_DE_LA_NOTA, CATEGORIAS, ETIQUETA_DE_LA_NOTA, LARGO_MAXIMO_NOTA, TEXTOS_DE_CATEGORIA } from "@/lib/admin/citas-reglas";
import { autorizar, type EstadoAutorizacion } from "./acciones";
import estilos from "./cita.module.css";

const estadoInicial: EstadoAutorizacion = { error: null, valores: { categoria: "", nota: "" } };

/**
 * Defensa: un envío con la confirmación cerrada no llega a la acción, como al cerrar un caso o ejecutar un desembolso. Con
 * los campos dentro de ella no debería ocurrir, pero el navegador envía con el botón de confirmar aunque esté oculto.
 */
function soloConLaConfirmacionAbierta(evento: FormEvent<HTMLFormElement>) {
  if (!evento.currentTarget.closest("details")?.open) evento.preventDefault();
}

/**
 * Defensa: Enter sobre un motivo no envía. El navegador hace el «envío implícito» con Enter sobre un radio (hay un botón de
 * enviar) y cancelaría la monitoría sin que nadie pulse «Sí, cancelar la monitoría»; el freno de arriba no lo ve, porque los
 * radios solo reciben foco con la confirmación abierta. Solo envía el botón (clic, Enter o Espacio sobre él). En la nota Enter
 * escribe un salto de línea y no envía, así que ahí no se toca. Se lee el elemento por sus propiedades y no con `instanceof`.
 */
function enterSobreUnMotivoNoEnvia(evento: KeyboardEvent<HTMLFormElement>) {
  const objetivo = evento.target as { tagName?: string; type?: string };
  if (evento.key === "Enter" && objetivo.tagName === "INPUT" && objetivo.type === "radio") evento.preventDefault();
}

/**
 * HU-052: autorizar la cancelación de una cita fuera de plazo, con un motivo de la lista y una nota (obligatoria con
 * «Otro»). Cancelar no se deshace, así que todo el formulario va dentro de una confirmación, como al cerrar un caso (HU-078):
 * un `<details>` que, al abrirse, dice qué cambia y trae el motivo, la nota y el botón. Así nada se envía sin abrirla. Quién
 * autoriza y cuándo lo pone la base con la sesión.
 */
export function AutorizarCancelacion({ idMonitoria, consecuencias }: { idMonitoria: string; consecuencias: string }) {
  const [estado, accion, enviando] = useActionState(autorizar, estadoInicial);
  // La llave remonta los campos con lo devuelto tras un error (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    // Abierto si volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.confirmar} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>Autorizar la cancelación</summary>
      <p id="autorizar-consecuencias" className={estilos.consecuencias}>
        {consecuencias}
      </p>
      <form action={accion} onSubmit={soloConLaConfirmacionAbierta} onKeyDown={enterSobreUnMotivoNoEnvia} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_monitoria" value={idMonitoria} />
        <div key={llave} className={estilos.campos}>
          <fieldset className={estilos.grupo}>
            <legend className={formulario.etiqueta}>Motivo</legend>
            {CATEGORIAS.map((categoria) => (
              <label key={categoria} className={estilos.opcion}>
                <input type="radio" name="categoria" value={categoria} defaultChecked={estado.valores.categoria === categoria} className={estilos.radio} />
                {TEXTOS_DE_CATEGORIA[categoria]}
              </label>
            ))}
          </fieldset>

          <div className={formulario.campo}>
            <label htmlFor="nota" className={formulario.etiqueta}>
              {ETIQUETA_DE_LA_NOTA}
            </label>
            <p id="nota-ayuda" className={formulario.ayuda}>
              {AYUDA_DE_LA_NOTA}
            </p>
            <textarea
              id="nota"
              name="nota"
              rows={4}
              maxLength={LARGO_MAXIMO_NOTA}
              defaultValue={estado.valores.nota}
              aria-describedby="nota-ayuda"
              className={`${formulario.entrada} ${estilos.campoNota}`}
            />
          </div>
        </div>

        {estado.error && (
          <p role="alert" className={formulario.error}>
            {estado.error}
          </p>
        )}

        <button type="submit" aria-describedby="autorizar-consecuencias" className={formulario.boton} disabled={enviando}>
          {enviando ? "Cancelando…" : "Sí, cancelar la monitoría"}
        </button>
      </form>
    </details>
  );
}
