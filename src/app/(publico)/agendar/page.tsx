import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { leerPedidoDeAgendar, requiereAvisoSinCancelacion, rutaDeContactoParaAgendar } from "@/lib/agendar/reglas";
import { obtenerSesion } from "@/lib/auth/sesion";
import { rutaDeMonitores, SEMANAS_DEL_HORIZONTE } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres, cargarMaterias } from "@/lib/disponibilidad/servidor";
import { leadDeLaSesion } from "@/lib/leads/servidor";
import { inicioDeSesion } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./agendar.module.css";
import { FormularioAgendar } from "./FormularioAgendar";
import { ResumenDeCita } from "./ResumenDeCita";

export const metadata: Metadata = { title: "Agendar una monitoría · Calibra" };

const EYEBROW = "Agendar";

/**
 * HU-017 (RN-32 a RN-37, D-3, D-5, D-8 a D-10): confirmar una fecha de la lista de monitores. Los datos de
 * la fecha salen de la misma lista pública (HU-016), así que lo que se confirma es lo que se mostró; si ya
 * no está libre, se dice. Quien todavía no es Lead deja primero su contacto (HU-068) y vuelve aquí.
 */
export default async function Agendar({ searchParams }: PageProps<"/agendar">) {
  const pedido = leerPedidoDeAgendar(await searchParams);
  if (!pedido) {
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No encontramos esa fecha">
        <p className={formulario.ayuda}>Elige una fecha en la lista de monitores certificados.</p>
        <Link href={rutaDeMonitores()} className={formulario.enlace}>
          Ver monitores certificados
        </Link>
      </Pantalla>
    );
  }

  const supabase = await crearClienteServidor();
  const sesion = await obtenerSesion();
  let datos;
  try {
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    const [materias, fechas] = await Promise.all([
      cargarMaterias(supabase),
      cargarFechasLibres(supabase, pedido.codigoMateria, SEMANAS_DEL_HORIZONTE),
    ]);
    const materia = materias.find((m) => m.codigo.toLowerCase() === pedido.codigoMateria.toLowerCase());
    const fecha = fechas.find((f) => f.idFranja === pedido.idFranja && f.fecha === pedido.fecha);
    // La sesión anónima nace en el navegador: en la primera visita todavía no hay quién sea Lead.
    const esDelEquipo = sesion?.rol === "monitor" || sesion?.rol === "admin";
    const lead = sesion && !esDelEquipo ? await leadDeLaSesion(sesion.idUsuario) : null;
    // Los parámetros de plazos se leen con sesión; sin ella, el aviso de RN-37 aparece al volver del contacto.
    const parametros = lead ? await cargarParametros(supabase) : null;
    const aviso = parametros && fecha ? requiereAvisoSinCancelacion(inicioDeSesion(fecha.fecha, fecha.hora), new Date(), parametros) : false;
    datos = { materia, fecha, esDelEquipo, lead, aviso, reservaMin: parametros?.reservaMin ?? null };
  } catch (error) {
    console.error("[agendar] no se pudo cargar la fecha:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar la fecha">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, inténtalo más tarde.
        </p>
      </Pantalla>
    );
  }

  const { materia, fecha, esDelEquipo, lead, aviso, reservaMin } = datos;
  const otrasFechas = (
    <Link href={rutaDeMonitores(materia?.codigo ?? pedido.codigoMateria)} className={formulario.enlace}>
      Ver otras fechas
    </Link>
  );

  if (!materia || !fecha) {
    return (
      <Pantalla eyebrow={EYEBROW} titulo="Esta fecha ya no está disponible">
        <p role="status" className={formulario.ayuda}>
          Alguien la apartó, ya no cumple las 3 horas de antelación o el monitor la cerró. Elige otra.
        </p>
        {otrasFechas}
      </Pantalla>
    );
  }

  return (
    <Pantalla eyebrow={EYEBROW} titulo="Confirma tu monitoría">
      <ResumenDeCita
        cita={{
          nombreMateria: materia.nombre,
          nombreMonitor: fecha.nombreMonitor,
          fecha: fecha.fecha,
          hora: fecha.hora,
          duracionMin: fecha.duracionMin,
          presencial: fecha.presencial,
          valor: fecha.precio,
        }}
      />
      {fecha.presencial && <p className={estilos.nota}>El lugar te llega con la cita confirmada.</p>}

      {esDelEquipo ? (
        <p role="alert" className={formulario.error}>
          Estás con tu cuenta del equipo de Calibra. Para agendar como estudiante, sal de tu cuenta o usa otra ventana.
        </p>
      ) : lead ? (
        <>
          <p className={estilos.nota}>
            Al apartarla, la fecha queda a tu nombre por {reservaMin} minutos mientras adjuntas el comprobante de pago. Si no
            llega, la reserva vence y la fecha se libera.
          </p>
          <FormularioAgendar pedido={pedido} avisoSinCancelacion={aviso} />
        </>
      ) : (
        <div className={estilos.acciones}>
          <p className={formulario.ayuda}>Para apartarla necesitamos tu nombre y tu correo. No necesitas crear una cuenta.</p>
          <Link href={rutaDeContactoParaAgendar(pedido)} className={formulario.boton}>
            Dejar mis datos y seguir
          </Link>
        </div>
      )}

      <div className={estilos.acciones}>{otrasFechas}</div>
    </Pantalla>
  );
}
