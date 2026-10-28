import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";

// D-77 a: el acceso de la landing con la sesión inventada. pruebas/preparacion.ts lo deja vacío para las demás pruebas.

const h = vi.hoisted(() => ({ sesion: vi.fn() }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: h.sesion }));

const { AccesoDeLaPortada } = await vi.importActual<typeof import("./AccesoDeLaPortada")>("./AccesoDeLaPortada");

const pintar = async () => renderToStaticMarkup(await AccesoDeLaPortada());
const enlaces = (html: string) => [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, texto]) => [texto, href]);

beforeEach(() => h.sesion.mockReset());

describe("AccesoDeLaPortada", () => {
  it.each([null, { idUsuario: "u", rol: "anonimo" }])("sin cuenta (%o): solo «Iniciar sesión», que registra su evento", async (sesion) => {
    h.sesion.mockResolvedValue(sesion);
    const html = await pintar();
    expect(html).toMatch(/^<nav aria-label="Tu cuenta"/);
    expect(enlaces(html)).toEqual([["Iniciar sesión", "/ingresar"]]);
    expect(html).toContain('data-evento="clic_iniciar_sesion"');
  });

  it.each<[Rol, string, string]>([
    ["admin", "Mi panel", "/admin"],
    ["monitor", "Mi panel", "/monitor"],
    ["estudiante", "Mis citas", "/cita"],
  ])("con el rol %s, «%s» y sin el evento de iniciar sesión", async (rol, texto, href) => {
    h.sesion.mockResolvedValue({ idUsuario: "u", rol });
    const html = await pintar();
    expect(enlaces(html)).toEqual([[texto, href]]);
    expect(html).not.toContain("data-evento");
  });
});
