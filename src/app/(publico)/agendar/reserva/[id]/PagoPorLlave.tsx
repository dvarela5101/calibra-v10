import formulario from "@/components/formulario.module.css";
import { formatearPesos } from "@/lib/moneda";
import { configuracionDeLlave, identidadDelProveedor } from "@/lib/pagos/configuracion";
import { dentroDePlazo } from "@/lib/plazos/motor";
import { describirTiempoRestante } from "@/lib/plazos/restante";
import { BotonCopiar } from "./BotonCopiar";
import { FormularioPago } from "./FormularioPago";
import estilos from "./pago.module.css";
import { TiempoRestante } from "./TiempoRestante";

type Props = {
  idMonitoria: string;
  valorTotal: number;
  reservaHasta: Date;
  ahora: Date;
  /** La sesión del Lead, que es quien paga. */
  idUsuario: string;
  pagador: { nombre: string; correo: string };
};

/**
 * HU-018 (RN-40, F3 paso 3): el pago de una reserva por pagar, solo para su Lead. Antes de pagar, a quién le
 * paga (Ley 1480 de 2011, art. 50); el resumen de la cita ya está arriba. La llave, su titular y el QR salen de
 * la configuración del servidor (criterio 5): si falta algo, se dice que el pago no está disponible y no se
 * muestra ninguna llave ni el formulario. El monto no se escribe: lo pone la base (P-36).
 * Si la reserva ya venció (RN-34), solo lo dice (criterio 4); la base también rechaza un comprobante tardío.
 */
export function PagoPorLlave({ idMonitoria, valorTotal, reservaHasta, ahora, idUsuario, pagador }: Props) {
  if (!dentroDePlazo(reservaHasta, ahora)) {
    return <p className={estilos.nota}>La reserva expiró: ya no puedes adjuntar el comprobante.</p>;
  }

  const proveedor = identidadDelProveedor();
  const llave = configuracionDeLlave();
  const valor = formatearPesos(valorTotal);
  const correo = proveedor.correo && (
    <a href={`mailto:${proveedor.correo}`} className={formulario.enlaceEnTexto}>
      {proveedor.correo}
    </a>
  );

  return (
    <section aria-labelledby="pago-titulo" className={estilos.pago}>
      <h2 id="pago-titulo" className={estilos.titulo}>
        Paga {valor} por Llave
      </h2>
      <p className={formulario.ayuda}>
        Le pagas a {proveedor.nombre}
        {proveedor.documento && `, documento ${proveedor.documento}`}.{correo && <> Correo: {correo}.</>}
      </p>

      {!llave ? (
        <p role="alert" className={formulario.error}>
          El pago por Llave no está disponible en este momento.{" "}
          {correo ? <>Escríbenos a {correo} y te ayudamos a pagar tu monitoría.</> : "Inténtalo más tarde."}
        </p>
      ) : (
        <>
          <TiempoRestante
            hasta={reservaHasta.toISOString()}
            ahora={ahora.toISOString()}
            textoInicial={describirTiempoRestante(reservaHasta, ahora).texto}
          />
          <p className={estilos.nota}>Desde la app de tu banco, transfiere {valor} a esta llave o escanea el código QR. Después adjunta el comprobante.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- El QR es la imagen que da el banco y su URL es configuración externa: next/image exigiría declarar su dominio en next.config. */}
          <img
            src={llave.qrUrl}
            alt={`Código QR para transferir a la llave ${llave.llave}, de ${llave.titular}`}
            width={220}
            height={220}
            className={estilos.qr}
          />
          <div className={formulario.campo}>
            <label htmlFor="pago-llave" className={formulario.etiqueta}>
              Llave
            </label>
            <input id="pago-llave" readOnly value={llave.llave} className={`${formulario.entrada} ${estilos.llave}`} />
            <BotonCopiar texto={llave.llave} idCampo="pago-llave" />
          </div>
          <p className={formulario.ayuda}>Titular de la llave: {llave.titular}</p>
          <FormularioPago
            idMonitoria={idMonitoria}
            hasta={reservaHasta.toISOString()}
            ahora={ahora.toISOString()}
            idUsuario={idUsuario}
            nombre={pagador.nombre}
            correo={pagador.correo}
          />
        </>
      )}
    </section>
  );
}
