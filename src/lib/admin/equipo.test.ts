import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { reactivarAdmin } from "./equipo";

// HU-072 (criterio 13, D-64 a) sin base ni Auth: `reactivarAdmin` con el equipo que ve la sesión y Auth inventados. Se fija
// el orden (primero el equipo, solo después Auth) y que nada toque Auth si no se puede reactivar. Que la cuenta de verdad
// vuelva a entrar lo cubre la integración (integracion/invitaciones-admin.test.ts).

const h = vi.hoisted(() => ({ reactivarCuenta: vi.fn(), eventos: [] as string[] }));

vi.mock("@/lib/auth/cuentas", () => ({ reactivarCuenta: h.reactivarCuenta, desactivarCuenta: vi.fn() }));

const fila = (id: string, nombre: string, orden: number, activo: boolean) => ({
  id,
  nombre,
  correo: `${id}@calibra.test`,
  orden_revision: orden,
  activo,
  casos_abiertos: 0,
});

/** El cliente de la sesión: `equipo_de_admins()` devuelve lo que ve esa sesión (vacío si no es un admin activo). */
const cliente = (equipo: ReturnType<typeof fila>[]) =>
  ({
    rpc: vi.fn(async (nombre: string) => {
      h.eventos.push(`rpc:${nombre}`);
      return { data: equipo, error: null };
    }),
  }) as unknown as SupabaseClient<Database>;

const EQUIPO = [fila("a", "Ana", 1, true), fila("b", "Beatriz", 2, false), fila("c", "Carlos", 3, true)];

beforeEach(() => {
  h.eventos = [];
  h.reactivarCuenta.mockReset().mockImplementation(async (id: string) => {
    h.eventos.push(`auth:${id}`);
  });
});

describe("reactivarAdmin", () => {
  it("a un desactivado le quita el baneo, y primero carga el equipo con la sesión", async () => {
    expect(await reactivarAdmin(cliente(EQUIPO), "b")).toEqual({ ok: true, nombre: "Beatriz" });
    expect(h.reactivarCuenta).toHaveBeenCalledExactlyOnceWith("b");
    expect(h.eventos).toEqual(["rpc:equipo_de_admins", "auth:b"]);
  });

  it("a un admin activo no lo toca: ya_activo", async () => {
    expect(await reactivarAdmin(cliente(EQUIPO), "a")).toEqual({ ok: false, motivo: "ya_activo" });
    expect(h.reactivarCuenta).not.toHaveBeenCalled();
  });

  it("a quien no está en el equipo no lo toca: no_encontrado", async () => {
    expect(await reactivarAdmin(cliente(EQUIPO), "otro")).toEqual({ ok: false, motivo: "no_encontrado" });
    expect(h.reactivarCuenta).not.toHaveBeenCalled();
  });

  it("con la sesión de quien no es un admin activo (el equipo le llega vacío) no toca Auth aunque el id sea el de un desactivado", async () => {
    expect(await reactivarAdmin(cliente([]), "b")).toEqual({ ok: false, motivo: "no_encontrado" });
    expect(h.reactivarCuenta).not.toHaveBeenCalled();
  });

  it("si no se puede leer el equipo, lanza y no toca Auth", async () => {
    const roto = { rpc: vi.fn(async () => ({ data: null, error: { message: "caída" } })) } as unknown as SupabaseClient<Database>;
    await expect(reactivarAdmin(roto, "b")).rejects.toThrow("caída");
    expect(h.reactivarCuenta).not.toHaveBeenCalled();
  });

  it("si Auth falla, el error sube: la acción vuelve con «No pudimos guardar el cambio»", async () => {
    h.reactivarCuenta.mockRejectedValue(new Error("Auth caído"));
    await expect(reactivarAdmin(cliente(EQUIPO), "b")).rejects.toThrow("Auth caído");
  });
});
