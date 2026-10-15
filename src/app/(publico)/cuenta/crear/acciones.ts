"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import {
  COOKIE_SIGUIENTE,
  RUTA_CONTRASENA,
  rutaDeCrearCuenta,
  rutaDeCrearCuentaEnviada,
  SEGUNDOS_DE_LA_COOKIE,
  TEXTOS,
} from "@/lib/cuentas/reglas";
import {
  activarCuenta,
  confirmacionDeCorreoActiva,
  leadTieneCuenta,
  pedirCuentaDeEstudiante,
  tokenDeAccesoDeLaSesion,
  type ResultadoDeActivar,
  type ResultadoDelPedido,
} from "@/lib/cuentas/servidor";
import { avisoDeVerificacion } from "@/lib/leads/avisos";
import { COOKIE_ORIGEN, leerOrigen } from "@/lib/leads/origen";
import { leerContacto, resumenDeError, rutaSiguiente, type EstadoContacto } from "@/lib/leads/reglas";
import { leadDeLaSesion, registrarContacto, type LeadDeSesion, type ResultadoContacto } from "@/lib/leads/servidor";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { leerConsentimiento } from "@/lib/privacidad/consentimiento";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const CAMPOS = ["nombre", "correo", "numero_telefono"] as const;
const valoresDe = (datos: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(datos.get(c) ?? "")]));

/**
 * HU-032, criterios 2, 8, 9, 10 y 11: pedir la cuenta de Estudiante. Auth manda el correo de confirmación y el usuario
 * sigue siendo el mismo, anónimo, hasta que lo confirme; no se crea Estudiante, ni se toca el Lead, antes de eso.
 *
 * En este orden, y cada paso solo si el anterior pasó:
 * 1. la guarda de rol (como `procesarContacto`): un monitor o un admin no pide cuenta; un Estudiante ya la tiene; solo la
 *    sesión anónima pide, así `updateUser({ email })` nunca se llama sobre una cuenta ya convertida;
 * 2. si la sesión no tiene Lead, se crea con el formulario (autorización incluida) como en HU-068, con el tope de correos
 *    de HU-075; si el correo ya es de otro Lead, sale el enlace de P-23 y no se llama a Auth;
 * 3. con Lead, el formulario no se vuelve a leer (salvo `siguiente`): el correo de la cuenta es el del Lead de la base;
 * 4. si el Lead ya tiene cuenta, vuelve a pintarse `/cuenta/crear`, que lo dice;
 * 5. los topes y la guardia de Auth, y el correo (`pedirCuentaDeEstudiante`).
 * La respuesta es la misma haya o no una cuenta de Auth con ese correo (RN-12).
 */
export async function pedirCuenta(_anterior: EstadoContacto, datos: FormData): Promise<EstadoContacto> {
  const fallo = (error: string, valores: Record<string, string> = {}): EstadoContacto => ({ error, aviso: null, valores });

  const sesion = await obtenerSesion();
  if (!sesion) return fallo(TEXTOS.sinSesion);
  if (sesion.rol === "monitor" || sesion.rol === "admin") return fallo(TEXTOS.equipo);
  if (sesion.rol === "estudiante") redirect(RUTA_DE_CITAS);
  if (sesion.rol !== "anonimo") return fallo(TEXTOS.sesionSinRol);

  const siguiente = rutaSiguiente(datos.get("siguiente"));

  let lead: LeadDeSesion | null;
  try {
    lead = await leadDeLaSesion(sesion.idUsuario);
  } catch (error) {
    console.error("[cuentas] no se pudo leer el contacto de la sesión:", resumenDeError(error));
    return fallo(TEXTOS.noPudimosGuardar);
  }

  // Lo que se escribió en el formulario solo se usa para crear el Lead; con Lead ya no se lee.
  let valores: Record<string, string> = {};
  const creoElLead = lead === null;
  if (!lead) {
    valores = valoresDe(datos);
    const contacto = leerContacto(datos);
    if (!contacto.ok) return fallo(contacto.error, valores);
    const consentimiento = leerConsentimiento(datos);
    if (!consentimiento.ok) return fallo(consentimiento.error, valores);
    const origen = leerOrigen((await cookies()).get(COOKIE_ORIGEN)?.value);

    let contactado: ResultadoContacto;
    try {
      contactado = await registrarContacto({
        idSesion: sesion.idUsuario,
        contacto: contacto.datos,
        consentimiento: consentimiento.consentimiento,
        origen,
        // El enlace de P-23 vuelve a esta pantalla, con la misma ruta de regreso.
        siguiente: rutaDeCrearCuenta(siguiente),
      });
    } catch (error) {
      console.error("[cuentas] no se pudo guardar el contacto:", resumenDeError(error));
      return fallo(TEXTOS.noPudimosGuardar, valores);
    }
    if (contactado.resultado === "error") return fallo(contactado.error, valores);
    // El correo ya es de otro Lead: sale el enlace de verificación a ese correo y no se llama a Auth.
    if (contactado.resultado === "verificar") {
      return { error: null, aviso: avisoDeVerificacion(contactado.envio, "creando tu cuenta"), valores };
    }

    try {
      lead = await leadDeLaSesion(sesion.idUsuario);
    } catch (error) {
      console.error("[cuentas] no se pudo leer el contacto recién guardado:", resumenDeError(error));
      return fallo(TEXTOS.noPudimosGuardar, valores);
    }
    if (!lead) return fallo(TEXTOS.noPudimosGuardar, valores);
  }

  let yaTieneCuenta: boolean;
  try {
    yaTieneCuenta = await leadTieneCuenta(lead.id);
  } catch (error) {
    console.error("[cuentas] no se pudo saber si el contacto ya tiene cuenta:", resumenDeError(error));
    return fallo(TEXTOS.noPudimosGuardar, valores);
  }
  // Se saltó la pantalla: no sale ningún correo y `/cuenta/crear` dice que ya tiene cuenta.
  if (yaTieneCuenta) redirect(rutaDeCrearCuenta(siguiente));
  if (!lead.correo) return fallo(TEXTOS.sinCorreo, valores);

  const supabase = await crearClienteServidor();
  if (!supabase) return fallo(TEXTOS.noSalioElCorreo, valores);

  let pedido: ResultadoDelPedido;
  try {
    pedido = await pedirCuentaDeEstudiante(supabase, { idSesion: sesion.idUsuario, lead });
  } catch (error) {
    console.error("[cuentas] no se pudo pedir la cuenta:", resumenDeError(error));
    return fallo(TEXTOS.noSalioElCorreo, valores);
  }
  if (pedido.resultado === "tope") return fallo(pedido.cual === "sesion" ? TEXTOS.topeDeSesion : TEXTOS.topeTotal, valores);
  if (pedido.resultado === "error") return fallo(pedido.error, valores);

  // La ruta de regreso viaja en una cookie del navegador que pidió la cuenta, no en el enlace ni en el usuario: si el
  // enlace se abre en otro dispositivo, esa cookie no existe y la persona termina en «Mis citas».
  const almacen = await cookies();
  if (siguiente === "/") {
    almacen.delete(COOKIE_SIGUIENTE);
  } else {
    almacen.set(COOKIE_SIGUIENTE, siguiente, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SEGUNDOS_DE_LA_COOKIE,
    });
  }
  // Quien dejó su contacto y pidió la cuenta en el mismo paso cambia de pantalla: ya tiene Lead, y `/cuenta/crear` pasa del
  // formulario al resumen. El formulario se desmonta y con él su aviso, así que el aviso viaja en la dirección.
  if (creoElLead) redirect(rutaDeCrearCuentaEnviada(siguiente));
  return { error: null, aviso: TEXTOS.avisoEnviado(lead.correo), valores };
}

export type EstadoTerminar = { error: string | null };

/**
 * HU-032, criterio 14: «Terminar de crear mi cuenta». Para quien confirmó su correo y quedó sin Estudiante (la base falló
 * un instante): repite `activarCuenta` con su sesión, sin otro enlace; repetirlo no falla. Si la base dice que el correo
 * ya no es el del Lead o que ese Lead ya tiene otro Estudiante, manda a soporte y no se reintenta.
 *
 * La guardia contra el panel olvidado (`confirmacionDeCorreoActiva`) va antes de pedir nada a Auth: este es el paso que da
 * el rol, y el correo de esta sesión pudo ligarse desde el navegador con `updateUser({ email })`, sin pasar por
 * `pedirCuenta`. Si Auth no exige confirmar el correo o no se pudo leer, no se activa nada y se dice lo mismo que cuando el
 * correo no sale.
 */
export async function terminarCuenta(): Promise<EstadoTerminar> {
  const sesion = await obtenerSesion();
  if (!sesion) return { error: TEXTOS.sinSesion };
  if (sesion.rol === "monitor" || sesion.rol === "admin") return { error: TEXTOS.equipo };
  if (sesion.rol === "estudiante") redirect(RUTA_DE_CITAS);
  // Solo quien confirmó su correo y no tiene rol (no anónima, sin Estudiante) termina su cuenta aquí.
  if (sesion.rol !== null) return { error: TEXTOS.sesionSinRol };

  if (!(await confirmacionDeCorreoActiva())) {
    console.error("[cuentas] Auth no exige confirmar el correo (o no se pudo leer su configuración): no se termina la cuenta.");
    return { error: TEXTOS.noSalioElCorreo };
  }

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: TEXTOS.terminarFallo };
  const token = await tokenDeAccesoDeLaSesion(supabase);
  if (!token) return { error: TEXTOS.sinSesion };

  let activada: ResultadoDeActivar;
  try {
    activada = await activarCuenta(sesion.idUsuario, token);
  } catch (error) {
    console.error("[cuentas] no se pudo terminar la cuenta:", resumenDeError(error));
    return { error: TEXTOS.terminarFallo };
  }
  if (activada.ok) redirect(RUTA_CONTRASENA);
  if (activada.motivo === "soporte") return { error: TEXTOS.soporte(identidadDelProveedor().correo) };
  // `activarCuenta` repite la guardia: si Auth cambió entre la lectura de arriba y la suya, es el mismo caso.
  if (activada.motivo === "sin_confirmacion") return { error: TEXTOS.noSalioElCorreo };
  return { error: TEXTOS.terminarFallo };
}
