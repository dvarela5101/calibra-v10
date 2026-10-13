import { esLetra } from "./reglas";
import type { Letra } from "./motor";

/**
 * Lo que llega del navegador a las Server Actions del diagnóstico (HU-009). Una Server Action es un POST público: lo que
 * recibe lo arma quien la llame, no el tipo de TypeScript, y puede ser `null`, un número, un arreglo o un objeto con claves de
 * más. Aquí se lee como `unknown` antes de tocar nada. Usa los validadores de `reglas.ts` (valores, con `motor.ts` detrás),
 * así que solo lo importan el servidor y las pruebas, nunca un componente de cliente.
 */

export type PedidoLeidoDeEmpezar = {
  /** Sin validar: el módulo del servidor comprueba que sea un UUID y devuelve `no_disponible` si no. */
  idEvaluacion: unknown;
  /** `true` solo si llegó exactamente `true`. */
  volverATomar: boolean;
};

export type PedidoLeidoDeResponder = {
  /** Sin validar: el módulo del servidor devuelve el estado actual si no es un UUID. */
  idDiagnostico: unknown;
  /** Sin validar: el módulo del servidor devuelve el estado actual si no es un entero no negativo. */
  paso: unknown;
  letra: Letra;
};

const comoObjeto = (pedido: unknown): Record<string, unknown> | null =>
  typeof pedido === "object" && pedido !== null && !Array.isArray(pedido) ? (pedido as Record<string, unknown>) : null;

/** Siempre devuelve algo: un pedido que no es un objeto deja `idEvaluacion` sin definir y el módulo responde `no_disponible`. */
export function leerPedidoDeEmpezar(pedido: unknown): PedidoLeidoDeEmpezar {
  const objeto = comoObjeto(pedido);
  return { idEvaluacion: objeto?.idEvaluacion, volverATomar: objeto?.volverATomar === true };
}

/**
 * `null` si el pedido no es un objeto o si la letra no es de la A a la D. Un id o un paso malo no es `null`: el módulo ya los
 * valida y no aplica nada.
 */
export function leerPedidoDeResponder(pedido: unknown): PedidoLeidoDeResponder | null {
  const objeto = comoObjeto(pedido);
  if (!objeto || !esLetra(objeto.letra)) return null;
  return { idDiagnostico: objeto.idDiagnostico, paso: objeto.paso, letra: objeto.letra };
}
