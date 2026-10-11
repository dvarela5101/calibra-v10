"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { registrarPedidoSinContacto, type EstadoCambio } from "./acciones";
import estilos from "./leads.module.css";

const inicial: EstadoCambio = { error: null, exito: null };

/**
 * «Pidió no recibir mensajes» (HU-089, D-61 f). Abre la confirmación en la misma tarjeta; «Cancelar» la cierra y
 * devuelve el foco al botón. Al registrarse, la página se vuelve a pintar sin este bloque y con la nota.
 */
export function PedidoSinContacto({ idLead, nombre }: { idLead: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (!abierta && devolverFoco.current) {
      devolverFoco.current = false;
      boton.current?.focus();
    }
  }, [abierta]);

  return (
    <div className={estilos.sinContacto}>
      {abierta ? (
        <Confirmacion
          idLead={idLead}
          nombre={nombre}
          cancelar={() => {
            devolverFoco.current = true;
            setAbierta(false);
          }}
        />
      ) : (
        <button ref={boton} type="button" onClick={() => setAbierta(true)} className={estilos.botonEstado}>
          Pidió no recibir mensajes
        </button>
      )}
    </div>
  );
}

/**
 * La confirmación. Tiene su propio estado de la acción: al cancelar se desmonta, y un error de antes no reaparece al
 * volver a abrirla. Si falla, el error sale con `role="alert"` y el foco queda en «Sí, registrar» (ningún botón se
 * deshabilita: perdería el foco).
 */
function Confirmacion({ idLead, nombre, cancelar }: { idLead: string; nombre: string; cancelar: () => void }) {
  const [resultado, accion, enviando] = useActionState(registrarPedidoSinContacto, inicial);
  const confirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmar.current?.focus();
  }, []);

  return (
    <form action={accion} className={estilos.confirmacion} aria-label={`Registrar que ${nombre} pidió no recibir mensajes`}>
      <input type="hidden" name="id_lead" value={idLead} />
      <p className={estilos.dato}>
        ¿Registrar que {nombre} pidió no recibir más mensajes? Dejará de salir en la lista para contactar y no se puede
        deshacer desde esta pantalla.
      </p>
      <div className={estilos.acciones}>
        <button
          ref={confirmar}
          type="submit"
          aria-disabled={enviando || undefined}
          onClick={(evento) => {
            if (enviando) evento.preventDefault();
          }}
          className={estilos.botonEstado}
        >
          Sí, registrar
        </button>
        <button type="button" onClick={cancelar} className={estilos.botonEstado}>
          Cancelar
        </button>
      </div>
      {!enviando && resultado.error && (
        <p role="alert" className={estilos.error}>
          {resultado.error}
        </p>
      )}
    </form>
  );
}
