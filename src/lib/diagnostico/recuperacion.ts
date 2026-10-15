import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio, type ResultadoEnvio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { proyectarResultado, type ResultadoParaMostrar } from "./mostrar";
import { esUuid } from "./reglas";
import { rutaDeResultados } from "./rutas";

/**
 * HU-031 (RN-12, D-20): el enlace con token para ver un resultado desde otro dispositivo. Todo con la llave secreta: ninguna
 * sesión lee `token_recuperacion` ni el Lead de un diagnóstico.
 *
 * El correo sale en dos momentos (P-33, P-34): al terminar un diagnóstico si la sesión ya es de un Lead
 * (`mandarEnlaceDeResultados`) y al crearse el Lead con los diagnósticos que la sesión ya tenía
 * (`mandarEnlaceDelUltimoDiagnostico`). La clave del correo es `recuperacion_diagnostico:<id del diagnóstico>`, única en
 * `correo_envio`: si los dos momentos coinciden, o el mismo evento se repite, sale un solo correo por diagnóstico. El token
 * nunca va al registro.
 */

type Cliente = SupabaseClient<Database>;

/** Lo que genera la base por defecto: 32 bytes en hexadecimal (`esquema_v10.sql`). */
const TOKEN = /^[0-9a-f]{64}$/;

/** ¿Tiene la forma de un token de recuperación? Uno repetido (`?token=a&token=b`) llega como arreglo y no la tiene. */
export function tieneFormaDeTokenDeResultados(valor: unknown): valor is string {
  return typeof valor === "string" && TOKEN.test(valor);
}

/**
 * El resultado de un token, como lo ve su dueño (la misma proyección que HU-009). `null` si el token no tiene la forma (sin
 * consultar), no existe o su diagnóstico no tiene Lead: la página no distingue los casos. Lanza sin el token si la base falla.
 */
export async function leerResultadoPorToken(
  token: unknown,
  cliente: Cliente = crearClienteAdmin(),
): Promise<ResultadoParaMostrar | null> {
  if (!tieneFormaDeTokenDeResultados(token)) return null;
  const { data, error } = await cliente.rpc("resultado_por_token", { p_token: token });
  if (error) throw new Error(`Falló «resultado_por_token» al leer el resultado (código ${error.code || "sin código"}).`);
  const fila = data?.[0];
  return fila ? proyectarResultado(fila) : null;
}

/**
 * El correo de recuperación de un diagnóstico, para mandarlo o reintentarlo (HU-065). El enlace es siempre el mismo token
 * (D-20). `null` si el diagnóstico ya no existe, no tiene Lead o su Lead no tiene correo: no hay a quién escribirle.
 */
export async function reconstruirRecuperacion(
  idDiagnostico: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"recuperacion_diagnostico"> | null> {
  if (!esUuid(idDiagnostico)) return null;
  const { data, error } = await cliente
    .from("diagnostico")
    // La materia va por la Evaluación: la llave del diagnóstico es compuesta (`diagnostico_evaluacion_fk`).
    .select("token_recuperacion, evaluacion(materia(nombre)), lead(nombre, correo)")
    .eq("id", idDiagnostico)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el diagnóstico ${idDiagnostico} para su enlace (código ${error.code || "sin código"}).`);
  const destinatario = data?.lead?.correo?.trim();
  const materia = data?.evaluacion?.materia?.nombre;
  if (!data?.lead || !materia || !destinatario) return null;
  return {
    destinatario,
    datos: {
      nombre: data.lead.nombre,
      materia,
      enlace: urlDelSitio(rutaDeResultados(data.token_recuperacion)),
    },
  };
}

export type DependenciasDelEnlace = {
  cliente?: Cliente;
  /** Por defecto, `enviarCorreoDesdeServidor`. Las pruebas pasan un proveedor caído. */
  enviar?: typeof enviarCorreoDesdeServidor;
};

/**
 * Manda el enlace de un diagnóstico a su Lead (momento 1, y el final del momento 2). `null` si no hay a quién mandarlo
 * (sin Lead, sin correo). Un envío que no sale queda `fallido` en `correo_envio` y lo reintenta HU-065 con el mismo enlace.
 */
export async function mandarEnlaceDeResultados(
  idDiagnostico: string,
  { cliente = crearClienteAdmin(), enviar = enviarCorreoDesdeServidor }: DependenciasDelEnlace = {},
): Promise<ResultadoEnvio | null> {
  const correo = await reconstruirRecuperacion(idDiagnostico, cliente);
  if (!correo) return null;
  const envio = await enviar({
    plantilla: "recuperacion_diagnostico",
    datos: correo.datos,
    destinatario: correo.destinatario,
    entidad: idDiagnostico.toLowerCase(),
  });
  if (!envio.ok) console.error(`[diagnostico] el enlace de resultados del diagnóstico ${idDiagnostico} no salió: ${envio.motivo}`);
  return envio;
}

/**
 * Momento 2: el Lead se acaba de crear y `registrar_lead` le ligó los diagnósticos de la sesión. Sale un solo correo, el del
 * más reciente (por `fecha_realizacion` y, en empate, por `id`, de mayor a menor). Sin diagnósticos, ninguno.
 */
export async function mandarEnlaceDelUltimoDiagnostico(
  idLead: string,
  dependencias: DependenciasDelEnlace = {},
): Promise<ResultadoEnvio | null> {
  const cliente = dependencias.cliente ?? crearClienteAdmin();
  const { data, error } = await cliente
    .from("diagnostico")
    .select("id")
    .eq("id_lead", idLead)
    .order("fecha_realizacion", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el último diagnóstico del Lead ${idLead} (código ${error.code || "sin código"}).`);
  return data ? mandarEnlaceDeResultados(data.id, { ...dependencias, cliente }) : null;
}

/**
 * Programa el envío para después de responder (`after` de Next): con el proveedor caído, `enviarCorreo` tarda hasta unos 32 s
 * y la persona no espera por eso. Un fallo nunca rompe la respuesta: queda en el log, sin el token.
 */
export function programarEnlace(tarea: () => Promise<unknown>): void {
  after(async () => {
    try {
      await tarea();
    } catch (error) {
      console.error("[diagnostico] no se pudo mandar el enlace de resultados:", error instanceof Error ? error.message : error);
    }
  });
}
