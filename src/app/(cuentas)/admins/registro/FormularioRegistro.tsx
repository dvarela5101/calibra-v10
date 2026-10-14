"use client";

import { useActionState } from "react";
import { CampoCaptcha } from "@/components/captcha/CampoCaptcha";
import { useTokenCaptcha } from "@/components/captcha/useTokenCaptcha";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { registrarse, type EstadoRegistro } from "./acciones";
import estilos from "./registro.module.css";

const estadoInicial: EstadoRegistro = { error: null, invitacionNoSirve: false, valores: {} };

type Campo = { nombre: string; etiqueta: string; tipo: string; autocompletar: string; ayuda?: string };

const CAMPOS: Campo[] = [
  { nombre: "nombre", etiqueta: "Nombre completo", tipo: "text", autocompletar: "name" },
  { nombre: "contrasena", etiqueta: "Contraseña", tipo: "password", autocompletar: "new-password", ayuda: "Mínimo 8 caracteres." },
  { nombre: "confirmacion", etiqueta: "Repite la contraseña", tipo: "password", autocompletar: "new-password" },
];

export function FormularioRegistro({ token, correo }: { token: string; correo: string }) {
  const [estado, accion, enviando] = useActionState(registrarse, estadoInicial);
  // HU-058 (D-30): al terminar el registro la acción inicia sesión con contraseña, y Auth exige el token.
  const captcha = useTokenCaptcha("registro_admin", enviando);

  if (estado.invitacionNoSirve) {
    return (
      <p role="alert" className={formulario.error}>
        {estado.error}
      </p>
    );
  }

  return (
    <form action={accion} onSubmit={captcha.alEnviar} className={formulario.formulario} noValidate>
      <input type="hidden" name="token" value={token} />

      {/* El correo no se edita ni se envía (la cuenta se crea con el de la invitación): texto, no un campo que lo corte. */}
      <dl className={formulario.campo}>
        <dt className={formulario.etiqueta}>Correo</dt>
        <dd className={estilos.correo}>{correo}</dd>
      </dl>

      {CAMPOS.map((campo) => (
        <div key={`${campo.nombre}-${estado.valores[campo.nombre] ?? ""}`} className={formulario.campo}>
          <label htmlFor={campo.nombre} className={formulario.etiqueta}>
            {campo.etiqueta}
          </label>
          {campo.ayuda && (
            <p id={`${campo.nombre}-ayuda`} className={formulario.ayuda}>
              {campo.ayuda}
            </p>
          )}
          <input
            id={campo.nombre}
            name={campo.nombre}
            type={campo.tipo}
            autoComplete={campo.autocompletar}
            aria-describedby={campo.ayuda ? `${campo.nombre}-ayuda` : undefined}
            // React vacía el formulario al terminar la acción: tras un error se devuelve lo escrito (menos las contraseñas).
            defaultValue={campo.tipo === "password" ? undefined : estado.valores[campo.nombre]}
            required
            className={formulario.entrada}
          />
        </div>
      ))}

      <CampoCaptcha captcha={captcha} />

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando || captcha.verificando}>
        {captcha.verificando ? TEXTO_VERIFICANDO : enviando ? "Creando tu cuenta…" : "Crear mi cuenta"}
      </button>
    </form>
  );
}
