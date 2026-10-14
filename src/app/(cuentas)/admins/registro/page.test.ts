import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatearFechaHora } from "@/lib/fechas";
import RegistroDeAdmin, { metadata } from "./page";

// HU-072 (criterios 5 y 6) sin navegador ni base: la página con la búsqueda de la invitación inventada, y se lee el HTML.
// Qué invitaciones sirven (usada, vencida, cancelada) lo cubre invitaciones.test.ts y la integración; aquí se fija que,
// sin una vigente, no hay formulario ni campos de contraseña, y que con una vigente se ve lo que pide la HU.

const TOKEN = "ab".repeat(32);

const h = vi.hoisted(() => ({ buscar: vi.fn() }));

vi.mock("@/lib/admin/invitaciones", () => ({ buscarInvitacionDeAdmin: h.buscar }));
vi.mock("./acciones", () => ({ registrarse: async () => ({ error: null, invitacionNoSirve: false, valores: {} }) }));

const pintar = async (consulta: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await RegistroDeAdmin({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));

beforeEach(() => {
  h.buscar.mockReset().mockResolvedValue({ vigente: false });
});

describe("la página de registro de un admin sin una invitación vigente (criterio 5)", () => {
  it.each([
    ["sin token", {}],
    ["con un token inventado", { token: "basura" }],
    ["con un token repetido", { token: [TOKEN, TOKEN] }],
    ["con un token que ya no sirve (usado, vencido o cancelado)", { token: TOKEN }],
  ])("%s: no pinta formulario, ni campos de contraseña, y dice que se pida otra invitación", async (_caso, consulta) => {
    const html = await pintar(consulta);
    expect(html).toContain("Necesitas una invitación vigente");
    expect(html).toContain("Pide otra invitación al equipo.");
    expect(html).toContain("ya se usó, venció, se canceló o está incompleto");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Crear mi cuenta");
    expect(html).toContain('href="/ingresar"');
  });

  it("busca la invitación con el token tal como llegó", async () => {
    await pintar({ token: TOKEN });
    expect(h.buscar).toHaveBeenCalledExactlyOnceWith(TOKEN);
    h.buscar.mockClear();
    await pintar({});
    expect(h.buscar).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("no ofrece crear una cuenta de admin en ningún enlace", async () => {
    const enlaces = [...(await pintar({})).matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(enlaces).not.toContain("/admins/registro");
    expect(enlaces.every((e) => ["/", "/ingresar"].includes(e))).toBe(true);
  });
});

describe("la página de registro con una invitación vigente (criterio 6)", () => {
  const VENCE = "2026-10-19T15:00:00.000Z";

  beforeEach(() => {
    h.buscar.mockResolvedValue({ vigente: true, correo: "nuevo@calibra.test", venceEn: VENCE });
  });

  it("muestra el correo como texto, con su etiqueta, y no en un campo que lo corte; y la fecha de vencimiento en hora de Bogotá", async () => {
    const html = await pintar({ token: TOKEN });
    expect(html).toContain("Crea tu cuenta de admin");
    // Un <input> con más de unos 40 caracteres desplaza su texto a 390 px y corta el dominio: va como texto que se parte.
    expect(html).toMatch(/<dt class="[^"]*">Correo<\/dt><dd class="[^"]*">nuevo@calibra\.test<\/dd>/);
    expect(html).not.toContain('id="correo"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("readOnly");
    // El correo es el de la invitación: no viaja en el envío.
    expect(html).not.toMatch(/name="(correo|email)"/);
    const fecha = formatearFechaHora(new Date(VENCE));
    expect(fecha).toMatch(/^lunes, 19 de octubre de 2026, 10:00/);
    // La fecha de la mañana termina en «a. m.»: sin un segundo punto.
    expect(html).toContain(`Esta invitación vence el ${fecha}</p>`);
    expect(html).not.toContain("..");
  });

  it("un correo de 254 caracteres se ve entero, en un solo elemento que el CSS parte donde haga falta", async () => {
    const largo = `${"a".repeat(241)}@calibra.test`;
    expect(largo).toHaveLength(254);
    h.buscar.mockResolvedValue({ vigente: true, correo: largo, venceEn: VENCE });
    const html = await pintar({ token: TOKEN });
    expect(html.match(new RegExp(largo, "g"))).toHaveLength(1);
    expect(html).toContain(`>${largo}</dd>`);
  });

  it("trae el nombre, la contraseña (mínimo 8) y repetirla, con el token escondido y el botón", async () => {
    const html = await pintar({ token: TOKEN });
    expect(html).toContain("Nombre completo");
    expect(html).toContain("Contraseña");
    expect(html).toContain("Mínimo 8 caracteres.");
    expect(html).toContain("Repite la contraseña");
    const campo = (id: string) => new RegExp(`<input id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(campo("nombre")).toContain('name="nombre"');
    expect(campo("contrasena")).toContain('type="password"');
    expect(campo("contrasena")).toContain('name="contrasena"');
    expect(campo("confirmacion")).toContain('type="password"');
    expect(campo("confirmacion")).toContain('name="confirmacion"');
    expect(html).toMatch(new RegExp(`<input type="hidden" name="token" value="${TOKEN}"`));
    expect(html).toContain("Crear mi cuenta");
    // No pide un correo, un teléfono ni una llave: el correo es el de la invitación.
    expect(html).not.toMatch(/name="(correo|numero_telefono|llave)"/);
  });

  it("no lleva ningún texto de monitores", async () => {
    expect(await pintar({ token: TOKEN })).not.toMatch(/monitor/i);
  });
});

describe("los metadatos", () => {
  it("no se indexa ni manda el Referer: la dirección trae un token", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.title).toBe("Crear mi cuenta de admin · Calibra");
  });
});
