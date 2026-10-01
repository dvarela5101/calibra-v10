"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import formulario from "@/components/formulario.module.css";
import { RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import { registrarse, type EstadoRegistro } from "./acciones";

const estadoInicial: EstadoRegistro = { error: null, invitacionNoSirve: false, valores: {} };

type Campo = { nombre: string; etiqueta: string; tipo: string; autocompletar: string; ayuda?: ReactNode };

const CAMPOS: Campo[] = [
  {
    nombre: "nombre",
    etiqueta: "Nombre completo",
    tipo: "text",
    autocompletar: "name",
    // D-6 (HU-069): la lista de monitores de cada materia muestra este nombre tal cual.
    ayuda: (
      <>
        Así te verán los estudiantes en la lista de monitores de tus materias. Más en el{" "}
        {/* En otra pestaña, para no perder lo que ya escribió en el formulario. */}
        <Link href={RUTA_AVISO} target="_blank" rel="noopener" className={formulario.enlaceEnTexto}>
          aviso de privacidad (se abre en otra pestaña)
        </Link>
        .
      </>
    ),
  },
  { nombre: "numero_telefono", etiqueta: "Teléfono", tipo: "tel", autocompletar: "tel" },
  {
    nombre: "llave",
    etiqueta: "Tu llave",
    tipo: "text",
    autocompletar: "off",
    ayuda: "Es donde te pagamos: tu celular, tu correo o el alias que tengas registrado en tu banco.",
  },
  { nombre: "contrasena", etiqueta: "Contraseña", tipo: "password", autocompletar: "new-password", ayuda: "Mínimo 8 caracteres." },
  { nombre: "confirmacion", etiqueta: "Repite la contraseña", tipo: "password", autocompletar: "new-password" },
];

export function FormularioRegistro({ token, correo }: { token: string; correo: string }) {
  const [estado, accion, enviando] = useActionState(registrarse, estadoInicial);

  if (estado.invitacionNoSirve) {
    return (
      <p role="alert" className={formulario.error}>
        {estado.error}
      </p>
    );
  }

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <input type="hidden" name="token" value={token} />

      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Correo
        </label>
        <input id="correo" type="email" value={correo} readOnly className={formulario.entrada} />
      </div>

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

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Creando tu cuenta…" : "Crear mi cuenta"}
      </button>
    </form>
  );
}
