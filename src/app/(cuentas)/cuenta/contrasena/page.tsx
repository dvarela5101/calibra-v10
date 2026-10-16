import type { Metadata } from "next";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_CREAR_CUENTA, TEXTOS } from "@/lib/cuentas/reglas";
import { FormularioNuevaContrasena } from "../../restablecer/nueva/FormularioNuevaContrasena";
import { elegirDespues, guardarContrasenaDeCuenta } from "./acciones";

export const metadata: Metadata = {
  title: "Elige tu contraseña · Calibra",
  robots: { index: false, follow: false },
};

/**
 * HU-032, criterio 6: el último paso de crear la cuenta. Solo para quien ya es Estudiante (acaba de confirmar su correo);
 * una sesión anónima, sin sesión, sin rol o del equipo va a `/cuenta/crear` sin ver el formulario. Quien la deja sin
 * elegir es Estudiante igual y la fija después con «¿Olvidaste tu contraseña?».
 */
export default async function ElegirContrasena() {
  const sesion = await obtenerSesion();
  if (sesion?.rol !== "estudiante") redirect(RUTA_CREAR_CUENTA);

  return (
    <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.contrasenaTitulo} subtitulo={TEXTOS.contrasena}>
      <FormularioNuevaContrasena accion={guardarContrasenaDeCuenta} textoDelBoton={TEXTOS.botonGuardarContrasena} />
      <form action={elegirDespues}>
        <button type="submit" className={formulario.botonSecundario}>
          {TEXTOS.elegirDespues}
        </button>
      </form>
      <p className={formulario.ayuda}>{TEXTOS.elegirDespuesNota}</p>
    </Pantalla>
  );
}
