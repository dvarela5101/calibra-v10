import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";

// D-75 a: el acceso de la cabecera con la sesión inventada. pruebas/preparacion.ts lo deja vacío para las demás pruebas.

const h = vi.hoisted(() => ({ sesion: vi.fn() }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: h.sesion }));

const { AccesoDeCabecera } = await vi.importActual<typeof import("./AccesoDeCabecera")>("./AccesoDeCabecera");

const pintar = async () => renderToStaticMarkup(await AccesoDeCabecera());
const enlaces = (html: string) => [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, texto]) => [texto, href]);

beforeEach(() => h.sesion.mockReset());

describe("AccesoDeCabecera", () => {
  it("sin sesión: «Iniciar sesión» y «Registrarse», dentro de la navegación «Tu cuenta»", async () => {
    h.sesion.mockResolvedValue(null);
    const html = await pintar();
    expect(html).toMatch(/^<nav aria-label="Tu cuenta"/);
    expect(enlaces(html)).toEqual([
      ["Iniciar sesión", "/ingresar"],
      ["Registrarse", "/registrarse"],
    ]);
  });

  it.each<[Rol, string, string]>([
    ["anonimo", "Registrarse", "/registrarse"],
    ["admin", "Mi panel", "/admin"],
    ["monitor", "Mi panel", "/monitor"],
    ["estudiante", "Mis citas", "/cita"],
  ])("con el rol %s el último enlace es «%s»", async (rol, texto, href) => {
    h.sesion.mockResolvedValue({ idUsuario: "u", rol });
    expect(enlaces(await pintar()).at(-1)).toEqual([texto, href]);
  });
});
