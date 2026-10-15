"use client";

import { useActionState } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import { CasillasConsentimiento } from "@/components/CasillasConsentimiento";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { CORREO_FIJO } from "@/lib/leads/avisos";
import { dejarContacto, type EstadoContacto } from "./acciones";

export type ValoresDeContacto = { nombre: string; correo: string; numero_telefono: string };

const estadoInicial: EstadoContacto = { error: null, aviso: null, valores: {} };

type Props = {
  siguiente: string;
  iniciales: ValoresDeContacto;
  /** La acción del formulario. Por defecto, la de agendar (`dejarContacto`); `/cuenta/crear` pasa la suya (HU-032). */
  accion?: (anterior: EstadoContacto, datos: FormData) => Promise<EstadoContacto>;
  /** El texto del botón de envío, y el que lleva mientras espera. */
  textoDelBoton?: string;
  textoDelBotonEnviando?: string;
  /** Lo que se dice bajo el correo. */
  ayudaDelCorreo?: string;
  /**
   * El correo de la cuenta de un Estudiante no se cambia aquí (D-55 b, HU-032): se muestra sin poder editarlo y con
   * la ayuda que dice por qué. `readOnly` sí viaja en el envío, y la acción lo compara con el Lead por si se manda otro.
   */
  correoFijo?: boolean;
};

/** HU-068: nombre, correo y teléfono opcional (P-21, P-22), con la autorización de datos (RN-13). */
export function FormularioContacto({
  siguiente,
  iniciales,
  accion: accionDelFormulario = dejarContacto,
  textoDelBoton = "Seguir",
  textoDelBotonEnviando = "Guardando…",
  ayudaDelCorreo = "Ahí te llega la confirmación de tu cita.",
  correoFijo = false,
}: Props) {
  const [estado, accion, enviando] = useActionState(accionDelFormulario, estadoInicial);
  // HU-058: sin sesión lista, el envío espera la verificación; el aviso solo sale si no se logra.
  const sesion = useExigirSesionAnonima();
  // Un correo fijo muestra siempre el de la cuenta, aunque lo devuelto por una acción traiga otro.
  const valor = (campo: keyof ValoresDeContacto) => (correoFijo && campo === "correo" ? iniciales.correo : (estado.valores[campo] ?? iniciales[campo]));
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    <form key={llave} action={accion} onSubmit={sesion.alEnviar} className={formulario.formulario} noValidate>
      <input type="hidden" name="siguiente" value={siguiente} />

      <div className={formulario.campo}>
        <label htmlFor="nombre" className={formulario.etiqueta}>
          Tu nombre
        </label>
        <input id="nombre" name="nombre" autoComplete="name" defaultValue={valor("nombre")} required className={formulario.entrada} />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Tu correo
        </label>
        <p id="correo-ayuda" className={formulario.ayuda}>
          {correoFijo ? CORREO_FIJO : ayudaDelCorreo}
        </p>
        <input
          id="correo"
          name="correo"
          type="email"
          autoComplete="email"
          defaultValue={valor("correo")}
          aria-describedby="correo-ayuda"
          readOnly={correoFijo}
          required
          className={formulario.entrada}
        />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="numero_telefono" className={formulario.etiqueta}>
          Tu teléfono (opcional)
        </label>
        <p id="telefono-ayuda" className={formulario.ayuda}>
          Con indicativo, por ejemplo +57 300 123 4567. Sin indicativo, se toma el de Colombia.
        </p>
        <input
          id="numero_telefono"
          name="numero_telefono"
          type="tel"
          autoComplete="tel"
          defaultValue={valor("numero_telefono")}
          aria-describedby="telefono-ayuda"
          className={formulario.entrada}
        />
      </div>

      <CasillasConsentimiento />

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.aviso && (
        <p role="status" className={formulario.exito}>
          {estado.aviso}
        </p>
      )}
      {sesion.aviso}

      <button type="submit" className={formulario.boton} disabled={enviando || sesion.verificando}>
        {sesion.verificando ? TEXTO_VERIFICANDO : enviando ? textoDelBotonEnviando : textoDelBoton}
      </button>
    </form>
  );
}
