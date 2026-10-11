import { expect } from "@playwright/test";
import { variable, type CorreoRecibido } from "../utilidades";

// HU-048: los recorridos llaman a los procesos programados por HTTP, como lo haría pg_cron (la base local no tiene
// Vault, así que pg_cron no los llama), y esperan sus correos en Mailpit por destinatario Y asunto: el Lead y el
// monitor reciben varios correos en un mismo recorrido.

export type RutaDeProceso = "confirmar-citas" | "avisar-monitores" | "avisar-rechazos" | "avisar-cancelaciones" | "pedir-llaves";

const PUERTO = 3000;

/** Llama una vez a `POST /api/procesos/<ruta>` con el `CRON_SECRETO` de prueba que escribió `npm run db:env`. */
async function llamar(ruta: RutaDeProceso): Promise<void> {
  const respuesta = await fetch(`http://localhost:${PUERTO}/api/procesos/${ruta}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${variable("CRON_SECRETO")}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (respuesta.status === 401) {
    throw new Error(
      `/api/procesos/${ruta} respondió 401: el servidor arrancó con otro CRON_SECRETO. Corre npm run db:env y reinicia el ` +
        "servidor (en local, Playwright reutiliza un npm run dev que ya corría con el .env.local anterior).",
    );
  }
  if (!respuesta.ok) throw new Error(`/api/procesos/${ruta} respondió ${respuesta.status}: ${await respuesta.text()}`);
}

const buscar = async (consulta: string) => {
  const respuesta = await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(consulta)}&limit=50`);
  const { messages } = (await respuesta.json()) as { messages?: { ID: string; Subject: string }[] };
  return messages ?? [];
};

/** El correo más reciente para `destinatario` cuyo asunto cumple `asunto`, si ya llegó. */
async function buscarCorreo(destinatario: string, asunto: RegExp): Promise<{ ID: string; Subject: string } | undefined> {
  return (await buscar(`to:"${destinatario}"`)).find((m) => asunto.test(m.Subject));
}

async function leer(resumen: { ID: string; Subject: string }): Promise<CorreoRecibido> {
  const detalle = (await (await fetch(`${variable("MAILPIT_URL")}/api/v1/message/${resumen.ID}`)).json()) as { HTML: string };
  return { id: resumen.ID, asunto: resumen.Subject, html: detalle.HTML };
}

/**
 * Corre los procesos hasta que llegue el correo: cada ruta toma 10 filas pendientes, de la más antigua a la más nueva,
 * y pueden ser de otras pruebas, así que una sola llamada puede no alcanzar la del recorrido. Hasta 5 vueltas.
 */
export async function correrHastaQueLlegue(
  rutas: readonly RutaDeProceso[],
  destinatario: string,
  asunto: RegExp,
): Promise<CorreoRecibido> {
  for (let vuelta = 1; vuelta <= 5; vuelta++) {
    for (const ruta of rutas) await llamar(ruta);
    // El envío a Mailpit es inmediato, pero su índice de búsqueda tarda unos milisegundos.
    let encontrado: { ID: string; Subject: string } | undefined;
    await expect
      .poll(async () => (encontrado = await buscarCorreo(destinatario, asunto)) !== undefined, { timeout: 3_000, intervals: [250, 500] })
      .toBe(true)
      .catch(() => undefined);
    if (encontrado) return leer(encontrado);
  }
  throw new Error(`Tras 5 vueltas de ${rutas.join(", ")} no llegó a ${destinatario} un correo con asunto ${asunto}.`);
}

/** Espera un correo que ya debía salir (sin correr procesos), por destinatario y asunto. */
export async function esperarCorreoCon(destinatario: string, asunto: RegExp): Promise<CorreoRecibido> {
  let encontrado: { ID: string; Subject: string } | undefined;
  await expect
    .poll(async () => (encontrado = await buscarCorreo(destinatario, asunto)) !== undefined, {
      message: `debía llegar a ${destinatario} un correo con asunto ${asunto}`,
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    })
    .toBe(true);
  return leer(encontrado!);
}

/** El enlace con esa ruta (`/cita`, `/reembolso`) del HTML de un correo, con los `&amp;` desescapados. */
export function enlaceDelCorreo(html: string, ruta: string): string {
  const coincidencia = new RegExp(`href="([^"]*${ruta.replace("/", "\\/")}\\?[^"]*)"`).exec(html);
  if (!coincidencia) throw new Error(`El correo no trae un enlace a ${ruta}.`);
  return coincidencia[1].replaceAll("&amp;", "&");
}

/** Borra de Mailpit todos los correos para esas direcciones, también los que ninguna prueba esperó. */
export async function borrarCorreosDe(direcciones: readonly string[]): Promise<void> {
  const ids = new Set<string>();
  for (const direccion of new Set(direcciones)) for (const m of await buscar(`to:"${direccion}"`)) ids.add(m.ID);
  if (ids.size === 0) return;
  const respuesta = await fetch(`${variable("MAILPIT_URL")}/api/v1/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: [...ids] }),
  });
  if (!respuesta.ok) throw new Error(`Mailpit no borró los correos: ${respuesta.status}`);
}
