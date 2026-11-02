/**
 * Franja de oferta (HU-119, D-85): un admin marca una franja y quien la agende recibe la monitoría confirmada y gratis; el
 * estudiante la ve desde el listado como una oferta. Aquí va lo puro: qué responde la base, qué se le dice al admin y la lectura
 * del formulario. Si se puede marcar lo decide `public.marcar_franja_de_prueba` bajo candado. «Prueba» es una palabra del admin:
 * el estudiante solo ve «Oferta» y «Gratis». Sin cifras de comisión.
 */
import { esUuid } from "@/lib/agendar/reglas";

/** Lo que responde `public.marcar_franja_de_prueba`. Solo los dos primeros escriben. */
export const RESULTADOS_DE_FRANJA = [
  "marcada",
  "desmarcada",
  "sin_sesion",
  "sin_permiso",
  "pedido_invalido",
  "no_existe",
  "ya_marcada",
  "no_marcada",
] as const;
export type ResultadoDeFranja = (typeof RESULTADOS_DE_FRANJA)[number];

export function esResultadoDeFranja(valor: unknown): valor is ResultadoDeFranja {
  return typeof valor === "string" && (RESULTADOS_DE_FRANJA as readonly string[]).includes(valor);
}

export type PedidoDeFranja = { idFranja: string; dePrueba: boolean };
export type LecturaDeFranja = { ok: true; datos: PedidoDeFranja } | { ok: false; error: string };

export const MENSAJES_DE_FRANJA: Record<Exclude<ResultadoDeFranja, "marcada" | "desmarcada">, string> = {
  sin_sesion: "Tu sesión terminó. Entra de nuevo y repite el cambio.",
  sin_permiso: "Solo un admin activo puede marcar una franja de oferta.",
  pedido_invalido: "No entendimos el cambio. Recarga la página e intenta de nuevo.",
  no_existe: "Esa franja ya no existe. Recarga la página.",
  ya_marcada: "Esa franja ya estaba marcada como oferta.",
  no_marcada: "Esa franja no estaba marcada como oferta.",
};

export const MENSAJE_DE_FALLO_DE_FRANJA = "No pudimos guardar el cambio. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** El formulario: el id de la franja y `de_prueba` en `1` (marcar) o `0` (quitar la marca). */
export function leerFranja(datos: FormData): LecturaDeFranja {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idFranja = texto("id_franja").toLowerCase();
  if (!esUuid(idFranja)) return { ok: false, error: MENSAJES_DE_FRANJA.no_existe };
  const dePrueba = texto("de_prueba");
  if (dePrueba !== "1" && dePrueba !== "0") return { ok: false, error: MENSAJES_DE_FRANJA.pedido_invalido };
  return { ok: true, datos: { idFranja, dePrueba: dePrueba === "1" } };
}

/** El aviso de arriba de la lista: la acción vuelve con `?franja=marcada|desmarcada` o `?franja_error=<resultado>`. */
export function avisoDeFranja(consulta: Record<string, string | string[] | undefined>): { exito: boolean; texto: string } | null {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const hecho = valor("franja");
  if (hecho === "marcada") return { exito: true, texto: "Listo: la franja ahora sale como una oferta gratis." };
  if (hecho === "desmarcada") return { exito: true, texto: "Listo: la franja volvió a su precio normal." };
  const error = valor("franja_error");
  if (error === "fallo") return { exito: false, texto: MENSAJE_DE_FALLO_DE_FRANJA };
  if (error && esResultadoDeFranja(error) && error !== "marcada" && error !== "desmarcada") {
    return { exito: false, texto: MENSAJES_DE_FRANJA[error] };
  }
  return null;
}

/** Una franja de la lista del admin. */
export type FranjaParaAdmin = {
  idFranja: string;
  nombreMonitor: string;
  /** 1 (lunes) a 7 (domingo). */
  dia: number;
  /** `HH:MM:SS`, en la zona del negocio. */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  precio: number;
  dePrueba: boolean;
};
