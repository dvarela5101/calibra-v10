import { beforeEach, describe, expect, it, vi } from "vitest";

// HU-010: la acción del resultado, sin base. `procesarContacto` (la pieza común con HU-068) es inventada; `redirect` lanza,
// como en Next. Se fija a dónde lleva el enlace de P-23 (D-68 c) y a dónde vuelve quien ya quedó como Lead.

const falsos = vi.hoisted(() => ({ procesar: vi.fn() }));

vi.mock("@/lib/leads/dejar-contacto", () => ({ procesarContacto: (...args: unknown[]) => falsos.procesar(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

import { dejarContactoDelDiagnostico } from "./acciones";

const ID = "5e000000-0000-4000-8000-0000000000aa";
const VACIO = { error: null, aviso: null, valores: {} };

const datos = (idDiagnostico: string) => {
  const formulario = new FormData();
  formulario.set("id_diagnostico", idDiagnostico);
  formulario.set("nombre", "Ana");
  return formulario;
};

beforeEach(() => {
  falsos.procesar.mockReset().mockResolvedValue({ listo: true });
});

describe("dejarContactoDelDiagnostico", () => {
  it("el enlace de verificación de P-23 lleva a /agendar, no al resultado (D-68 c)", async () => {
    await expect(dejarContactoDelDiagnostico(VACIO, datos(ID))).rejects.toThrow();
    expect(falsos.procesar).toHaveBeenCalledWith(expect.any(FormData), { siguienteDeVerificacion: "/agendar" });
  });

  it("si ya quedó como Lead, vuelve a su resultado", async () => {
    await expect(dejarContactoDelDiagnostico(VACIO, datos(ID))).rejects.toThrow(`redirect:/diagnostico/resultado/${ID}`);
  });

  it.each(["", "no-es-un-uuid", "../admin", `${ID}/x`])("con un id que no es UUID (%j) no arma la ruta: va a /agendar", async (id) => {
    await expect(dejarContactoDelDiagnostico(VACIO, datos(id))).rejects.toThrow("redirect:/agendar");
  });

  it("con un error o el aviso de P-23 devuelve el estado tal cual y no redirige", async () => {
    const estado = { error: null, aviso: "Ese correo ya está en Calibra.", valores: { nombre: "Ana" } };
    falsos.procesar.mockResolvedValue(estado);
    await expect(dejarContactoDelDiagnostico(VACIO, datos(ID))).resolves.toBe(estado);
  });
});
