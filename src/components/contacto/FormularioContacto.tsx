"use client";

import { useActionState } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import { CasillasConsentimiento } from "@/components/CasillasConsentimiento";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import type { EstadoContacto } from "@/lib/leads/reglas";

const estadoInicial: EstadoContacto = { error: null, aviso: null, valores: {} };

export type ValoresDeContacto = { nombre: string; correo: string; numero_telefono: string };

type Props = {
  /** La acción del servidor que guarda el contacto: la de agendar (HU-068) o la del resultado del diagnóstico (HU-010). */
  accion: (anterior: EstadoContacto, datos: FormData) => Promise<EstadoContacto>;
  /** Campos ocultos que la acción necesita (a dónde sigue al agendar, qué diagnóstico se está viendo). */
  ocultos: Record<string, string>;
  iniciales: ValoresDeContacto;
  /** Para qué se usa el correo, bajo su campo. */
  ayudaDelCorreo: string;
  textoDelBoton: string;
};

/** HU-068 y HU-010: nombre, correo y teléfono opcional (P-21, P-22), con la autorización de datos (RN-13). */
export function FormularioContacto({ accion, ocultos, iniciales, ayudaDelCorreo, textoDelBoton }: Props) {
  const [estado, enviar, enviando] = useActionState(accion, estadoInicial);
  // HU-058: sin sesión lista, el envío espera la verificación; el aviso solo sale si no se logra.
  const sesion = useExigirSesionAnonima();
  const valor = (campo: keyof ValoresDeContacto) => estado.valores[campo] ?? iniciales[campo];
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    <form key={llave} action={enviar} onSubmit={sesion.alEnviar} className={formulario.formulario} noValidate>
      {Object.entries(ocultos).map(([nombre, valorOculto]) => (
        <input key={nombre} type="hidden" name={nombre} value={valorOculto} />
      ))}

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
          {ayudaDelCorreo}
        </p>
        <input
          id="correo"
          name="correo"
          type="email"
          autoComplete="email"
          defaultValue={valor("correo")}
          aria-describedby="correo-ayuda"
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
        {sesion.verificando ? TEXTO_VERIFICANDO : enviando ? "Guardando…" : textoDelBoton}
      </button>
    </form>
  );
}
