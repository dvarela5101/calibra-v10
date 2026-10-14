import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";

export const metadata: Metadata = { title: "No encontramos ese resultado · Calibra" };

/**
 * HU-009: lo que ve quien abre la dirección de un resultado que no es suyo (de otra sesión, del equipo, de un Lead ajeno), que
 * no existe o que tiene un id mal escrito. No dice cuál de los casos pasó, como la página 404 general (HU-071), y no muestra
 * ningún dato del resultado.
 */
export default function ResultadoNoEncontrado() {
  return (
    <Pantalla eyebrow="Error 404" titulo={TEXTOS.tituloNoEncontrado} subtitulo={TEXTOS.notaNoEncontrado}>
      <Link href={rutaDeDiagnostico()} className={formulario.boton}>
        {TEXTOS.hacerElDiagnostico}
      </Link>
    </Pantalla>
  );
}
