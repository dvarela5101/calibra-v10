import { formatearPesos } from "@/lib/moneda";
import estilos from "./precio-con-oferta.module.css";

/**
 * HU-119 (D-85 b): el precio de una franja de oferta, tal como lo ve el estudiante desde el listado: una etiqueta «Oferta · 100 %
 * de descuento», el precio normal tachado y «Gratis» en verde. La palabra «prueba» es del admin y nunca sale aquí. El tachado
 * es la raya y no el color, y el lector de pantalla oye «Precio normal».
 */
export function PrecioConOferta({ precio }: { precio: number }) {
  return (
    <span className={estilos.oferta}>
      <span className={estilos.etiqueta}>Oferta · 100 % de descuento</span>{" "}
      <del className={estilos.normal}>
        <span className={estilos.oculto}>Precio normal: </span>
        {formatearPesos(precio)}
      </del>{" "}
      <span className={estilos.gratis}>Gratis</span>
    </span>
  );
}
