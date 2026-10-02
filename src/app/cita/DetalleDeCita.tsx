import Link from "next/link";
import type { ReactNode } from "react";
import { ResumenDeCita } from "@/app/(publico)/agendar/ResumenDeCita";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { rutaDeReserva } from "@/lib/agendar/reglas";
import { RUTA_DE_CITAS, vistaDeCita, type Cita } from "@/lib/citas/reglas";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";
import estilos from "./cita.module.css";

const EYEBROW = "Tu monitoría";

type Props = {
  cita: Cita;
  /** La hora de la petición: de ella dependen la vista (antes, en curso, terminada) y el plazo. */
  ahora: Date;
  /**
   * El hueco de las acciones. HU-024 pone aquí "Cancelar" cuando `vistaDeCita(cita, ahora).puedeCancelar` y HU-029
   * pone "El monitor no llegó" cuando `puedeReportar`. Sin ellas (D-25), la página solo dice hasta cuándo se puede cancelar.
   */
  acciones?: ReactNode;
  /** Con la sesión del Lead se ofrece volver a "Mis citas"; con el enlace del correo no (no hay sesión que lo respalde). */
  conLista?: boolean;
};

/**
 * Una cita para su Lead (HU-019), la misma con el enlace del correo o con la sesión del navegador. Qué se dice lo
 * decide `vistaDeCita`; aquí solo se ordena. El lugar o el enlace de la videollamada salen solo con la cita
 * confirmada y el pago sin rechazar (D-21); de una terminada o cancelada no se muestran. Nada del contacto del
 * monitor ni cifras de comisión (P-37).
 */
export function DetalleDeCita({ cita, ahora, acciones, conLista = false }: Props) {
  const vista = vistaDeCita(cita, ahora);
  const conOtraMonitoria = vista.tipo === "cancelada" || vista.tipo === "realizada";

  return (
    <Pantalla eyebrow={EYEBROW} titulo={vista.titulo} subtitulo={vista.textoDelEstado ?? vista.textoDelMotivo ?? undefined}>
      <ResumenDeCita
        cita={{
          nombreMateria: cita.nombreMateria,
          nombreMonitor: cita.nombreMonitor,
          fecha: cita.fecha,
          hora: cita.hora,
          duracionMin: cita.duracionMin,
          presencial: cita.presencial,
          valor: cita.valorTotal,
          lugar: vista.mostrarLugarYEnlace ? cita.lugar : null,
          enlace: vista.mostrarLugarYEnlace ? cita.enlace : null,
        }}
      />
      {vista.textoDelPlazo && (
        <div className={vista.puedeCancelar ? estilos.plazo : estilos.plazoTerminado}>
          <p className={estilos.textoPlazo}>{vista.textoDelPlazo}</p>
        </div>
      )}
      {vista.textoDelPago && <p className={estilos.nota}>{vista.textoDelPago}</p>}
      {vista.textoDelReembolso && <p className={estilos.aviso}>{vista.textoDelReembolso}</p>}
      {acciones && <div className={estilos.acciones}>{acciones}</div>}
      <div className={estilos.enlaces}>
        {vista.tipo === "pendiente_pago" && (
          <Link href={rutaDeReserva(cita.idMonitoria)} className={formulario.boton}>
            Ir a mi reserva
          </Link>
        )}
        {conOtraMonitoria && (
          <Link href={rutaDeMonitores(cita.codigoMateria)} className={formulario.enlace}>
            Ver monitores de {cita.nombreMateria}
          </Link>
        )}
        {conLista && (
          <Link href={RUTA_DE_CITAS} className={formulario.enlace}>
            Ver mis citas
          </Link>
        )}
      </div>
    </Pantalla>
  );
}

/**
 * Token inventado, mal formado, repetido o vacío: una sola pantalla, sin ningún dato de ninguna cita. Que el enlace
 * esté mal escrito y que no exista se ven igual (criterio 3 de HU-019).
 */
export function EnlaceQueNoSirve() {
  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo="Este enlace no sirve"
      subtitulo="Está incompleto o no lo reconocemos. Abre de nuevo el enlace del correo que te mandamos."
    >
      <Link href="/" className={formulario.enlace}>
        Ir al inicio
      </Link>
    </Pantalla>
  );
}

/** La base no respondió: se dice sin dar detalles y se invita a reintentar. */
export function NoPudimosCargar({ titulo }: { titulo: string }) {
  return (
    <Pantalla eyebrow={EYEBROW} titulo={titulo}>
      <p role="alert" className={formulario.error}>
        Recarga la página; si sigue igual, inténtalo más tarde.
      </p>
    </Pantalla>
  );
}
