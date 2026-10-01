import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";

export const metadata: Metadata = { title: "Página no encontrada · Calibra" };

/**
 * HU-071: lo que se ve cuando una ruta no existe o una página llama `notFound()`, por ejemplo una reserva
 * abierta desde otra sesión. No dice cuál de las dos pasó: una reserva ajena y una que no existe se ven igual.
 */
export default function NoEncontrada() {
  return (
    <Pantalla
      eyebrow="Error 404"
      titulo="No encontramos esta página"
      subtitulo="Puede que el enlace esté incompleto, que la página ya no exista o que no se pueda ver desde esta sesión."
    >
      <Link href="/" className={formulario.boton}>
        Ir al inicio
      </Link>
    </Pantalla>
  );
}
