import "server-only";
import { track } from "@vercel/analytics/server";
import { headers } from "next/headers";
import { after } from "next/server";
import type { Evento, PropiedadesDeEvento } from "./eventos";

/**
 * HU-108: registra un evento desde una acción del servidor, después de responder (`after`), para no demorar a la persona.
 * Fuera de Vercel (local, pruebas) la librería solo lo escribe en el registro. Un fallo nunca rompe la acción.
 */
export async function registrarEventoDelServidor(evento: Evento, propiedades: PropiedadesDeEvento): Promise<void> {
  try {
    const cabeceras = await headers();
    after(() =>
      track(evento, propiedades, { headers: cabeceras }).catch((fallo: unknown) =>
        console.error(`[analitica] no se pudo registrar ${evento}:`, fallo instanceof Error ? fallo.message : fallo),
      ),
    );
  } catch (fallo) {
    console.error(`[analitica] no se pudo registrar ${evento}:`, fallo instanceof Error ? fallo.message : fallo);
  }
}
