"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { entregarLlave, type EstadoEntregar } from "./acciones";

const estadoInicial: EstadoEntregar = { error: null, valor: "" };

export const SIN_RESPUESTA = "No pudimos comunicarnos con Calibra. Revisa tu conexión e inténtalo de nuevo.";

/**
 * La acción, sin que un fallo de la red o un despliegue nuevo tumbe la página. Volver a intentar es seguro: si la
 * primera vez sí llegó, la base responde `ya_entregada` y la acción lleva a la página, que dice que ya la recibimos. El
 * `redirect` de la acción llega aquí como un rechazo: no es una falla, se deja pasar para que Next haga la navegación.
 */
export async function entregarSinCaerse(anterior: EstadoEntregar, datos: FormData): Promise<EstadoEntregar> {
  try {
    return await entregarLlave(anterior, datos);
  } catch (error) {
    unstable_rethrow(error);
    const escrito = datos.get("llave");
    return { error: SIN_RESPUESTA, valor: typeof escrito === "string" ? escrito : "" };
  }
}

type Props = {
  /** El token del enlace del correo: viaja en un campo oculto, como en la página de la cita. */
  token: string;
  /** Qué revisar antes de enviarla y, si se conoce, a quién escribirle si se equivoca. */
  ayuda: string;
};

/**
 * HU-025 (criterio 2): el campo de la llave y el botón. La acción guarda y vuelve a la página, que ya dice que la
 * recibimos. Con un error, el campo conserva lo escrito y el mensaje se anuncia. Necesita JavaScript, como cancelar la
 * cita (HU-024): la acción va dentro de `entregarSinCaerse`, una función del navegador, y React no puede enviar sin
 * JavaScript un formulario cuya acción no es la del servidor. Sin JavaScript el botón no envía nada, ni a la base ni a la
 * dirección (lo comprueba e2e/llave-reembolso.spec.ts).
 */
export function FormularioDeLlave({ token, ayuda }: Props) {
  const [estado, accion, enviando] = useActionState(entregarSinCaerse, estadoInicial);
  const descritoPor = estado.error ? "llave-ayuda llave-error" : "llave-ayuda";

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <input type="hidden" name="token" value={token} />

      {/* El `key` remonta el campo cuando vuelve lo escrito (React vacía el formulario al enviar). */}
      <div key={estado.valor} className={formulario.campo}>
        <label htmlFor="llave" className={formulario.etiqueta}>
          Tu llave
        </label>
        <p id="llave-ayuda" className={formulario.ayuda}>
          {ayuda}
        </p>
        <input
          id="llave"
          name="llave"
          type="text"
          defaultValue={estado.valor}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={estado.error ? true : undefined}
          aria-describedby={descritoPor}
          className={formulario.entrada}
        />
      </div>

      {estado.error && (
        <p id="llave-error" role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar mi llave"}
      </button>
    </form>
  );
}
