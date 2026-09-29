import Link from "next/link";
import { CASILLA_CONTACTO, CASILLA_TRATAMIENTO, MARCADA, RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import estilos from "./casillas.module.css";

/**
 * Las dos autorizaciones del formulario de contacto (RN-13). Ambas vienen desmarcadas: la de
 * tratamiento de datos es obligatoria y enlaza al aviso; la de contacto comercial es aparte y opcional.
 * El servidor las lee con `leerConsentimiento`.
 */
export function CasillasConsentimiento() {
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
          className={estilos.control}
        />
        <label htmlFor={CASILLA_TRATAMIENTO} className={estilos.texto}>
          Autorizo a Calibra a tratar mis datos personales, incluido compartir el resultado de mi diagnóstico con
          el monitor de mi monitoría, según el{" "}
          {/* En otra pestaña, para no perder lo que ya escribió en el formulario. */}
          <Link href={RUTA_AVISO} target="_blank" rel="noopener" className={estilos.enlace}>
            aviso de privacidad (se abre en otra pestaña)
          </Link>
          . (Obligatorio)
        </label>
      </div>

      <div className={estilos.casilla}>
        <input id={CASILLA_CONTACTO} name={CASILLA_CONTACTO} type="checkbox" value={MARCADA} className={estilos.control} />
        <label htmlFor={CASILLA_CONTACTO} className={estilos.texto}>
          Quiero que Calibra me escriba con novedades y ofertas. (Opcional)
        </label>
      </div>
    </fieldset>
  );
}
