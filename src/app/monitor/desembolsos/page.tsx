import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { agruparDesembolsos, partirEn, TRANSFERIDOS_A_LA_VISTA, type DesembolsoDelMonitor } from "@/lib/desembolsos/reglas";
import { cargarMisDesembolsos, type MisDesembolsos } from "@/lib/desembolsos/servidor";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./desembolsos.module.css";
import { TarjetaDeDesembolso } from "./TarjetaDeDesembolso";

export const metadata: Metadata = { title: "Mis desembolsos · Calibra" };

/**
 * HU-050 (RN-80 a RN-83, P-28, P-29, P-37, D-59): el monitor ve sus desembolsos por transferir, transferidos y
 * anulados, con la materia y la sesión y, de los que se transfieren o ya se transfirieron, el total de la monitoría,
 * la comisión de Calibra y lo que se le transfiere. Es la única pantalla con cifras de comisión (D-59). No tiene
 * formularios: la lista es la del momento de cargar y un admin hace la transferencia.
 */
export default async function MisDesembolsos() {
  const sesion = await exigirRol("monitor", "/monitor/desembolsos");
  const supabase = await crearClienteServidor();

  let carga: MisDesembolsos;
  try {
    carga = await cargarMisDesembolsos(supabase!, sesion.idUsuario);
  } catch (error) {
    console.error("[desembolsos] no se pudo cargar:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow="Panel del monitor" titulo="Mis desembolsos">
        <p role="alert" className={formulario.error}>
          No pudimos cargar tus desembolsos. Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <Link href="/monitor" className={formulario.enlace}>
          Volver a mi panel
        </Link>
      </Pantalla>
    );
  }

  const { desembolsos, llaveActual } = carga;
  const { porTransferir, transferidos, anulados } = agruparDesembolsos(desembolsos);
  const { aLaVista, resto } = partirEn(transferidos, TRANSFERIDOS_A_LA_VISTA);
  const correo = identidadDelProveedor().correo;
  const tarjetas = (lista: DesembolsoDelMonitor[]) => (
    <ul className={estilos.lista}>
      {lista.map((d) => (
        <TarjetaDeDesembolso key={d.idDesembolso} desembolso={d} llaveActual={llaveActual} correo={correo} />
      ))}
    </ul>
  );

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo="Mis desembolsos"
      subtitulo="Lo que Calibra te transfiere por cada monitoría realizada: lo que está por transferir, lo que ya se transfirió y lo que se anuló."
    >
      {desembolsos.length === 0 ? (
        <p role="status" className={formulario.ayuda}>
          Todavía no tienes desembolsos. Aparece uno cuando una monitoría tuya queda realizada.
        </p>
      ) : (
        <>
          <section aria-labelledby="por-transferir" className={estilos.seccion}>
            <h2 id="por-transferir" className={estilos.titulo}>
              {`Por transferir (${porTransferir.length})`}
            </h2>
            {porTransferir.length === 0 ? <p className={formulario.ayuda}>Ninguno por ahora.</p> : tarjetas(porTransferir)}
          </section>

          <section aria-labelledby="transferidos" className={estilos.seccion}>
            <h2 id="transferidos" className={estilos.titulo}>
              {`Transferidos (${transferidos.length})`}
            </h2>
            {transferidos.length === 0 ? (
              <p className={formulario.ayuda}>Ninguno por ahora.</p>
            ) : (
              <>
                {tarjetas(aLaVista)}
                {resto.length > 0 && (
                  <details className={estilos.mas}>
                    <summary className={estilos.resumen}>{resto.length === 1 ? "Ver 1 desembolso más" : `Ver ${resto.length} desembolsos más`}</summary>
                    {tarjetas(resto)}
                  </details>
                )}
              </>
            )}
          </section>

          {anulados.length > 0 && (
            <section aria-labelledby="anulados" className={estilos.seccion}>
              <h2 id="anulados" className={estilos.titulo}>
                {`Anulados (${anulados.length})`}
              </h2>
              {tarjetas(anulados)}
            </section>
          )}
        </>
      )}

      <Link href="/monitor" className={formulario.enlace}>
        Volver a mi panel
      </Link>
    </Pantalla>
  );
}
