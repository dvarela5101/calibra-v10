import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { TEXTOS } from "@/lib/cuentas/reglas";
import ElegirContrasena, { metadata } from "./page";

// Sin navegador ni base: la página de «Elige tu contraseña» con la sesión inventada. Aquí se fija que solo la ve un
// Estudiante (una sesión anónima, sin sesión, sin rol o del equipo va a /cuenta/crear sin ver el formulario) y qué trae:
// dos campos, el botón de guardar y «Elegir después» con su nota. Guardar de verdad lo cubren la integración y la e2e.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
// Las acciones viven en el servidor y los formularios son del navegador: aquí solo se pintan.
vi.mock("./acciones", () => ({ guardarContrasenaDeCuenta: async () => ({ error: null }), elegirDespues: async () => {} }));
vi.mock("../../restablecer/nueva/acciones", () => ({ guardarContrasena: async () => ({ error: null }) }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const pintar = async () => renderToStaticMarkup(await ElegirContrasena());

const texto = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  sesion.actual = null;
});

describe("/cuenta/contrasena", () => {
  it("no queda en buscadores", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("solo un Estudiante la ve: sin sesión, anónima, sin rol, monitor o admin van a /cuenta/crear, sin formulario", async () => {
    const casos: ({ idUsuario: string; rol: Rol | null } | null)[] = [
      null,
      { idUsuario: "u", rol: "anonimo" },
      { idUsuario: "u", rol: null },
      { idUsuario: "u", rol: "monitor" },
      { idUsuario: "u", rol: "admin" },
    ];
    for (const actual of casos) {
      sesion.actual = actual;
      await expect(pintar(), String(actual?.rol)).rejects.toThrow(new Error("redirect:/cuenta/crear"));
    }
  });

  it("a un Estudiante le muestra «Elige tu contraseña» con los dos campos, el botón de guardar y «Elegir después»", async () => {
    sesion.actual = { idUsuario: "5a5a5a5a-0000-4000-8000-000000000032", rol: "estudiante" };
    const html = await pintar();

    expect(texto(html)).toContain("Elige tu contraseña");
    expect(texto(html)).toContain(TEXTOS.contrasena);
    expect(html).toMatch(/<label[^>]*for="contrasena"[^>]*>Nueva contraseña<\/label>/);
    expect(html).toMatch(/<label[^>]*for="confirmacion"[^>]*>Repite la contraseña<\/label>/);
    expect(html).toMatch(/<input[^>]*id="contrasena"[^>]*type="password"|<input[^>]*type="password"[^>]*id="contrasena"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Guardar contraseña<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Elegir después<\/button>/);
    expect(texto(html)).toContain(TEXTOS.elegirDespuesNota);
    expect(html.match(/<form/g)).toHaveLength(2);
  });

  it("los dos campos exigen 8 caracteres y no son visibles como texto", async () => {
    sesion.actual = { idUsuario: "5a5a5a5a-0000-4000-8000-000000000032", rol: "estudiante" };
    const html = await pintar();

    expect(html.match(/minLength="8"/g)).toHaveLength(2);
    expect(html.match(/type="password"/g)).toHaveLength(2);
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
  });
});
