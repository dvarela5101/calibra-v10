import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { CONTRASENA_MINIMA, ponerContrasena, vincularCorreo } from "./convertir";

/** Un cliente que responde lo que se le dice a `updateUser` y cuenta cuántas veces se llamó. */
function clienteConUpdateUser(respuesta: { data?: { user: { is_anonymous?: boolean } | null }; error?: { code?: string } | null }) {
  const updateUser = vi.fn(async () => ({ data: respuesta.data ?? { user: null }, error: respuesta.error ?? null }));
  return { cliente: { auth: { updateUser } } as unknown as SupabaseClient, updateUser };
}

describe("vincularCorreo (HU-032)", () => {
  it("pide el cambio de correo con el correo recibido y, si el usuario sigue anónimo, da ok", async () => {
    const { cliente, updateUser } = clienteConUpdateUser({ data: { user: { is_anonymous: true } } });

    expect(await vincularCorreo(cliente, "ana@calibra.test")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ email: "ana@calibra.test" });
  });

  it("devuelve el código de Auth tal cual, o «desconocido» si no trae uno", async () => {
    expect(await vincularCorreo(clienteConUpdateUser({ error: { code: "email_exists" } }).cliente, "a@calibra.test")).toEqual({
      ok: false,
      codigo: "email_exists",
    });
    expect(await vincularCorreo(clienteConUpdateUser({ error: {} }).cliente, "a@calibra.test")).toEqual({ ok: false, codigo: "desconocido" });
  });

  it("si Auth ya lo dejó de ser anónimo, el correo se cambió sin confirmar: lo trata como un fallo", async () => {
    const { cliente } = clienteConUpdateUser({ data: { user: { is_anonymous: false } } });

    expect(await vincularCorreo(cliente, "ana@calibra.test")).toEqual({ ok: false, codigo: "correo_sin_confirmar" });
  });
});

describe("ponerContrasena (HU-032)", () => {
  it("rechaza una contraseña de 7 caracteres sin llamar a Auth", async () => {
    const { cliente, updateUser } = clienteConUpdateUser({});

    expect(await ponerContrasena(cliente, "1234567")).toEqual({ ok: false, codigo: "weak_password" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("acepta una de 8 y la manda como contraseña", async () => {
    const { cliente, updateUser } = clienteConUpdateUser({});

    expect(CONTRASENA_MINIMA).toBe(8);
    expect(await ponerContrasena(cliente, "12345678")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: "12345678" });
  });

  it("devuelve el código de Auth si no la acepta", async () => {
    expect(await ponerContrasena(clienteConUpdateUser({ error: { code: "same_password" } }).cliente, "12345678")).toEqual({
      ok: false,
      codigo: "same_password",
    });
  });

  it("no cierra ni refresca la sesión: solo llama a updateUser", async () => {
    const auth = new Proxy(
      { updateUser: vi.fn(async () => ({ data: { user: null }, error: null })) } as Record<string, unknown>,
      { get: (destino, nombre: string) => destino[nombre] ?? (() => Promise.reject(new Error(`no debía llamar a auth.${nombre}`))) },
    );

    expect(await ponerContrasena({ auth } as unknown as SupabaseClient, "12345678")).toEqual({ ok: true });
  });
});
