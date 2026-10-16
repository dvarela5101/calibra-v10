import "server-only";
import type { crearClienteServidor } from "@/lib/supabase/servidor";
import { proyectarResultado, type ResultadoParaMostrar } from "./mostrar";

/** Lo único que la lectura usa del cliente de Supabase. */
export type ClienteDeLectura = Pick<NonNullable<Awaited<ReturnType<typeof crearClienteServidor>>>, "rpc">;

/**
 * El resultado de un diagnóstico terminado, tal como lo ve su dueño (HU-009). Va con el cliente DE LA SESIÓN de quien visita
 * (`crearClienteServidor()`), nunca con la llave secreta: `public.mi_diagnostico(id)` saca al dueño del JWT en la base
 * (la sesión que hizo el diagnóstico o la cuenta de Estudiante de su Lead, D-53 e) y descarta al monitor y al admin, así que
 * la aplicación no decide de quién es. Un `select` sobre `diagnostico` no sirve: su política deja leer a un admin y al
 * monitor de la cita.
 *
 * Devuelve `null` si no hay fila (no existe, no es suyo o es del equipo). Lanza con un mensaje sin contenido si la base
 * falla (solo el código, nunca `details`) o si lo guardado no cuadra (`ErrorDeResultadoGuardado`).
 */
export async function leerMiDiagnostico(cliente: ClienteDeLectura, id: string): Promise<ResultadoParaMostrar | null> {
  const { data, error } = await cliente.rpc("mi_diagnostico", { p_id: id });
  if (error) throw new Error(`Falló «mi_diagnostico» al leer el resultado (código ${error.code || "sin código"}).`);
  const fila = data?.[0];
  return fila ? proyectarResultado(fila) : null;
}

/**
 * El último diagnóstico terminado de la sesión de quien visita, para la portada (HU-011, D-53 d y e), o `null` si no tiene
 * ninguno. Mismo cliente DE LA SESIÓN y mismo mapeo que `leerMiDiagnostico`: `public.mi_ultimo_diagnostico()` elige en la base el
 * id más reciente de la propia sesión (`id_sesion_anonima = auth.uid()`: no las demás sesiones de su Lead ni una cuenta de
 * Estudiante que sea otro usuario; la que nació de convertir esa misma sesión conserva el id y sí es la dueña) y devuelve lo de
 * `mi_diagnostico`. No lleva argumentos: la aplicación no dice de quién.
 *
 * Con `senal` la llamada a la base se corta cuando la señal se aborta (el tope de la portada, `TOPE_DE_LECTURA_MS`).
 *
 * Lanza con un mensaje sin contenido (solo el código de la base, nunca `message`, `details` ni `hint`, que un check puede llenar
 * con la fila) o `ErrorDeResultadoGuardado` si lo guardado no cuadra.
 */
export async function leerMiUltimoDiagnostico(cliente: ClienteDeLectura, senal?: AbortSignal): Promise<ResultadoParaMostrar | null> {
  const consulta = cliente.rpc("mi_ultimo_diagnostico");
  const { data, error } = await (senal ? consulta.abortSignal(senal) : consulta);
  if (error) throw new Error(`Falló «mi_ultimo_diagnostico» (código ${error.code || "sin código"}).`);
  const fila = data?.[0];
  return fila ? proyectarResultado(fila) : null;
}
