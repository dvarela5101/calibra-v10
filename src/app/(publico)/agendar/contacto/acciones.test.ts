import { beforeEach, describe, expect, it, vi } from "vitest";

// HU-068 tras HU-010: la acción de agendar sigue igual con la pieza común. El enlace de P-23 y la ruta siguiente son la
// misma ruta segura que trae el formulario.

const falsos = vi.hoisted(() => ({ procesar: vi.fn() }));

vi.mock("@/lib/leads/dejar-contacto", () => ({ procesarContacto: (...args: unknown[]) => falsos.procesar(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

import { dejarContacto } from "./acciones";

const VACIO = { error: null, aviso: null, valores: {} };
const conSiguiente = (siguiente: string) => {
  const formulario = new FormData();
  formulario.set("siguiente", siguiente);
  return formulario;
};

beforeEach(() => {
  falsos.procesar.mockReset().mockResolvedValue({ listo: true });
});

describe("dejarContacto (agendar)", () => {
  it("usa la ruta siguiente para el enlace de P-23 y para seguir", async () => {
    await expect(dejarContacto(VACIO, conSiguiente("/agendar/reserva/x?a=1"))).rejects.toThrow("redirect:/agendar/reserva/x?a=1");
    expect(falsos.procesar).toHaveBeenCalledWith(expect.any(FormData), { siguienteDeVerificacion: "/agendar/reserva/x?a=1" });
  });

  it("una ruta de otro sitio se cambia por el inicio", async () => {
    await expect(dejarContacto(VACIO, conSiguiente("https://otro.sitio/robar"))).rejects.toThrow("redirect:/");
    expect(falsos.procesar).toHaveBeenCalledWith(expect.any(FormData), { siguienteDeVerificacion: "/" });
  });

  it("con un error devuelve el estado y no redirige", async () => {
    const estado = { error: "Escribe tu nombre.", aviso: null, valores: {} };
    falsos.procesar.mockResolvedValue(estado);
    await expect(dejarContacto(VACIO, conSiguiente("/agendar"))).resolves.toBe(estado);
  });
});
