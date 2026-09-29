/**
 * Transportes de correo. Dos, con la misma forma:
 *
 *  - Resend, en producción: `POST https://api.resend.com/emails` con la llave en el servidor.
 *  - Mailpit, solo en local: su API HTTP `POST /api/v1/send`. Es el buzón que ya levanta el Supabase
 *    local (http://127.0.0.1:54324), así que no hace falta un cliente SMTP ni ninguna dependencia.
 *
 * Nada de este archivo debe llegar al navegador: lee la llave del proveedor. Solo lo importa
 * `servidor.ts` (que tiene `server-only`) y las pruebas; `pruebas/correo-sin-llaves.test.ts` y la
 * e2e `e2e/correo.spec.ts` lo vigilan.
 */

export type CorreoSaliente = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** Identifica el correo, no el intento: si el envío llegó pero la respuesta no, el proveedor no lo repite. */
  claveIdempotencia: string;
};

export type ResultadoProveedor =
  | { ok: true; idProveedor: string | null }
  | { ok: false; reintentable: boolean; error: string };

export type Proveedor = {
  nombre: string;
  enviar(correo: CorreoSaliente): Promise<ResultadoProveedor>;
};

type Fetch = typeof fetch;

const TIMEOUT_MS = 10_000;
const LARGO_MAXIMO_DE_ERROR = 300;
const OCULTO = "[oculto]";

/**
 * Deja un mensaje de error corto y sin secretos: una sola línea, sin la llave (ni ninguna cadena de
 * `secretos`) y con un tope de largo. Es lo único de un fallo que llega al registro.
 */
export function limpiarError(mensaje: string, secretos: readonly string[] = []): string {
  let limpio = mensaje.replace(/\s+/g, " ").trim();
  for (const secreto of secretos) {
    if (secreto) limpio = limpio.split(secreto).join(OCULTO);
  }
  return limpio.length > LARGO_MAXIMO_DE_ERROR ? `${limpio.slice(0, LARGO_MAXIMO_DE_ERROR - 1)}…` : limpio;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function leerJson(respuesta: Response): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo: unknown = await respuesta.json();
    return typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Qué errores de Resend vale la pena reintentar (documentación de errores de Resend): los 5xx, el
 * límite de ritmo (`rate_limit_exceeded`, no las cuotas diaria y mensual) y los dos 409 de
 * concurrencia. Todo lo demás (llave inválida, remitente sin verificar, datos mal formados, clave de
 * idempotencia reusada con otro contenido) falla igual cuantas veces se intente.
 */
export function esReintentableEnResend(estado: number, nombre: string | undefined): boolean {
  if (estado >= 500) return true;
  if (estado === 429) return nombre === "rate_limit_exceeded";
  if (estado === 409) return nombre === "concurrent_idempotent_requests" || nombre === "resource_locked";
  return false;
}

export function crearProveedorResend({
  apiKey,
  remitente,
  fetchImpl = fetch,
  url = "https://api.resend.com/emails",
}: {
  apiKey: string;
  remitente: string;
  fetchImpl?: Fetch;
  url?: string;
}): Proveedor {
  return {
    nombre: "resend",
    async enviar(correo) {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": correo.claveIdempotencia,
          },
          body: JSON.stringify({ from: remitente, to: [correo.para], subject: correo.asunto, html: correo.html, text: correo.texto }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        return { ok: false, reintentable: true, error: limpiarError(`Resend no respondió: ${mensajeDe(error)}`, [apiKey]) };
      }

      const cuerpo = await leerJson(respuesta);
      if (respuesta.ok) return { ok: true, idProveedor: typeof cuerpo?.id === "string" ? cuerpo.id : null };

      const nombre = typeof cuerpo?.name === "string" ? cuerpo.name : undefined;
      const detalle = typeof cuerpo?.message === "string" ? cuerpo.message : "sin detalle";
      return {
        ok: false,
        reintentable: esReintentableEnResend(respuesta.status, nombre),
        error: limpiarError(`Resend ${respuesta.status} ${nombre ?? "sin nombre"}: ${detalle}`, [apiKey]),
      };
    },
  };
}

/** `Calibra <hola@calibra.example>` o solo `hola@calibra.example`, en el formato que pide Mailpit. */
export function separarRemitente(remitente: string): { Email: string; Name?: string } {
  const coincidencia = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(remitente);
  if (!coincidencia) return { Email: remitente.trim() };
  const nombre = coincidencia[1].replace(/^"|"$/g, "");
  return nombre ? { Name: nombre, Email: coincidencia[2] } : { Email: coincidencia[2] };
}

const HOSTS_LOCALES = ["127.0.0.1", "localhost", "[::1]"];

/** Mailpit es solo de desarrollo: nunca se acepta una URL que no sea de esta máquina. */
export function esUrlLocal(url: string): boolean {
  try {
    return HOSTS_LOCALES.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function crearProveedorMailpit({
  url,
  remitente,
  fetchImpl = fetch,
}: {
  url: string;
  remitente: string;
  fetchImpl?: Fetch;
}): Proveedor {
  if (!esUrlLocal(url)) throw new RangeError(`Mailpit solo se usa en local; la URL "${url}" no es de esta máquina.`);
  const base = url.replace(/\/+$/, "");
  return {
    nombre: "mailpit",
    async enviar(correo) {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(`${base}/api/v1/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: separarRemitente(remitente),
            To: [{ Email: correo.para }],
            Subject: correo.asunto,
            Text: correo.texto,
            HTML: correo.html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        return { ok: false, reintentable: true, error: limpiarError(`Mailpit no respondió: ${mensajeDe(error)}`) };
      }
      const cuerpo = await leerJson(respuesta);
      if (respuesta.ok) return { ok: true, idProveedor: typeof cuerpo?.ID === "string" ? cuerpo.ID : null };
      return { ok: false, reintentable: respuesta.status >= 500, error: limpiarError(`Mailpit ${respuesta.status}`) };
    },
  };
}

export type EleccionDeProveedor = { ok: true; proveedor: Proveedor } | { ok: false; error: string };

/**
 * Elige el transporte según el entorno. Con `RESEND_API_KEY` es Resend (y exige `CORREO_REMITENTE`,
 * que Resend solo deja usar desde un dominio verificado). Sin ella, y solo en local, Mailpit vía
 * `MAILPIT_URL`. Si no hay ninguno, lo dice en vez de fingir que envió.
 */
export function elegirProveedor(
  entorno: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
): EleccionDeProveedor {
  const llave = entorno.RESEND_API_KEY?.trim();
  if (llave) {
    const remitente = entorno.CORREO_REMITENTE?.trim();
    if (!remitente) return { ok: false, error: "Falta CORREO_REMITENTE: Resend solo envía desde un remitente de un dominio verificado." };
    return { ok: true, proveedor: crearProveedorResend({ apiKey: llave, remitente, fetchImpl }) };
  }
  const mailpit = entorno.MAILPIT_URL?.trim();
  if (mailpit && esUrlLocal(mailpit)) {
    const remitente = entorno.CORREO_REMITENTE?.trim() || "Calibra <no-responder@calibra.test>";
    return { ok: true, proveedor: crearProveedorMailpit({ url: mailpit, remitente, fetchImpl }) };
  }
  return { ok: false, error: "No hay proveedor de correo: define RESEND_API_KEY y CORREO_REMITENTE (o MAILPIT_URL en local)." };
}
