"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describirTiempoRestante } from "@/lib/plazos/restante";
import estilos from "./pago.module.css";
import { desfaseDelReloj, horaDelServidor } from "./relojDelServidor";

const CADA_MS = 15_000;

type Props = {
  /** Hasta cuándo queda apartada la reserva (`reserva_hasta`, ISO). */
  hasta: string;
  /** La hora del servidor al pintar la página (ISO). */
  ahora: string;
  /** Lo que dijo el servidor (`describirTiempoRestante`): es lo primero que se pinta, así la hidratación no choca. */
  textoInicial: string;
};

/**
 * Cuánto le queda a la reserva para enviar el comprobante (HU-018, criterio 1; RN-34). Mira apenas se monta
 * y después cada 15 s. Cuenta con la hora del servidor y no con la del teléfono, que puede estar corrida
 * (`relojDelServidor`). Al vencer, vuelve a pedir la página, que entonces dice que la reserva expiró y ya no
 * trae el formulario (la base rechaza igual un comprobante tardío). Si la página volvió de la caché del router
 * (Atrás o Adelante), también la pide de nuevo: su estado es el de cuando se pintó.
 */
export function TiempoRestante({ hasta, ahora, textoInicial }: Props) {
  const router = useRouter();
  const [texto, setTexto] = useState(textoInicial);
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    const limite = new Date(hasta);
    if (desfaseDelReloj(ahora).reutilizada) router.refresh();
    const mirar = () => {
      const restante = describirTiempoRestante(limite, horaDelServidor(ahora));
      if (!restante.vencido) return setTexto(restante.texto);
      clearInterval(reloj);
      setVencida(true);
      router.refresh();
    };
    // La primera mirada va en un temporizador y no directo en el efecto, para no cambiar el estado mientras
    // React monta; así una página que llega ya vencida se corrige enseguida y no a los 15 s.
    const primera = setTimeout(mirar, 0);
    const reloj = setInterval(mirar, CADA_MS);
    return () => {
      clearTimeout(primera);
      clearInterval(reloj);
    };
  }, [hasta, ahora, router]);

  // role="timer" no se anuncia solo (aria-live apagado): nadie quiere oír la cuenta cada 15 s.
  return (
    <p role="timer" className={estilos.tiempo}>
      {vencida ? "Tu reserva venció." : `${texto} para enviar el comprobante.`}
    </p>
  );
}
