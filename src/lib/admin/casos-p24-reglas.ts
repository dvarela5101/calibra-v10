import { esUuid } from "@/lib/agendar/reglas";
import type { Database } from "@/lib/supabase/tipos";

/**
 * Pagos por cobrar o asumir (HU-078, D-39): un pago rechazado cuando la sesión ya había empezado (P-24) no cancela la
 * monitoría, así que queda un caso abierto hasta que un admin activo lo cierra como cobrado (el pagador pagó por fuera)
 * o asumido (Calibra no lo cobra). En los dos casos el monto cuenta en el desembolso del monitor, y mientras siga
 * abierto ese desembolso no se ejecuta. Aquí va lo puro: qué es un caso, qué responde la base, qué se le dice al admin
 * con cada resultado, la lectura del formulario y los avisos de la página. Cerrarlo lo decide `public.cerrar_caso_p24`
 * bajo candado; lo de aquí solo lo anticipa en la pantalla. Ningún texto lleva cifras de comisión (CLAUDE.md).
 */

type EstadoDePago = Database["public"]["Enums"]["estado_pago"];
type EstadoMonitoria = Database["public"]["Enums"]["estado_monitoria"];

/** Cómo se cerró un caso: el mismo `check` de `pago.cierre_rechazo`. */
export const CIERRES = ["cobrado", "asumido"] as const;
export type CierreDeCaso = (typeof CIERRES)[number];

export function esCierre(valor: unknown): valor is CierreDeCaso {
  return typeof valor === "string" && (CIERRES as readonly string[]).includes(valor);
}

/** Cada cierre en palabras, para la opción del formulario y para el caso ya cerrado. */
export const TEXTOS_DEL_CIERRE: Record<CierreDeCaso, string> = {
  cobrado: "Cobrado: el pagador pagó por fuera",
  asumido: "Asumido: Calibra no lo cobra",
};

export type EstadoDelCaso = "abierto" | "cerrado";

/**
 * El caso de un pago (supuesto 1), la misma regla de `privado.estado_caso_p24`: `null` si no es un caso (no está
 * rechazado, o su monitoría está cancelada porque el rechazo la canceló o el estudiante ya lo había hecho); si no,
 * abierto mientras nadie lo cierre. La bandeja la repite en su consulta (`cargarBandeja`), porque la Data API no expone
 * la función de la base.
 */
export function estadoDelCaso(estadoPago: EstadoDePago, estadoMonitoria: EstadoMonitoria, cierre: CierreDeCaso | null): EstadoDelCaso | null {
  if (estadoPago !== "rechazado" || estadoMonitoria === "cancelada") return null;
  return cierre === null ? "abierto" : "cerrado";
}

/** Lo que responde `public.cerrar_caso_p24` (ver su migración). */
export const RESULTADOS_DEL_CIERRE = [
  "cerrado",
  "ya_cerrado",
  "no_es_caso",
  "no_encontrado",
  "nota_invalida",
  "cierre_invalido",
  "sin_permiso",
  "sin_sesion",
] as const;
export type ResultadoDelCierre = (typeof RESULTADOS_DEL_CIERRE)[number];

export function esResultadoDelCierre(valor: unknown): valor is ResultadoDelCierre {
  return typeof valor === "string" && (RESULTADOS_DEL_CIERRE as readonly string[]).includes(valor);
}

/** Largo máximo de la nota: el mismo `check` de `pago.nota_cierre` (supuesto 3). */
export const LARGO_MAXIMO_NOTA = 500;

/** Qué se le dice al admin cuando el caso no se cerró. */
export const MENSAJES_DEL_CIERRE: Record<Exclude<ResultadoDelCierre, "cerrado">, string> = {
  ya_cerrado: "Este caso ya estaba cerrado, y un cierre no se puede cambiar.",
  no_es_caso: "Este pago ya no está por cobrar ni por asumir: no está rechazado o su monitoría se canceló.",
  no_encontrado: "No encontramos este pago.",
  nota_invalida: `La nota puede tener hasta ${LARGO_MAXIMO_NOTA} caracteres.`,
  cierre_invalido: "Elige si el pago se cobró por fuera o si Calibra lo asume.",
  sin_permiso: "Solo un admin activo cierra los pagos por cobrar o asumir.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO = "No pudimos cerrar el caso. Intenta de nuevo; si sigue igual, avisa al equipo.";

export type PedidoDeCierre = { idPago: string; cierre: CierreDeCaso; nota: string | null };

export type LecturaDeCierre = { ok: true; datos: PedidoDeCierre } | { ok: false; error: string };

/**
 * El formulario del cierre. La nota se recorta y, vacía, cuenta como ninguna; se cuenta por caracteres, como
 * `char_length` en la base, no por unidades de JavaScript. Si el pago todavía es un caso abierto lo dice la base.
 */
export function leerCierre(datos: FormData): LecturaDeCierre {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idPago = texto("id_pago").toLowerCase();
  if (!esUuid(idPago)) return { ok: false, error: MENSAJES_DEL_CIERRE.no_encontrado };
  const cierre = texto("cierre");
  if (!esCierre(cierre)) return { ok: false, error: MENSAJES_DEL_CIERRE.cierre_invalido };
  const nota = texto("nota") || null;
  if (nota !== null && [...nota].length > LARGO_MAXIMO_NOTA) return { ok: false, error: MENSAJES_DEL_CIERRE.nota_invalida };
  return { ok: true, datos: { idPago, cierre, nota } };
}

/** Lo que el admin lee en la página de un caso abierto: qué pasó, qué hacer y que el desembolso espera (criterio 4). */
export const EXPLICACION_DEL_CASO =
  "Este pago se rechazó cuando la sesión ya había empezado, así que la monitoría no se canceló. Lo que se anotó al rechazarlo está en Observaciones. Cuando se resuelva, cierra el caso: cobrado si el pagador pagó por fuera, o asumido si Calibra no lo cobra. Mientras siga abierto, el desembolso de esta monitoría no se puede ejecutar.";

/** Lo que se lee antes de "Sí, cerrar el caso" (criterio 2, D-38): qué cambia y que no se deshace. */
export const CONSECUENCIAS_DEL_CIERRE =
  "Cerrar el caso no se puede deshacer. Sale de «Pagos por cobrar o asumir», el pago sigue rechazado y su monto cuenta en el desembolso del monitor.";

export type AvisoDelCaso = { exito: boolean; texto: string };

/** Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?caso=` y la página se pinta como quedó. */
export const CAMBIOS_DEL_CASO = ["ya_cerrado", "no_es_caso"] as const satisfies readonly ResultadoDelCierre[];

/**
 * Lo que se dice arriba de la página después de cerrar: la acción vuelve con `?caso=`. El éxito solo se dice si el
 * caso de verdad quedó cerrado por el admin de la sesión: un enlace viejo, escrito a mano o el cierre de otro admin no
 * anuncia un cierre que no hizo.
 */
export function avisosDelCaso(
  consulta: Record<string, string | string[] | undefined>,
  cierre: { como: CierreDeCaso; idAdmin: string } | null,
  idSesion: string,
): AvisoDelCaso[] {
  const caso = typeof consulta.caso === "string" ? consulta.caso : null;
  if (caso === "cerrado" && cierre && cierre.idAdmin === idSesion) {
    return [{ exito: true, texto: `Cerraste el caso como ${cierre.como}. Ya no aparece en «Pagos por cobrar o asumir».` }];
  }
  if ((CAMBIOS_DEL_CASO as readonly string[]).includes(caso ?? "")) {
    return [{ exito: false, texto: MENSAJES_DEL_CIERRE[caso as (typeof CAMBIOS_DEL_CASO)[number]] }];
  }
  return [];
}
