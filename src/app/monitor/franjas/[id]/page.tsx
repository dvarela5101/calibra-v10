import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio, formatearDia } from "@/lib/fechas";
import { horaCorta, horaDeFin, nombreDelDia } from "@/lib/franjas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioFranja } from "../FormularioFranja";
import estilos from "../franjas.module.css";
import { FormularioCierre } from "./FormularioCierre";

export const metadata: Metadata = { title: "Editar franja · Calibra" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El día siguiente a `AAAA-MM-DD`. */
function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** HU-015: editar o cerrar una franja (P-30). Lo que no se puede cambiar se explica antes de intentarlo. */
export default async function EditarFranja({ params }: PageProps<"/monitor/franjas/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("monitor", `/monitor/franjas/${id}`);
  if (!UUID.test(id)) notFound();

  const supabase = await crearClienteServidor();
  // El lugar y el enlace no se leen de la tabla (P-31): los da acceso_a_mis_franjas(), solo de las propias.
  const [franjaLeida, accesoLeido, monitoriasLeidas] = await Promise.all([
    supabase!
      .from("franja")
      .select("id, dia, hora, duracion_min, presencial, precio, cerrada_desde")
      .eq("id", id)
      .eq("id_monitor", sesion.idUsuario)
      .maybeSingle(),
    supabase!.rpc("acceso_a_mis_franjas").eq("id_franja", id).maybeSingle(),
    supabase!.from("monitoria").select("fecha").eq("id_franja", id).neq("estado", "cancelada"),
  ]);
  // Un error de la base no es "no existe": que lo muestre la página de error en vez de un 404.
  const fallo = franjaLeida.error ?? accesoLeido.error ?? monitoriasLeidas.error;
  if (fallo) throw new Error(`No se pudo leer la franja: ${fallo.message}`);
  const franja = franjaLeida.data;
  if (!franja) notFound();
  const acceso = accesoLeido.data;
  const monitorias = monitoriasLeidas.data;

  const hoy = diaDelNegocio(new Date());
  const fechas = (monitorias ?? []).map((m) => m.fecha).sort();
  const futuras = fechas.filter((f) => f >= hoy);
  const ultimaFutura = futuras.at(-1);
  const desdeMinimo = ultimaFutura ? diaSiguiente(ultimaFutura) : hoy;
  const cerrada = franja.cerrada_desde !== null && franja.cerrada_desde <= hoy;
  const hora = horaCorta(franja.hora);

  return (
    <Pantalla
      eyebrow="Mis franjas"
      titulo={`${nombreDelDia(franja.dia)}, ${hora} a ${horaDeFin(franja.hora, franja.duracion_min)}`}
      subtitulo={
        futuras.length
          ? `Tiene ${futuras.length === 1 ? "1 monitoría agendada" : `${futuras.length} monitorías agendadas`}; la última es el ${formatearDia(ultimaFutura!)}.`
          : "No tiene monitorías agendadas."
      }
    >
      {cerrada ? (
        <p role="status" className={formulario.ayuda}>
          Esta franja está cerrada desde el {formatearDia(franja.cerrada_desde!)}.
        </p>
      ) : (
        <>
          <section aria-labelledby="editar" className={estilos.seccion}>
            <h2 id="editar" className={estilos.titulo}>
              Editar
            </h2>
            <FormularioFranja
              modo="editar"
              id={franja.id}
              horarioFijo={fechas.length > 0}
              modalidadFija={futuras.length > 0}
              iniciales={{
                dia: String(franja.dia),
                hora,
                duracion_min: String(franja.duracion_min),
                precio: String(franja.precio),
                modalidad: franja.presencial ? "presencial" : "virtual",
                lugar: acceso?.lugar ?? "",
                enlace: acceso?.enlace ?? "",
              }}
            />
          </section>

          <section aria-labelledby="cerrar" className={estilos.seccion}>
            <h2 id="cerrar" className={estilos.titulo}>
              Cerrar
            </h2>
            {franja.cerrada_desde && (
              <p className={formulario.ayuda}>Ya se cierra desde el {formatearDia(franja.cerrada_desde)}. Puedes elegir otra fecha.</p>
            )}
            <FormularioCierre id={franja.id} desdeMinimo={desdeMinimo} />
          </section>
        </>
      )}

      <Link href="/monitor/franjas" className={formulario.enlace}>
        Volver a mis franjas
      </Link>
    </Pantalla>
  );
}
