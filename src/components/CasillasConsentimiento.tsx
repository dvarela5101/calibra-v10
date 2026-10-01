import Link from "next/link";
import { CASILLA_CONTACTO, CASILLA_TRATAMIENTO, MARCADA, RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import estilos from "./casillas.module.css";

/**
 * Las autorizaciones de un formulario con datos personales (RN-13). Vienen desmarcadas; la de
 * tratamiento de datos es obligatoria y enlaza al aviso. El servidor las lee con `leerConsentimiento`.
 *
 * - `estudiante` (por defecto, formulario de contacto): además del tratamiento, una casilla aparte y
 *   opcional para recibir novedades.
 * - `aspirante` (HU-062, "Quiero ser monitor"): solo el tratamiento, para contactarlo y evaluar su
 *   certificación.
 */
export function CasillasConsentimiento({
  variante = "estudiante",
  tratamientoMarcado = false,
}: {
  variante?: "estudiante" | "aspirante";
  /** La autorización ya se había marcado en un envío que volvió con otro error: se conserva. */
  tratamientoMarcado?: boolean;
}) {
  const aviso = (
    // En otra pestaña, para no perder lo que ya escribió en el formulario.
    <Link href={RUTA_AVISO} target="_blank" rel="noopener" className={estilos.enlace}>
      aviso de privacidad (se abre en otra pestaña)
    </Link>
  );

  return (
    <fieldset className={estilos.grupo}>
      <legend className={estilos.leyenda}>Tus datos</legend>

      <div className={estilos.casilla}>
        <input
          id={CASILLA_TRATAMIENTO}
          name={CASILLA_TRATAMIENTO}
          type="checkbox"
          value={MARCADA}
          required
          defaultChecked={tratamientoMarcado}
          className={estilos.control}
        />
        <label htmlFor={CASILLA_TRATAMIENTO} className={estilos.texto}>
          {variante === "aspirante" ? (
            <>
              Autorizo a Calibra a tratar mis datos personales para contactarme y evaluar mi certificación como monitor,
              según el {aviso}. (Obligatorio)
            </>
          ) : (
            <>
              Autorizo a Calibra a tratar mis datos personales, incluido compartir el resultado de mi diagnóstico con el
              monitor de mi monitoría, según el {aviso}. (Obligatorio)
            </>
          )}
        </label>
      </div>

      {variante === "estudiante" && (
        <div className={estilos.casilla}>
          <input id={CASILLA_CONTACTO} name={CASILLA_CONTACTO} type="checkbox" value={MARCADA} className={estilos.control} />
          <label htmlFor={CASILLA_CONTACTO} className={estilos.texto}>
            Quiero que Calibra me escriba con novedades y ofertas. (Opcional)
          </label>
        </div>
      )}
    </fieldset>
  );
}
