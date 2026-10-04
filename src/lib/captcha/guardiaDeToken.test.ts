import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearEsperaDeToken } from "./esperaDeToken";
import { crearGuardiaDeToken } from "./guardiaDeToken";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function montar() {
  const espera = crearEsperaDeToken(1000);
  const alVerificar = vi.fn<(activa: boolean) => void>();
  const guardia = crearGuardiaDeToken(espera, alVerificar);
  const formulario = { isConnected: true, requestSubmit: vi.fn<() => void>() };
  // Lo que hace el navegador: requestSubmit() dispara `submit`, que vuelve a llegar a la guardia, y deja el resultado.
  const reenvios: boolean[] = [];
  formulario.requestSubmit.mockImplementation(() => {
    reenvios.push(guardia.alEnviar(evento()));
  });
  function evento() {
    return { preventDefault: vi.fn<() => void>(), currentTarget: formulario };
  }
  return { espera, alVerificar, guardia, formulario, evento, reenvios };
}

describe("crearGuardiaDeToken", () => {
  it("con el token ya en el campo deja pasar el envío sin esperar", () => {
    const { espera, guardia, evento, alVerificar } = montar();
    espera.poner("t");
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(alVerificar).not.toHaveBeenCalled();
  });

  it("con el widget caído deja pasar el envío sin esperar los 20 s", () => {
    const { espera, guardia, evento, alVerificar } = montar();
    espera.fallar();
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(alVerificar).not.toHaveBeenCalled();
  });

  it("sin token todavía frena el envío, espera y lo reenvía cuando llega", async () => {
    const { espera, guardia, evento, alVerificar, formulario, reenvios } = montar();
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(alVerificar).toHaveBeenLastCalledWith(true);
    expect(formulario.requestSubmit).not.toHaveBeenCalled();

    espera.poner("t");
    await vi.advanceTimersByTimeAsync(0);
    expect(alVerificar).toHaveBeenLastCalledWith(false);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
    // El reenvío pasó por la guardia y siguió su curso (el campo ya tenía el token).
    expect(reenvios).toEqual([false]);
  });

  it("si el token no llega en el plazo, el reenvío sale sin token", async () => {
    const { guardia, evento, alVerificar, formulario, reenvios } = montar();
    guardia.alEnviar(evento());
    await vi.advanceTimersByTimeAsync(999);
    expect(formulario.requestSubmit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(alVerificar).toHaveBeenLastCalledWith(false);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
    expect(reenvios).toEqual([false]);
  });

  it("si el widget falla mientras espera, reenvía sin token de inmediato", async () => {
    const { espera, guardia, evento, formulario, reenvios } = montar();
    guardia.alEnviar(evento());
    espera.fallar();
    await vi.advanceTimersByTimeAsync(0);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
    expect(reenvios).toEqual([false]);
  });

  it("la bandera de dejar pasar vale solo para ese reenvío", async () => {
    const { espera, guardia, evento, formulario } = montar();
    guardia.alEnviar(evento());
    await vi.advanceTimersByTimeAsync(1000);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
    // Un envío nuevo, sin token y sin fallo, vuelve a esperar.
    expect(espera.hayFallo()).toBe(false);
    const otro = evento();
    expect(guardia.alEnviar(otro)).toBe(true);
    expect(otro.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("un segundo envío mientras espera se frena sin reenviar dos veces", async () => {
    const { espera, guardia, evento, alVerificar, formulario } = montar();
    guardia.alEnviar(evento());
    const segundo = evento();
    expect(guardia.alEnviar(segundo)).toBe(true);
    expect(segundo.preventDefault).toHaveBeenCalledTimes(1);
    expect(alVerificar).toHaveBeenCalledTimes(1);
    espera.poner("t");
    await vi.advanceTimersByTimeAsync(0);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("si el formulario ya no está en la página al llegar el token, no lo reenvía", async () => {
    const { espera, guardia, evento, formulario } = montar();
    guardia.alEnviar(evento());
    formulario.isConnected = false;
    espera.poner("t");
    await vi.advanceTimersByTimeAsync(0);
    expect(formulario.requestSubmit).not.toHaveBeenCalled();
  });

  it("tras gastar el token, el siguiente envío vuelve a esperar el nuevo", async () => {
    const { espera, guardia, evento, formulario } = montar();
    espera.poner("viejo");
    expect(guardia.alEnviar(evento())).toBe(false);
    // La acción terminó: el token se gastó y se pidió otro.
    espera.vaciar();
    const e = evento();
    expect(guardia.alEnviar(e)).toBe(true);
    espera.poner("nuevo");
    await vi.advanceTimersByTimeAsync(0);
    expect(formulario.requestSubmit).toHaveBeenCalledTimes(1);
  });
});
