import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarFranjasParaAdmin } from "@/lib/admin/franjas";
import { MENSAJE_DE_FALLO_DE_FRANJA, avisoDeFranja, type FranjaParaAdmin } from "@/lib/admin/franjas-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { horaCorta, horaDeFin, nombreDelDia } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambiarMarcaDeFranja } from "./acciones";
import estilos from "./franjas.module.css";

export const metadata: Metadata = { title: "Franjas de oferta · Calibra" };

const RUTA = "/admin/franjas";

/**
 * HU-119 (D-85): las franjas abiertas de los monitores, con el botón para marcar una como oferta. Una franja marcada sale en el
 * listado del estudiante con el precio tachado y «Gratis», y agendar una de sus fechas deja la monitoría confirmada sin pago.
 * Cualquier admin activo la ve; la base solo da filas a un admin activo. Nunca muestra comisión.
 */
export default async function FranjasDeOferta({ searchParams }: PageProps<"/admin/franjas">) {
  await exigirRol("admin", RUTA);
  const aviso = avisoDeFranja(await searchParams);

  let franjas: FranjaParaAdmin[] | null = null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    franjas = await cargarFranjasParaAdmin(supabase);
  } catch (error) {
    console.error("[franjas] no se pudieron cargar las franjas:", error instanceof Error ? error.message : error);
  }

  return (
    <Pantalla eyebrow="Ofertas" titulo="Franjas de oferta" subtitulo="Marca una franja y quien la agende recibe la monitoría confirmada y gratis, sin pagar. En el listado se ve como una oferta.">
      {aviso && (
        <p role={aviso.exito ? "status" : "alert"} className={aviso.exito ? estilos.exito : formulario.error}>
          {aviso.texto}
        </p>
      )}
      {franjas === null ? (
        <p role="alert" className={formulario.error}>
          {MENSAJE_DE_FALLO_DE_FRANJA}
        </p>
      ) : franjas.length === 0 ? (
        <p>No hay franjas abiertas.</p>
      ) : (
        <ul className={estilos.lista}>
          {franjas.map((f) => (
            <li key={f.idFranja} className={estilos.franja}>
              <div className={estilos.datos}>
                <strong>{f.nombreMonitor}</strong>
                <span className={estilos.detalle}>
                  {nombreDelDia(f.dia)} {horaCorta(f.hora)} a {horaDeFin(f.hora, f.duracionMin)} · {f.presencial ? "Presencial" : "Virtual"} ·{" "}
                  {formatearPesos(f.precio)}
                </span>
                {f.dePrueba && <span className={estilos.marca}>Marcada como oferta gratis</span>}
              </div>
              <form action={cambiarMarcaDeFranja}>
                <input type="hidden" name="id_franja" value={f.idFranja} />
                <input type="hidden" name="de_prueba" value={f.dePrueba ? "0" : "1"} />
                <button type="submit" className={f.dePrueba ? formulario.botonSecundario : formulario.boton}>
                  {f.dePrueba ? "Quitar la oferta" : "Marcar como oferta gratis"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin" className={formulario.enlace}>
        Volver a la bandeja
      </Link>
    </Pantalla>
  );
}
