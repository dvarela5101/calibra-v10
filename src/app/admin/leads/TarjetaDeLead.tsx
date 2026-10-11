"use client";

import { useActionState } from "react";
import { ETIQUETA_DE_ESTADO, type EstadoLead } from "@/lib/leads/estados";
import { enlaceDeCorreo } from "@/lib/solicitudes/reglas";
import { marcarLead, type EstadoCambio } from "./acciones";
import estilos from "./leads.module.css";

export type DatosDeTarjeta = {
  id: string;
  nombre: string;
  correo: string | null;
  numeroTelefono: string | null;
  estado: EstadoLead;
  origen: string | null;
  aceptaContacto: boolean;
  /** Cuándo dejó su contacto, ya escrito para leer. */
  dejoSuContacto: string;
  materias: string[];
  /** «Lo marcó … el …», ya escrito; `null` si nadie lo ha gestionado. */
  marcado: string | null;
};

const inicial: EstadoCambio = { error: null, exito: null };

/** Solo `+` y dígitos: el enlace `tel:` no lleva nada más. */
const enlaceDeTelefono = (telefono: string) => `tel:${telefono.replace(/[^+0-9]/g, "")}`;

/**
 * Un Lead en la lista del admin (HU-053). Entre nuevo y contactado se cambia con un clic (`aria-pressed` marca el
 * actual). Descartar pide confirmar en la misma tarjeta y avisa que no se deshace (D-61 d); un descartado no tiene
 * botones. Ningún botón se deshabilita mientras se envía: uno deshabilitado pierde el foco, y si falla el foco se
 * queda donde estaba. El aviso siempre está montado, para que un lector de pantalla lo anuncie.
 */
export function TarjetaDeLead({ lead: l }: { lead: DatosDeTarjeta }) {
  const [resultado, accion, enviando] = useActionState(marcarLead, inicial);
  const evitarDoble = (evento: React.MouseEvent) => {
    if (enviando) evento.preventDefault();
  };

  return (
    <>
      <div className={estilos.encabezado}>
        <h2 className={estilos.nombre}>{l.nombre}</h2>
        <span className={estilos.estado} data-estado={l.estado}>
          {ETIQUETA_DE_ESTADO[l.estado]}
        </span>
      </div>
      {l.marcado && <p className={estilos.dato}>{l.marcado}</p>}
      <p className={estilos.dato}>Dejó su contacto el {l.dejoSuContacto}</p>
      <dl className={estilos.datos}>
        <div>
          <dt>Origen</dt>
          <dd>{l.origen ?? "Sin origen"}</dd>
        </div>
        <div>
          <dt>{l.materias.length === 1 ? "Materia" : "Materias"}</dt>
          <dd>{l.materias.length ? l.materias.join(", ") : "Sin materia"}</dd>
        </div>
        <div>
          <dt>Acepta contacto</dt>
          <dd>{l.aceptaContacto ? "Sí" : "No"}</dd>
        </div>
      </dl>
      <p className={estilos.contacto}>
        {l.correo && (
          <a href={enlaceDeCorreo(l.correo)} className={estilos.enlace}>
            {l.correo}
          </a>
        )}
        {l.numeroTelefono && (
          <a href={enlaceDeTelefono(l.numeroTelefono)} className={estilos.enlace}>
            {l.numeroTelefono}
          </a>
        )}
      </p>
      {l.estado !== "descartado" && (
        <form action={accion} className={estilos.acciones} aria-label={`Cambiar el estado de ${l.nombre}`}>
          <input type="hidden" name="id_lead" value={l.id} />
          {(["nuevo", "contactado"] as const).map((destino) => (
            <button
              key={destino}
              type="submit"
              name="estado"
              value={destino}
              aria-pressed={destino === l.estado}
              aria-disabled={enviando || undefined}
              onClick={evitarDoble}
              className={estilos.botonEstado}
            >
              {destino === "nuevo" ? "Marcar como nuevo" : "Marcar como contactado"}
            </button>
          ))}
          <details className={estilos.descartar}>
            <summary className={estilos.resumen}>Descartar</summary>
            <p className={estilos.dato}>
              Un lead descartado no sale en la descarga y no se puede volver a cambiar desde esta pantalla.
            </p>
            <button
              type="submit"
              name="estado"
              value="descartado"
              aria-disabled={enviando || undefined}
              onClick={evitarDoble}
              className={estilos.botonDescartar}
            >
              Sí, descartar a {l.nombre}
            </button>
          </details>
          <p role="status" className={resultado.error ? estilos.error : estilos.exito}>
            {enviando ? null : (resultado.error ?? resultado.exito)}
          </p>
        </form>
      )}
    </>
  );
}
