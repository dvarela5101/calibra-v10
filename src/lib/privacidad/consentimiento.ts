import { esCorreo } from "@/lib/correo/contacto";

/**
 * Autorización de tratamiento de datos (RN-13, Ley 1581 de 2012).
 *
 * Los nombres de las casillas son los de las columnas de `public.lead`, para que el formulario que
 * guarda el Lead (HU-010) pase el resultado tal cual. La base también exige la autorización
 * (`lead_autoriza_datos`), y sin Lead no hay monitoría (`monitoria.id_lead` es obligatorio): quien no
 * autoriza no deja su contacto ni agenda.
 */
export const CASILLA_TRATAMIENTO = "acepta_tratamiento_datos";
export const CASILLA_CONTACTO = "acepta_contacto";

/** Valor que envía una casilla marcada. Una desmarcada no envía nada. */
export const MARCADA = "si";

export const RUTA_AVISO = "/privacidad";

/**
 * Día de la última actualización del texto del aviso (`AAAA-MM-DD`). Se cambia con cada cambio del texto:
 * HU-069 (1-oct-2026) agregó que el nombre del monitor se muestra a los estudiantes.
 */
export const AVISO_ACTUALIZADO = "2026-10-01";

export const ERROR_SIN_AUTORIZACION =
  "Para dejar tu contacto o agendar necesitamos tu autorización para tratar tus datos.";

export type Consentimiento = {
  acepta_tratamiento_datos: true;
  /** Momento en que el servidor recibió la autorización, en ISO 8601 (UTC). */
  fecha_consentimiento: string;
  acepta_contacto: boolean;
};

export type ResultadoConsentimiento = { ok: true; consentimiento: Consentimiento } | { ok: false; error: string };

/**
 * Lee las casillas de un formulario enviado. La fecha la pone el servidor (nunca el navegador) y es el
 * instante absoluto del envío; la zona del negocio solo importa al mostrarla.
 */
export function leerConsentimiento(formulario: FormData, ahora: Date = new Date()): ResultadoConsentimiento {
  if (formulario.get(CASILLA_TRATAMIENTO) !== MARCADA) return { ok: false, error: ERROR_SIN_AUTORIZACION };
  return {
    ok: true,
    consentimiento: {
      acepta_tratamiento_datos: true,
      fecha_consentimiento: ahora.toISOString(),
      acepta_contacto: formulario.get(CASILLA_CONTACTO) === MARCADA,
    },
  };
}

/**
 * Correo dedicado a consultas de datos personales (R-1), desde `CORREO_DATOS_PERSONALES`. Si falta o no
 * es un correo, `null`: el aviso lo dice en vez de mostrar una dirección rota.
 */
export function correoConsultasDatos(entorno: Record<string, string | undefined> = process.env): string | null {
  const correo = entorno.CORREO_DATOS_PERSONALES?.trim();
  return correo && esCorreo(correo) ? correo : null;
}
