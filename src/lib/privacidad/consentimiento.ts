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
 * HU-069 (1-oct-2026) agregó que el nombre del monitor se muestra a los estudiantes. HU-073 (2-oct-2026) sumó las
 * reseñas y Cloudflare Turnstile. HU-056 (11-oct-2026) dijo qué cuenta como actividad de una sesión (D-63 b). HU-087
 * (11-oct-2026) amplió lo que se comparte con el monitor a las respuestas del diagnóstico (D-54 c). HU-032
 * (12-oct-2026): la cuenta de Estudiante, con su contraseña. HU-049 (13-oct-2026) sumó el perfil del monitor
 * certificado (D-58 a).
 */
export const AVISO_ACTUALIZADO = "2026-10-13";

/**
 * Días sin actividad tras los que se borra una sesión sin contacto (P-13). Copia el valor de la base,
 * `public.parametros_retencion()`: una prueba de integración falla si se separan. HU-056.
 */
export const DIAS_SESION_ANONIMA = 90;

/**
 * Lo que autoriza quien deja su contacto o agenda (variante `estudiante` de la casilla), sin el enlace al aviso ni
 * «(Obligatorio)», que pone el componente. D-54 c (10-oct-2026): el monitor ve las respuestas del diagnóstico, así
 * que la autorización las nombra. El texto legal final lo valida asesoría (`docs/pendientes-dvarela.md` §D): se
 * cambia aquí y, si cambia lo que se autoriza, también `VERSION_AUTORIZACION`. HU-087.
 */
export const AUTORIZACION_ESTUDIANTE =
  "Autorizo a Calibra a tratar mis datos personales, incluido compartir mis respuestas y el resultado de mi diagnóstico con el monitor de mi monitoría";

/** La finalidad del aviso que corresponde a esa autorización (sección «Para qué los usamos»). HU-087. */
export const FINALIDAD_DIAGNOSTICO = "Compartir tus respuestas y el resultado de tu diagnóstico con el monitor de tu monitoría";

/**
 * Versión del texto de la autorización que se guarda en `lead.version_autorizacion`. `v1` decía «el resultado de mi
 * diagnóstico»; `v2` dice «mis respuestas y el resultado» (D-54 c). Con `v1` el monitor ve el resultado y no las
 * respuestas (D-67). La pone el servidor, nunca el navegador. HU-087.
 */
export const VERSION_AUTORIZACION = "v2";

export const ERROR_SIN_AUTORIZACION =
  "Para dejar tu contacto o agendar necesitamos tu autorización para tratar tus datos.";

export type Consentimiento = {
  acepta_tratamiento_datos: true;
  /** Momento en que el servidor recibió la autorización, en ISO 8601 (UTC). */
  fecha_consentimiento: string;
  acepta_contacto: boolean;
  /** Versión del texto que se autorizó (`VERSION_AUTORIZACION`). */
  version_autorizacion: string;
};

export type ResultadoConsentimiento = { ok: true; consentimiento: Consentimiento } | { ok: false; error: string };

/**
 * Lee las casillas de un formulario enviado. La fecha y la versión del texto las pone el servidor (nunca el
 * navegador); la fecha es el instante absoluto del envío y la zona del negocio solo importa al mostrarla.
 */
export function leerConsentimiento(formulario: FormData, ahora: Date = new Date()): ResultadoConsentimiento {
  if (formulario.get(CASILLA_TRATAMIENTO) !== MARCADA) return { ok: false, error: ERROR_SIN_AUTORIZACION };
  return {
    ok: true,
    consentimiento: {
      acepta_tratamiento_datos: true,
      fecha_consentimiento: ahora.toISOString(),
      acepta_contacto: formulario.get(CASILLA_CONTACTO) === MARCADA,
      version_autorizacion: VERSION_AUTORIZACION,
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
