import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarCitasSinPlazo, type CitasSinPlazo } from "@/lib/admin/citas";
import { contactoDe } from "@/lib/admin/citas-reglas";
import { textoDePago } from "@/lib/agenda/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearDia } from "@/lib/fechas";
import { horaCorta } from "@/lib/franjas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./citas.module.css";

export const metadata: Metadata = { title: "Citas sin plazo para cancelar · Calibra" };

const EYEBROW = "Cancelaciones";

/**
 * HU-052: las individuales confirmadas a las que ya se les pasó el plazo de 12 h para cancelar y todavía no empiezan, la que
 * empieza primero arriba (RN-60, D-60). Cada una abre su página, donde un admin autoriza cancelarla en un caso extremo.
 * Cualquier admin activo la ve (las políticas ya lo dejan; a otro rol la vista le da cero filas). Sin paginación: son las
 * citas de una ventana de 12 h. Nunca muestra comisión.
 */
export default async function CitasSinPlazoParaCancelar() {
  await exigirRol("admin", "/admin/citas");

  let citas: CitasSinPlazo;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    citas = await cargarCitasSinPlazo(supabase);
  } catch (error) {
    console.error("[citas] no se pudieron cargar las citas sin plazo:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar las citas">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }

  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo="Citas sin plazo para cancelar"
      subtitulo="Son las monitorías individuales confirmadas a las que ya se les pasó el plazo para cancelar y todavía no empiezan. Abre una para autorizar su cancelación en un caso extremo."
    >
      <div className={estilos.seccion}>
        {citas.filas.length === 0 ? (
          <p className={estilos.vacio}>No hay citas con el plazo vencido que todavía no empiecen.</p>
        ) : (
          <ul className={estilos.lista}>
            {citas.filas.map((cita) => (
              <li key={cita.id}>
                <a href={`/admin/citas/${cita.id}`} className={estilos.filaEnlace}>
                  <span className={estilos.nombre}>
                    <time dateTime={cita.inicio.toISOString()}>
                      {formatearDia(cita.fecha)} a las {horaCorta(cita.hora)}
                    </time>
                  </span>
                  <span className={estilos.metaLarga}>
                    {cita.nombreMateria} · {cita.nombreMonitor}
                  </span>
                  <span className={estilos.metaLarga}>
                    Agendó {cita.lead.nombre} · {contactoDe(cita.lead)}
                  </span>
                  <span className={estilos.meta}>{textoDePago(cita.estadoPago)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {citas.total > citas.filas.length && (
          <p className={estilos.ayuda}>
            Se muestran las primeras {citas.filas.length} de {citas.total}.
          </p>
        )}
      </div>
      <VolverALaBandeja />
    </Pantalla>
  );
}

function VolverALaBandeja() {
  return (
    <Link href="/admin" className={formulario.enlace}>
      Volver a mi bandeja
    </Link>
  );
}
