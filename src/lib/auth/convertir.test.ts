import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { convertirAnonimoEnCuenta } from "./convertir";

describe("convertirAnonimoEnCuenta", () => {
  it("rechaza una contraseña corta sin tocar la cuenta", async () => {
    const sinLlamadas = {
      auth: new Proxy({}, { get: () => () => Promise.reject(new Error("no debía llamar a Supabase")) }),
    } as unknown as SupabaseClient;

    const resultado = await convertirAnonimoEnCuenta(sinLlamadas, { correo: "a@calibra.test", contrasena: "1234567" });
    expect(resultado).toEqual({ ok: false, codigo: "weak_password" });
  });
});
