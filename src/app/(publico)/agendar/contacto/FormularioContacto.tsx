"use client";

import { useActionState } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import { CasillasConsentimiento } from "@/components/CasillasConsentimiento";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { dejarContacto, type EstadoContacto } from "./acciones";

export type ValoresDeContacto = { nombre: string; correo: string; numero_telefono: string };

const estadoInicial: EstadoContacto = { error: null, aviso: null, valores: {} };

/** HU-068: nombre, correo y teléfono opcional (P-21, P-22), con la autorización de datos (RN-13). */
export function FormularioContacto({ siguiente, iniciales }: { siguiente: string; iniciales: ValoresDeContacto }) {
  const [estado, accion, enviando] = useActionState(dejarContacto, estadoInicial);
  // HU-058: sin sesión lista, el envío espera la verificación; el aviso solo sale si no se logra.
  const sesion = useExigirSesionAnonima();
  const valor = (campo: keyof ValoresDeContacto) => estado.valores[campo] ?? iniciales[campo];
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
          Ahí te llega la confirmación de tu cita.
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
        {sesion.verificando ? TEXTO_VERIFICANDO : enviando ? "Guardando…" : "Seguir"}
      </button>
    </form>
  );
}
