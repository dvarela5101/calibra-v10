import type { Metadata } from "next";
import { obtenerSesion } from "@/lib/auth/sesion";
import { vistaDeCita, type Cita } from "@/lib/citas/reglas";
import { leerCitaPorToken, leerMisCitas } from "@/lib/citas/servidor";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { CancelarCita } from "./CancelarCita";
import { DetalleDeCita, EnlaceQueNoSirve, NoPudimosCargar } from "./DetalleDeCita";
import { ListaDeCitas } from "./ListaDeCitas";

// Con `?token=` el enlace del correo trae el token: que no quede en buscadores ni se filtre por el Referer.
export async function generateMetadata({ searchParams }: PageProps<"/cita">): Promise<Metadata> {
  const { token } = await searchParams;
  return {
    title: token === undefined ? "Mis citas · Calibra" : "Tu cita · Calibra",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * HU-019 (P-04, D-20): la cita del Lead. Con `?token=` (el enlace del correo de confirmación) muestra esa cita, sin
 * sesión y sin ligar el navegador al Lead; sin token, "Mis citas" de la sesión del navegador (criterio 4, D-24).
 * Va fuera del grupo `(publico)`: abrir el enlace desde otro dispositivo no crea una sesión anónima. Con el enlace
 * también se cancela (HU-024): el botón solo sale mientras hay plazo; la base decide con su propia hora.
 */
export default async function Cita({ searchParams }: PageProps<"/cita">) {
  const { token } = await searchParams;
  if (token === undefined) return <MisCitas />;

  // Un token vacío o repetido (`?token=a&token=b` llega como arreglo) no es un enlace válido: la misma pantalla
  // que para uno inventado, sin consultar nada.
  let cita: Cita | null;
  try {
    cita = typeof token === "string" ? await leerCitaPorToken(token) : null;
  } catch (error) {
    // Solo el mensaje: el token nunca va al registro.
    console.error("[citas] no se pudo leer la cita del enlace:", error instanceof Error ? error.message : error);
    return <NoPudimosCargar titulo="No pudimos cargar tu cita" />;
  }
  if (!cita || typeof token !== "string") return <EnlaceQueNoSirve />;

  const ahora = new Date();
  const puedeCancelar = vistaDeCita(cita, ahora).puedeCancelar;
  return (
    <DetalleDeCita
      cita={cita}
      ahora={ahora}
      acciones={puedeCancelar ? <CancelarCita origen={{ token }} estadoPago={cita.estadoPago} /> : undefined}
      contactoSoporte={identidadDelProveedor().correo}
    />
  );
}

/** Las citas de la sesión del navegador. Sin sesión no hay citas: se ve la misma lista vacía. */
async function MisCitas() {
  const sesion = await obtenerSesion();
  const supabase = await crearClienteServidor();

  let citas: Cita[] = [];
  if (sesion && supabase) {
    try {
      citas = await leerMisCitas(supabase);
    } catch (error) {
      console.error("[citas] no se pudieron leer las citas de la sesión:", error instanceof Error ? error.message : error);
      return <NoPudimosCargar titulo="No pudimos cargar tus citas" />;
    }
  }

  return <ListaDeCitas citas={citas} ahora={new Date()} />;
}
