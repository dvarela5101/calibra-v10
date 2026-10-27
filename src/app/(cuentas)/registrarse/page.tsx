import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { RUTA_DE_INGRESO } from "@/lib/auth/acceso";
import { PANEL_POR_ROL, tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import { RUTA_CREAR_CUENTA } from "@/lib/cuentas/reglas";
import estilos from "./registrarse.module.css";

export const metadata: Metadata = { title: "Registrarse · Calibra" };

/**
 * D-75 b: a dónde lleva «Registrarse». Hay dos maneras de tener cuenta y no se mezclan: la del estudiante, que crea él mismo
 * (HU-032), y la del monitor, que llega por invitación después de la evaluación presencial (P-20); aquí solo se pide.
 */
export default async function Registrarse() {
  const sesion = await obtenerSesion();
  if (sesion && tienePanel(sesion.rol)) redirect(PANEL_POR_ROL[sesion.rol]);
  if (sesion?.rol === "estudiante") redirect(RUTA_DE_CITAS);

  return (
    <Pantalla eyebrow="Tu cuenta de Calibra" titulo="Regístrate" subtitulo="Elige cómo quieres usar Calibra.">
      <section className={estilos.opcion} aria-labelledby="registro-estudiante">
        <h2 id="registro-estudiante" className={estilos.titulo}>
          Soy estudiante
        </h2>
        <p className={estilos.texto}>Guarda tus citas y tus diagnósticos, y míralos desde cualquier dispositivo.</p>
        <Link href={RUTA_CREAR_CUENTA} className={formulario.boton}>
          Crear mi cuenta de estudiante
        </Link>
      </section>
      <section className={estilos.opcion} aria-labelledby="registro-monitor">
        <h2 id="registro-monitor" className={estilos.titulo}>
          Quiero ser monitor
        </h2>
        <p className={estilos.texto}>
          Déjanos tus datos y te contactamos para una evaluación presencial. Si la apruebas, te llega al correo la invitación para
          crear tu cuenta de monitor.
        </p>
        <Link href="/quiero-ser-monitor" className={formulario.botonSecundario}>
          Enviar mi solicitud
        </Link>
      </section>
      <Link href={RUTA_DE_INGRESO} className={formulario.enlace}>
        ¿Ya tienes cuenta? Inicia sesión
      </Link>
    </Pantalla>
  );
}
