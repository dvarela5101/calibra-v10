import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import { RUTA_CREAR_CUENTA, TEXTOS, tieneFormaDeTokenDeAuth } from "@/lib/cuentas/reglas";
import { FormularioConfirmarCuenta } from "./FormularioConfirmarCuenta";

export const metadata: Metadata = {
  title: "Confirma tu correo · Calibra",
  // La dirección trae el token del correo: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-032, criterio 3: el enlace del correo de Auth. Abrirlo, una vez o varias, por la persona o por un revisor de enlaces,
 * no gasta nada: esta página no llama a Auth ni lee la base con el token, solo comprueba su forma y pinta el botón. Por
 * eso tampoco puede mostrar el correo que confirma (saberlo gastaría el token). Vive en `(cuentas)`, que no crea la
 * sesión anónima: abrirlo desde otro dispositivo no deja una sesión que choque con la que deja la confirmación.
 */
export default async function ConfirmarCuenta({ searchParams }: PageProps<"/cuenta/confirmar">) {
  const { token_hash: tokenHash } = await searchParams;

  // Quien ya terminó y vuelve a abrir el correo no necesita el botón.
  const sesion = await obtenerSesion();
  if (sesion?.rol === "estudiante") redirect(RUTA_DE_CITAS);

  // Un token vacío, repetido (`?token_hash=a&token_hash=b` llega como arreglo) o sin la forma de uno no es un enlace.
  if (!tieneFormaDeTokenDeAuth(tokenHash)) {
    return (
      <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.enlaceNoSirveTitulo} subtitulo={TEXTOS.enlaceNoSirve}>
        <Link href={RUTA_CREAR_CUENTA} className={formulario.enlace}>
          {TEXTOS.botonCrear}
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.confirmarTitulo} subtitulo={TEXTOS.confirmar}>
      <FormularioConfirmarCuenta tokenHash={tokenHash} />
    </Pantalla>
  );
}
