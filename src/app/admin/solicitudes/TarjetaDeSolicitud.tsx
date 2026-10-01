"use client";

import { useActionState } from "react";
import {
  ACCION_DEL_ESTADO,
  ESTADOS_QUE_MARCA_EL_ADMIN,
  NOMBRE_DEL_ESTADO,
  enlaceDeCorreo,
  type EstadoDeSolicitud,
} from "@/lib/solicitudes/reglas";
import { marcarSolicitud, type EstadoCambio } from "./acciones";
import estilos from "./solicitudes.module.css";

export type DatosDeTarjeta = {
  id: string;
  nombre: string;
  correo: string;
  numeroTelefono: string;
  estado: EstadoDeSolicitud;
  /** La fecha de envío, ya escrita para leer. */
  enviada: string;
  materias: string[];
};

const inicial: EstadoCambio = { error: null, exito: null };

/**
 * Una solicitud en la lista del admin, con sus cambios de estado. Los tres botones están siempre, con el del
 * estado actual marcado (`aria-pressed`), y ninguno se deshabilita mientras se envía: un botón deshabilitado
 * pierde el foco. Mientras se envía, el aviso se vacía, para que se anuncie aunque el resultado se repita.
 */
export function TarjetaDeSolicitud({ solicitud: s }: { solicitud: DatosDeTarjeta }) {
  const [resultado, accion, enviando] = useActionState(marcarSolicitud, inicial);
  const { estado } = s;

  return (
    <>
      <div className={estilos.encabezado}>
        <h2 className={estilos.nombre}>{s.nombre}</h2>
        <span className={estilos.estado} data-estado={estado}>
          {NOMBRE_DEL_ESTADO[estado]}
        </span>
      </div>
      <p className={estilos.dato}>Enviada el {s.enviada}</p>
      <p className={estilos.dato}>
        {s.materias.length === 1 ? "Materia: " : "Materias: "}
        {s.materias.join(", ")}
      </p>
      <p className={estilos.contacto}>
        <a href={`tel:${s.numeroTelefono}`} className={estilos.enlace}>
          {s.numeroTelefono}
        </a>
        <a href={enlaceDeCorreo(s.correo)} className={estilos.enlace}>
          {s.correo}
        </a>
      </p>
      <form action={accion} className={estilos.acciones} aria-label={`Cambiar el estado de la solicitud de ${s.nombre}`}>
        <input type="hidden" name="id_solicitud" value={s.id} />
        {ESTADOS_QUE_MARCA_EL_ADMIN.map((destino) => (
          <button
            key={destino}
            type="submit"
            name="estado"
            value={destino}
            aria-pressed={destino === estado}
            aria-disabled={enviando || undefined}
            onClick={(evento) => {
              if (enviando) evento.preventDefault();
            }}
            className={estilos.botonEstado}
          >
            {ACCION_DEL_ESTADO[destino]}
          </button>
        ))}
        {/* Siempre montado: un lector de pantalla solo anuncia los cambios de una región que ya existía. */}
        <p role="status" className={resultado.error ? estilos.error : estilos.exito}>
          {enviando ? null : (resultado.error ?? resultado.exito)}
        </p>
      </form>
    </>
  );
}
