// La hora del servidor vista desde el navegador (HU-018), para contar la reserva sin fiarse del reloj del
// teléfono, que puede estar corrido.
//
// El desfase se mide la primera vez que se monta una página pintada con cierto `ahora` y se recuerda mientras
// viva el documento. Next 16 reutiliza la página al volver con Atrás o Adelante y vuelve a montar los
// componentes con el `ahora` viejo: si se midiera otra vez, el tiempo que la persona estuvo fuera contaría
// como desfase y el contador mostraría minutos que ya no quedan.

const desfases = new Map<string, number>();

/**
 * El desfase del reloj del navegador frente al del servidor para la página pintada en `ahora` (ISO), y si esa
 * página ya se había montado antes (`reutilizada`: viene de la caché del router y su estado puede ser viejo).
 */
export function desfaseDelReloj(ahora: string, relojDelNavegador: number = Date.now()): { desfase: number; reutilizada: boolean } {
  const visto = desfases.get(ahora);
  if (visto !== undefined) return { desfase: visto, reutilizada: true };
  const desfase = relojDelNavegador - Date.parse(ahora);
  desfases.set(ahora, desfase);
  return { desfase, reutilizada: false };
}

/** La hora del servidor ahora mismo, según el desfase de la página pintada en `ahora`. */
export function horaDelServidor(ahora: string, relojDelNavegador: number = Date.now()): Date {
  return new Date(relojDelNavegador - desfaseDelReloj(ahora, relojDelNavegador).desfase);
}
