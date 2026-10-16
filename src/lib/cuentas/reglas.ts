import { destinoTrasIngresar, type Rol } from "@/lib/auth/roles";
import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import { rutaSiguiente } from "@/lib/leads/reglas";

/**
 * Crear la cuenta de Estudiante (HU-032, RN-02, RN-12). Aquí va lo puro: las rutas, la pantalla que ve cada quien, la
 * forma de lo que devuelve la base y los textos. Lo que toca Auth o la base está en `servidor.ts`.
 *
 * La cuenta es el mismo usuario de Auth de la sesión anónima. Se pide (`/cuenta/crear`), se confirma el correo con un
 * botón (`/cuenta/confirmar`, que no gasta el enlace al abrirse) y se elige la contraseña (`/cuenta/contrasena`). El rol
 * nace al confirmar el correo, nunca antes.
 */

export const RUTA_CREAR_CUENTA = "/cuenta/crear";
export const RUTA_CONFIRMAR_CUENTA = "/cuenta/confirmar";
export const RUTA_CONTRASENA = "/cuenta/contrasena";

/** La ruta a la que vuelve quien pidió la cuenta en este navegador. Solo vive en el navegador que la pidió, no en el enlace. */
export const COOKIE_SIGUIENTE = "calibra_cuenta_siguiente";
export const SEGUNDOS_DE_LA_COOKIE = 86_400;

/** Largo máximo de una ruta que se guarda o se manda de regreso; el mismo de `rutaSiguiente`. */
const LARGO_MAXIMO_DE_RUTA = 500;

const conSiguiente = (base: string, siguiente: unknown) => {
  const ruta = rutaSiguiente(siguiente);
  return ruta === "/" ? base : `${base}?siguiente=${encodeURIComponent(ruta)}`;
};

/**
 * `/cuenta/crear`, con la ruta de regreso si hay una interna. Si con ella la dirección pasa de 500 caracteres, queda sin
 * ella: `rutaSiguiente` descarta lo que supera ese largo y la persona volvería a la portada.
 */
export function rutaDeCrearCuenta(siguiente: unknown): string {
  const ruta = conSiguiente(RUTA_CREAR_CUENTA, siguiente);
  return ruta.length <= LARGO_MAXIMO_DE_RUTA ? ruta : RUTA_CREAR_CUENTA;
}

/** El parámetro de `/cuenta/crear` que dice que el correo de la cuenta ya salió. */
export const PARAMETRO_ENVIADO = "enviado";

/**
 * `/cuenta/crear` con el aviso de que el correo salió. A donde va quien dejó su contacto y pidió la cuenta en el mismo
 * paso: crear el Lead y poner las cookies re-dibuja la página (ya tiene Lead, así que ahora ve el resumen y no el
 * formulario), y el aviso no puede vivir en el estado del formulario que se desmonta.
 */
export function rutaDeCrearCuentaEnviada(siguiente: unknown): string {
  const ruta = rutaDeCrearCuenta(siguiente);
  return `${ruta}${ruta.includes("?") ? "&" : "?"}${PARAMETRO_ENVIADO}=1`;
}

/** «¿Ya tienes cuenta? Inicia sesión»: `/ingresar` con la misma ruta de regreso. */
export function rutaParaIngresar(siguiente: unknown): string {
  return conSiguiente("/ingresar", siguiente);
}

/** «Cambiar mis datos»: la pantalla de contacto en modo edición, que vuelve a `/cuenta/crear` con su propia ruta de regreso. */
export function rutaParaCambiarDatos(siguiente: unknown): string {
  return `/agendar/contacto?editar=1&siguiente=${encodeURIComponent(rutaDeCrearCuenta(siguiente))}`;
}

/**
 * A dónde va quien termina de crear su cuenta: la ruta de la cookie si es interna y no es de un panel, y si no, «Mis
 * citas». Es la misma regla de quien inicia sesión (`destinoTrasIngresar`), con «Mis citas» donde allá va la portada.
 */
export function rutaDeRegreso(valorDeLaCookie: unknown): string {
  const destino = destinoTrasIngresar("estudiante", typeof valorDeLaCookie === "string" ? valorDeLaCookie : null);
  return destino === "/" ? RUTA_DE_CITAS : destino;
}

const FORMA_DEL_TOKEN_DE_AUTH = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * ¿Tiene forma del `token_hash` de un correo de Auth? Es laxa a propósito: con PKCE (el caso de `@supabase/ssr`) el valor
 * lleva el prefijo `pkce_` y no se conoce su largo sin probar. Lo que no la tiene ni se manda a Auth.
 */
export function tieneFormaDeTokenDeAuth(valor: unknown): valor is string {
  return typeof valor === "string" && FORMA_DEL_TOKEN_DE_AUTH.test(valor);
}

// ---------------------------------------------------------------------------
// Lo que devuelve la base
// ---------------------------------------------------------------------------

export const RESULTADOS_DE_CREAR_ESTUDIANTE = ["creada", "no_confirmada", "sin_lead", "ya_tiene_cuenta", "correo_distinto"] as const;
export type ResultadoDeCrearEstudiante = (typeof RESULTADOS_DE_CREAR_ESTUDIANTE)[number];

export const RESULTADOS_DE_TOPE = ["ok", "tope_de_sesion", "tope_global"] as const;
export type ResultadoDeTope = (typeof RESULTADOS_DE_TOPE)[number];

/** Una respuesta desconocida de la base lanza en quien la usa, en lugar de tratarse como un éxito. */
export function esResultadoDeCrearEstudiante(valor: unknown): valor is ResultadoDeCrearEstudiante {
  return RESULTADOS_DE_CREAR_ESTUDIANTE.includes(valor as ResultadoDeCrearEstudiante);
}

export function esResultadoDeTope(valor: unknown): valor is ResultadoDeTope {
  return RESULTADOS_DE_TOPE.includes(valor as ResultadoDeTope);
}

// ---------------------------------------------------------------------------
// Qué pantalla ve cada quien en /cuenta/crear
// ---------------------------------------------------------------------------

export type PantallaDeCuenta = "estudiante" | "equipo" | "ya_tiene_cuenta" | "terminar" | "sin_correo" | "resumen" | "contacto";

export type EntradaDePantalla = {
  /** `null` si todavía no hay sesión (la anónima nace en el navegador al abrir la página). */
  sesion: { rol: Rol | null } | null;
  hayLead: boolean;
  correoDelLead: string | null;
  /** Si el Lead de la sesión ya tiene un Estudiante, de esa sesión o de otra. */
  leadTieneCuenta: boolean;
};

/**
 * Qué pantalla corresponde, en este orden (el primero que aplica gana):
 * 1. Un Estudiante no crea otra cuenta: va a «Mis citas».
 * 2. Un monitor o un admin tampoco: ve que está en su cuenta del equipo.
 * 3. Con sesión y un Lead que ya tiene cuenta: «ya tienes una cuenta», con iniciar sesión y restablecer.
 * 4. Con sesión, sin rol y no anónima (confirmó el correo y quedó sin Estudiante): «Terminar de crear mi cuenta».
 * 5. Anónima con Lead sin correo: que lo agregue en «Cambiar mis datos».
 * 6. Anónima con Lead y correo: el resumen con «Crear mi cuenta».
 * 7. Anónima o sin sesión todavía, sin Lead: el formulario de contacto.
 */
export function pantallaDeCuenta({ sesion, hayLead, correoDelLead, leadTieneCuenta }: EntradaDePantalla): PantallaDeCuenta {
  if (sesion?.rol === "estudiante") return "estudiante";
  if (sesion?.rol === "monitor" || sesion?.rol === "admin") return "equipo";
  if (sesion && hayLead && leadTieneCuenta) return "ya_tiene_cuenta";
  if (sesion && sesion.rol === null) return "terminar";
  if (sesion && hayLead) return correoDelLead ? "resumen" : "sin_correo";
  return "contacto";
}

// ---------------------------------------------------------------------------
// Textos (propuestos: los valida el equipo, como el aviso de privacidad)
// ---------------------------------------------------------------------------

/**
 * Los textos de las pantallas, las acciones y las pruebas, para que los tres lean la misma cadena. Sin rayas largas ni
 * emojis. Ninguno dice si un correo tiene cuenta (RN-12): el aviso de envío es el mismo haya o no una cuenta de Auth.
 */
export const TEXTOS = {
  eyebrow: "Tu cuenta",

  // /cuenta/crear
  crearTitulo: "Crea tu cuenta",
  crearContacto:
    "Deja tus datos y te mandamos un correo para confirmar que es tuyo. Después eliges una contraseña. Con tu cuenta ves tus citas desde cualquier dispositivo.",
  ayudaDelCorreo: "Ahí te llega el correo para confirmar tu cuenta.",
  botonCrear: "Crear mi cuenta",
  botonCreando: "Enviando…",
  resumen:
    "Vamos a crear tu cuenta con estos datos. Te mandamos un correo para confirmar que es tuyo y después eliges una contraseña.",
  etiquetaNombre: "Nombre",
  etiquetaCorreo: "Correo",
  cambiarMisDatos: "Cambiar mis datos",
  yaTienesCuenta: "¿Ya tienes cuenta?",
  iniciarSesion: "Inicia sesión",
  avisoEnviado: (correo: string) =>
    `Listo. Si ${correo} puede crear una cuenta, te llega un correo para confirmarla. Ábrelo y confirma que es tuyo. Si no llega en unos minutos, revisa la carpeta de spam. Si ya tienes una cuenta, inicia sesión o restablece tu contraseña.`,
  topeDeSesion: "Ya pediste el correo varias veces en la última hora. Revisa tu bandeja y la carpeta de spam, o vuelve a intentarlo en un rato.",
  topeTotal: "Estamos recibiendo muchas solicitudes de cuenta. Vuelve a intentarlo en un rato.",
  noSalioElCorreo: "No pudimos enviar el correo. Intenta de nuevo en unos minutos.",
  sinCorreo: "Tu contacto no tiene correo. Agrégalo en «Cambiar mis datos» y vuelve a pedir tu cuenta.",
  sinSesion: "No pudimos verificar tu navegador. Recarga la página e intenta de nuevo.",
  sesionSinRol: "Tu sesión no puede crear una cuenta de Estudiante. Recarga la página.",
  noPudimosGuardar: "No pudimos guardar tus datos. Intenta de nuevo.",

  equipoTitulo: "Estás en tu cuenta del equipo",
  equipo: "Desde tu cuenta del equipo de Calibra no puedes crear una cuenta de Estudiante. Sal de tu cuenta o usa otra ventana.",
  irAMiPanel: "Ir a mi panel",

  yaTieneTitulo: "Ya tienes una cuenta",
  yaTiene: "Este contacto ya tiene una cuenta de Calibra. Inicia sesión con tu correo y tu contraseña. Si no la recuerdas, restablécela.",
  olvideMiContrasena: "¿Olvidaste tu contraseña?",

  terminarTitulo: "Terminar de crear mi cuenta",
  terminar: "Ya confirmaste tu correo. Falta un paso para activar tu cuenta.",
  terminarFallo: "No pudimos terminar. Intenta de nuevo.",
  botonTerminar: "Terminar de crear mi cuenta",
  botonTerminando: "Terminando…",
  soporte: (correoDeSoporte: string | null) =>
    `No pudimos activar tu cuenta con estos datos. Escribe a soporte${correoDeSoporte ? ` (${correoDeSoporte})` : ""} y te ayudamos.`,

  // /cuenta/confirmar
  confirmarTitulo: "Confirma que este correo es tuyo",
  confirmar:
    "Al confirmar, creamos tu cuenta con el correo al que llegó este enlace y este navegador entra con ella. Si no pediste una cuenta de Calibra, cierra esta página: no se crea nada.",
  botonConfirmar: "Sí, es mi correo",
  botonConfirmando: "Confirmando…",
  enlaceNoSirveTitulo: "Este enlace ya no sirve",
  enlaceNoSirve: "Ya se usó, venció o está incompleto. Pide otro desde la pantalla de tu cuenta.",
  enlaceNoSirveAlConfirmar: "Este enlace ya no sirve. Ya se usó o venció.",
  pedirOtroEnlace: "Pedir otro enlace",
  cuentaAbierta: "Tienes una cuenta de Calibra abierta en este navegador. Abre el enlace en otra ventana, sin iniciar sesión.",
  noPudimosConfirmar: "No pudimos confirmar tu correo. Intenta de nuevo.",
  confirmadoSinTerminar: "Confirmamos tu correo, pero no pudimos terminar de crear tu cuenta. Entra a «Terminar de crear mi cuenta» para seguir.",
  irATerminar: "Terminar de crear mi cuenta",

  // /cuenta/contrasena
  contrasenaTitulo: "Elige tu contraseña",
  contrasena:
    "Tu correo ya está confirmado y tu cuenta está lista. Elige una contraseña de 8 caracteres o más para entrar desde cualquier dispositivo.",
  botonGuardarContrasena: "Guardar contraseña",
  contrasenaCorta: "La contraseña debe tener al menos 8 caracteres.",
  contrasenasDistintas: "Las dos contraseñas no coinciden.",
  elegirDespues: "Elegir después",
  elegirDespuesNota: "Si no la eliges ahora, puedes hacerlo después con «¿Olvidaste tu contraseña?» al iniciar sesión.",

  // «Mis citas»
  invitacionDeCitas: "Crea tu cuenta para ver tus citas desde cualquier dispositivo.",
  enlaceDeInvitacion: "Crear mi cuenta",
} as const;
