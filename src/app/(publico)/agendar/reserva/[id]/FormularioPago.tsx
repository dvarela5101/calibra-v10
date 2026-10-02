"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { mensajeDeRegistroPago, validarPagador } from "@/lib/pagos/reglas";
import { crearClienteNavegador } from "@/lib/supabase/navegador";
import { pagar, type EstadoPago } from "./acciones";
import { horaDelServidor } from "./relojDelServidor";

const estadoInicial: EstadoPago = { error: null };

const SIN_ARCHIVO = "Elige la captura o el PDF del comprobante de la transferencia.";
const SIN_SUBIDA = "No se pudo subir el comprobante. Inténtalo de nuevo.";
const SIN_RESPUESTA =
  "No pudimos comunicarnos con Calibra. Revisa tu conexión e inténtalo de nuevo: no hace falta volver a subir el comprobante. Si ya lo habías enviado, recarga la página para ver si quedó.";

/**
 * La acción, sin que un fallo de la red o un despliegue nuevo tumbe la página: si la llamada misma falla,
 * el formulario se queda con lo escrito y con la ruta ya subida, y la persona reintenta sin gastar otra subida.
 */
async function pagarSinCaerse(anterior: EstadoPago, datos: FormData): Promise<EstadoPago> {
  try {
    return await pagar(anterior, datos);
  } catch {
    return { error: SIN_RESPUESTA };
  }
}

type Props = {
  idMonitoria: string;
  /** Hasta cuándo queda apartada la reserva (ISO) y la hora del servidor al pintar la página (ISO). */
  hasta: string;
  ahora: string;
  /** La sesión que paga: el comprobante va a su carpeta del bucket (HU-007). */
  idUsuario: string;
  /** Los del Lead, para prellenar: el pagador es el Lead y puede corregirlos (supuesto 3). */
  nombre: string;
  correo: string;
};

/**
 * HU-018: el nombre y el correo de quien paga y el comprobante. El archivo sube del navegador directo al
 * Storage, en la carpeta de la sesión, y la acción recibe solo la ruta: por eso el campo del archivo no tiene
 * `name` (si lo tuviera, viajaría en el cuerpo de la acción, que acepta hasta 1 MB, y un comprobante puede
 * pesar 10). El formulario no se envía con `action` sino con `onSubmit`, porque primero hay que esperar la
 * subida; así React tampoco lo vacía tras cada intento.
 */
export function FormularioPago({ idMonitoria, hasta, ahora, idUsuario, nombre, correo }: Props) {
  const router = useRouter();
  const [estado, pagarConComprobante, enviando] = useActionState(pagarSinCaerse, estadoInicial);
  const [subiendo, setSubiendo] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const campoArchivo = useRef<HTMLInputElement>(null);
  // La última subida. Si la acción falla por otra cosa (la red, nadie del equipo disponible), reintentar con el
  // mismo archivo no gasta otra de las 5 subidas del día (HU-059). Otro archivo elegido sí se sube.
  const subida = useRef<{ archivo: File; ruta: string } | null>(null);

  const ocupado = subiendo || enviando;
  // El error de un intento anterior no se muestra mientras corre el nuevo.
  const error = errorLocal ?? (ocupado ? null : estado.error);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    const datos = new FormData(evento.currentTarget);

    // Lo mismo que revisa la acción, antes de subir: un correo mal escrito no debe gastar una subida.
    const pagador = validarPagador({ nombre: datos.get("nombre"), correo: datos.get("correo") });
    if (!pagador.ok) return setErrorLocal(pagador.mensaje);
    const archivo = campoArchivo.current?.files?.[0];
    if (!archivo) return setErrorLocal(SIN_ARCHIVO);
    // Criterio 4: con la reserva vencida no se sube nada (no gasta una de las 5 subidas del día) y se pide la
    // página de nuevo, que ya no trae el formulario. La base lo rechaza igual si el reloj se queda corto.
    if (horaDelServidor(ahora) > new Date(hasta)) {
      setErrorLocal(mensajeDeRegistroPago("vencida"));
      router.refresh();
      return;
    }
    setErrorLocal(null);

    let ruta = subida.current?.archivo === archivo ? subida.current.ruta : null;
    if (!ruta) {
      const cliente = crearClienteNavegador();
      if (!cliente) return setErrorLocal(SIN_SUBIDA);
      setSubiendo(true);
      try {
        const resultado = await subirComprobante(cliente, idUsuario, archivo);
        if (!resultado.ok) return setErrorLocal(resultado.mensaje);
        subida.current = { archivo, ruta: resultado.ruta };
        ruta = resultado.ruta;
      } catch {
        return setErrorLocal(SIN_SUBIDA);
      } finally {
        setSubiendo(false);
      }
    }

    datos.set("idMonitoria", idMonitoria);
    datos.set("ruta", ruta);
    // La acción se llama por código, después de la subida: tiene que ir en una transición (useActionState).
    // Si registra el pago, la misma respuesta trae la página ya confirmada.
    startTransition(() => pagarConComprobante(datos));
  }

  // `method="post"`: si alguien lo envía antes de que cargue el JavaScript, el nombre y el correo no quedan en la URL.
  return (
    <form method="post" onSubmit={enviar} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="pago-nombre" className={formulario.etiqueta}>
          Tu nombre
        </label>
        <input id="pago-nombre" name="nombre" autoComplete="name" defaultValue={nombre} required className={formulario.entrada} />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="pago-correo" className={formulario.etiqueta}>
          Tu correo
        </label>
        <p id="pago-correo-ayuda" className={formulario.ayuda}>
          Ahí te escribimos si hay algún problema con el pago.
        </p>
        <input
          id="pago-correo"
          name="correo"
          type="email"
          autoComplete="email"
          defaultValue={correo}
          aria-describedby="pago-correo-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="pago-comprobante" className={formulario.etiqueta}>
          Comprobante de la transferencia
        </label>
        <p id="pago-comprobante-ayuda" className={formulario.ayuda}>
          La captura (JPG o PNG) o el PDF que te da tu banco, de hasta 10 MB.
        </p>
        <input
          ref={campoArchivo}
          id="pago-comprobante"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          aria-describedby="pago-comprobante-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      {error && (
        <p role="alert" className={formulario.error}>
          {error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={ocupado}>
        {subiendo ? "Subiendo…" : enviando ? "Enviando…" : "Enviar comprobante"}
      </button>
    </form>
  );
}
