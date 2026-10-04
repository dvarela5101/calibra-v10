import { describe, expect, it, vi } from "vitest";
import { crearGuardiaDeEnvio, type AlmacenDeSesion } from "./guardiaDeEnvio";
import type { EstadoFinal, EstadoSesion } from "./sesionAnonima";

/** Una promesa que se resuelve a mano. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

function montar(estadoInicial: EstadoSesion) {
  let estado = estadoInicial;
  const sesion = diferida<EstadoFinal>();
  const almacen = {
    leerEstado: () => estado,
    esperarSesion: vi.fn<() => Promise<EstadoFinal>>(() => sesion.promesa),
    reintentar: vi.fn<() => Promise<EstadoFinal>>(() => sesion.promesa),
  } satisfies AlmacenDeSesion;
  const llamadas: string[] = [];
  const salida = {
    alVerificar: vi.fn<(activa: boolean) => void>((activa) => {
      llamadas.push(`verificar:${activa}`);
    }),
    alAvisar: vi.fn<(visible: boolean) => void>((visible) => {
      llamadas.push(`avisar:${visible}`);
    }),
  };
  const formulario = {
    isConnected: true,
    requestSubmit: vi.fn<() => void>(() => {
      llamadas.push("requestSubmit");
    }),
  };
  const evento = () => ({ preventDefault: vi.fn(), currentTarget: formulario });
  const guardia = crearGuardiaDeEnvio(almacen, salida);
  return {
    almacen,
    salida,
    formulario,
    evento,
    guardia,
    llamadas,
    sesion,
    ponerEstado(nuevo: EstadoSesion) {
      estado = nuevo;
    },
  };
}

/** Deja correr las continuaciones pendientes de las promesas. */
const turno = () => new Promise((resolver) => setTimeout(resolver, 0));

describe("crearGuardiaDeEnvio · alEnviar", () => {
  it("con la sesión lista deja pasar el envío: no lo previene ni espera nada", () => {
    const { guardia, evento, almacen, salida } = montar("lista");
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(almacen.esperarSesion).not.toHaveBeenCalled();
    expect(salida.alVerificar).not.toHaveBeenCalled();
    expect(salida.alAvisar).not.toHaveBeenCalled();
  });

  it("con la sesión naciendo frena el envío, espera y, si nace, lo reenvía", async () => {
    const { guardia, evento, almacen, formulario, llamadas, sesion, ponerEstado } = montar("pendiente");
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(almacen.esperarSesion).toHaveBeenCalledTimes(1);
    expect(llamadas).toEqual(["avisar:false", "verificar:true"]);

    ponerEstado("lista");
    sesion.resolver("lista");
    await turno();
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
    expect(llamadas).toEqual(["avisar:false", "verificar:true", "verificar:false", "requestSubmit"]);
  });

  it("el reenvío pasa por la guardia otra vez y entonces sigue su curso", async () => {
    const { guardia, evento, sesion, ponerEstado, formulario } = montar("pendiente");
    formulario.requestSubmit.mockImplementation(() => {
      // Lo que hace el navegador: requestSubmit() dispara `submit`, que vuelve a llegar a la guardia.
      expect(guardia.alEnviar(evento())).toBe(false);
    });
    guardia.alEnviar(evento());
    ponerEstado("lista");
    sesion.resolver("lista");
    await turno();
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("si la verificación falla no reenvía y muestra el aviso", async () => {
    const { guardia, evento, formulario, llamadas, sesion, ponerEstado } = montar("pendiente");
    guardia.alEnviar(evento());
    ponerEstado("sin_verificacion");
    sesion.resolver("sin_verificacion");
    await turno();
    expect(formulario.requestSubmit).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["avisar:false", "verificar:true", "verificar:false", "avisar:true"]);
  });

  it("con la verificación ya fallida avisa sin reintentar por su cuenta", async () => {
    const { guardia, evento, almacen, llamadas, sesion } = montar("sin_verificacion");
    expect(guardia.alEnviar(evento())).toBe(true);
    sesion.resolver("sin_verificacion");
    await turno();
    expect(almacen.esperarSesion).toHaveBeenCalledTimes(1);
    expect(almacen.reintentar).not.toHaveBeenCalled();
    expect(llamadas.at(-1)).toBe("avisar:true");
  });

  it("un segundo envío mientras espera se frena sin pedir otra espera ni reenviar dos veces", async () => {
    const { guardia, evento, almacen, formulario, sesion, ponerEstado } = montar("pendiente");
    guardia.alEnviar(evento());
    const segundo = evento();
    expect(guardia.alEnviar(segundo)).toBe(true);
    expect(segundo.preventDefault).toHaveBeenCalledTimes(1);
    expect(almacen.esperarSesion).toHaveBeenCalledTimes(1);
    ponerEstado("lista");
    sesion.resolver("lista");
    await turno();
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("si el formulario ya no está en la página al terminar la espera, no lo reenvía", async () => {
    const { guardia, evento, formulario, sesion, ponerEstado } = montar("pendiente");
    guardia.alEnviar(evento());
    formulario.isConnected = false;
    ponerEstado("lista");
    sesion.resolver("lista");
    await turno();
    expect(formulario.requestSubmit).not.toHaveBeenCalled();
  });

  it("un envío nuevo después de un fallo quita el aviso y vuelve a esperar", async () => {
    const { guardia, evento, salida, almacen, sesion } = montar("pendiente");
    guardia.alEnviar(evento());
    sesion.resolver("sin_verificacion");
    await turno();
    expect(salida.alAvisar).toHaveBeenLastCalledWith(true);

    const otra = diferida<EstadoFinal>();
    almacen.esperarSesion.mockReturnValueOnce(otra.promesa);
    expect(guardia.alEnviar(evento())).toBe(true);
    expect(salida.alAvisar).toHaveBeenLastCalledWith(false);
    expect(salida.alVerificar).toHaveBeenLastCalledWith(true);
  });
});

describe("crearGuardiaDeEnvio · reintentar", () => {
  it("pide la sesión de nuevo y, si nace, reenvía el formulario que se había frenado", async () => {
    const { guardia, evento, almacen, formulario, sesion, ponerEstado } = montar("pendiente");
    guardia.alEnviar(evento());
    sesion.resolver("sin_verificacion");
    await turno();
    expect(formulario.requestSubmit).not.toHaveBeenCalled();

    const segunda = diferida<EstadoFinal>();
    almacen.reintentar.mockReturnValueOnce(segunda.promesa);
    guardia.reintentar();
    expect(almacen.reintentar).toHaveBeenCalledTimes(1);
    ponerEstado("lista");
    segunda.resolver("lista");
    await turno();
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("si vuelve a fallar, muestra el aviso otra vez", async () => {
    const { guardia, evento, almacen, salida, sesion } = montar("pendiente");
    guardia.alEnviar(evento());
    sesion.resolver("sin_verificacion");
    await turno();

    const segunda = diferida<EstadoFinal>();
    almacen.reintentar.mockReturnValueOnce(segunda.promesa);
    guardia.reintentar();
    expect(salida.alAvisar).toHaveBeenLastCalledWith(false);
    expect(salida.alVerificar).toHaveBeenLastCalledWith(true);
    segunda.resolver("sin_verificacion");
    await turno();
    expect(salida.alVerificar).toHaveBeenLastCalledWith(false);
    expect(salida.alAvisar).toHaveBeenLastCalledWith(true);
  });

  it("mientras ya espera, otro clic no pide otra solicitud", () => {
    const { guardia, evento, almacen } = montar("pendiente");
    guardia.alEnviar(evento());
    guardia.reintentar();
    expect(almacen.reintentar).not.toHaveBeenCalled();
  });
});
