"use server";

import { tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { leerMiDiagnostico } from "@/lib/diagnostico/lectura";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { traducirEmpezar, traducirResponder, type ResultadoDeEmpezar, type ResultadoDeResponder } from "@/lib/diagnostico/pantalla";
import { leerPedidoDeEmpezar, leerPedidoDeResponder } from "@/lib/diagnostico/pedido";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { iniciarDiagnostico, responderDiagnostico } from "@/lib/diagnostico/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-009: las dos Server Actions del diagnóstico. Son envoltorios de `iniciarDiagnostico` y `responderDiagnostico` (HU-081):
 * la pantalla no elige, no califica y no guarda nada. «Consultar el diagnóstico en curso» no es una acción sino una lectura
 * que hace la página en el servidor.
 *
 * Una Server Action es un POST público: lo que recibe lo arma quien la llame, no el tipo de TypeScript. Por eso el parámetro
 * es `unknown` y se lee con `pedido.ts` antes de tocar nada, y la guarda de la cuenta del equipo va aquí dentro y no solo en
 * la pantalla. Devuelven datos y nunca redirigen: al terminar, la ruta del resultado y el cliente navega.
 */

const error = (mensaje: string): { tipo: "error"; mensaje: string } => ({ tipo: "error", mensaje });

/** La sesión de quien puede tomar el diagnóstico o, si no puede (sin sesión o con una cuenta del equipo), qué decirle. */
async function sesionDeLaPersona() {
  const sesion = await obtenerSesion();
  if (!sesion) return { sesion: null, aviso: TEXTOS.sinSesion };
  if (tienePanel(sesion.rol)) return { sesion: null, aviso: TEXTOS.cuentaDelEquipo };
  return { sesion, aviso: null };
}

/** `idEvaluacion` y, si ya vio todas las preguntas y lo decidió, `volverATomar: true` (D-51). */
export async function empezarDiagnostico(pedido: unknown): Promise<ResultadoDeEmpezar> {
  const { sesion, aviso } = await sesionDeLaPersona();
  if (!sesion) return error(aviso);

  let respuesta;
  try {
    respuesta = await iniciarDiagnostico(sesion, leerPedidoDeEmpezar(pedido));
  } catch (fallo) {
    // HU-081 ya lanza sin contenido: solo se registra el mensaje.
    console.error("[diagnostico] no se pudo empezar:", fallo instanceof Error ? fallo.message : fallo);
    return error(TEXTOS.errorAlEmpezar);
  }

  // D-51: el último resultado de la persona, con su sesión. Si la lectura falla o no hay (también si lo hizo otra sesión de su
  // Lead, que `mi_diagnostico` no entrega), el mensaje y la pregunta salen igual.
  let ultimo: ResultadoParaMostrar | null = null;
  if (respuesta.estado === "sin_preguntas" && respuesta.idUltimoDiagnostico) {
    try {
      const supabase = await crearClienteServidor();
      ultimo = supabase ? await leerMiDiagnostico(supabase, respuesta.idUltimoDiagnostico) : null;
    } catch (fallo) {
      console.error("[diagnostico] no se pudo leer el último resultado:", fallo instanceof Error ? fallo.message : fallo);
    }
  }
  return traducirEmpezar(respuesta, ultimo);
}

/** `idDiagnostico`, `paso` y `letra` (de la A a la D) de la pregunta que vio la persona. */
export async function responderPregunta(pedido: unknown): Promise<ResultadoDeResponder> {
  const { sesion, aviso } = await sesionDeLaPersona();
  if (!sesion) return error(aviso);

  // Una letra que no es de la A a la D no la manda la interfaz: no llega al módulo.
  const leido = leerPedidoDeResponder(pedido);
  if (!leido) return error(TEXTOS.eligeUnaOpcion);

  let respuesta;
  try {
    respuesta = await responderDiagnostico(sesion, leido);
  } catch (fallo) {
    console.error("[diagnostico] no se pudo guardar la respuesta:", fallo instanceof Error ? fallo.message : fallo);
    return error(TEXTOS.errorAlResponder);
  }
  return traducirResponder(respuesta, leido.idDiagnostico);
}
