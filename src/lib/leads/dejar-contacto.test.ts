import { beforeEach, describe, expect, it, vi } from "vitest";
import { CASILLA_TRATAMIENTO, ERROR_SIN_AUTORIZACION, MARCADA } from "@/lib/privacidad/consentimiento";

// HU-010: la pieza común de agendar (HU-068) y del resultado del diagnóstico, sin base. La sesión, la cookie de campaña y
// `registrarContacto` son inventados; lo que se fija es qué ve el formulario en cada caso y qué recibe `registrarContacto`.

const falsos = vi.hoisted(() => ({
  sesion: null as { idUsuario: string; rol: string | null } | null,
  origen: undefined as string | undefined,
  registrar: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => falsos.sesion }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (falsos.origen === undefined ? undefined : { value: falsos.origen }) }),
}));
vi.mock("@/lib/leads/servidor", () => ({ registrarContacto: (...args: unknown[]) => falsos.registrar(...args) }));

import { procesarContacto } from "./dejar-contacto";

const SESION = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" };
const DESTINO = { siguienteDeVerificacion: "/agendar" };

function formulario(campos: Record<string, string> = {}): FormData {
  const datos = new FormData();
  const todos = { nombre: "Ana Pérez", correo: "ana@calibra.test", numero_telefono: "", [CASILLA_TRATAMIENTO]: MARCADA, ...campos };
  for (const [nombre, valor] of Object.entries(todos)) if (valor !== "") datos.set(nombre, valor);
  return datos;
}

beforeEach(() => {
  falsos.sesion = SESION;
  falsos.origen = undefined;
  falsos.registrar.mockReset().mockResolvedValue({ resultado: "lead" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("procesarContacto", () => {
  it("deja a la sesión como Lead con la campaña de la cookie y el destino del enlace de P-23", async () => {
    falsos.origen = "feria-2026";
    await expect(procesarContacto(formulario(), DESTINO)).resolves.toEqual({ listo: true });
    expect(falsos.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        idSesion: SESION.idUsuario,
        contacto: expect.objectContaining({ nombre: "Ana Pérez", correo: "ana@calibra.test" }),
        origen: "feria-2026",
        siguiente: "/agendar",
      }),
    );
  });

  it("sin sesión no guarda nada y pide recargar", async () => {
    falsos.sesion = null;
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("Recarga la página") });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"])("con una cuenta del equipo (%s) no guarda nada", async (rol) => {
    falsos.sesion = { ...SESION, rol };
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("cuenta del equipo") });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("sin nombre o con un correo inválido no guarda nada y conserva lo escrito", async () => {
    expect(await procesarContacto(formulario({ nombre: "" }), DESTINO)).toMatchObject({ error: "Escribe tu nombre." });
    const estado = await procesarContacto(formulario({ correo: "no-es-un-correo" }), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("correo válido"), valores: { correo: "no-es-un-correo" } });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("sin la autorización no guarda nada (criterio 6)", async () => {
    const estado = await procesarContacto(formulario({ [CASILLA_TRATAMIENTO]: "" }), DESTINO);
    expect(estado).toMatchObject({ error: ERROR_SIN_AUTORIZACION });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it.each([
    ["enviado", "te llega un enlace para confirmarlo"],
    ["frenado", "ya le mandamos varios enlaces"],
    ["fallido", "no pudimos mandarte el enlace"],
  ])("con un correo de otro Lead (P-23, %s) avisa sin error y conserva lo escrito", async (envio, texto) => {
    falsos.registrar.mockResolvedValue({ resultado: "verificar", envio });
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: null, aviso: expect.stringContaining(texto), valores: { nombre: "Ana Pérez" } });
  });

  it("muestra el error que devuelve registrarContacto (el tope de correos de HU-075, por ejemplo)", async () => {
    falsos.registrar.mockResolvedValue({ resultado: "error", error: "Probaste varios correos seguidos." });
    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({ error: "Probaste varios correos seguidos." });
  });

  it("si registrarContacto falla, pide intentar de nuevo y deja el error en el log", async () => {
    falsos.registrar.mockRejectedValue(new Error("caída"));
    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({ error: "No pudimos guardar tus datos. Intenta de nuevo." });
    expect(console.error).toHaveBeenCalled();
  });
});
