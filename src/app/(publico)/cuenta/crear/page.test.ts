import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { TEXTOS } from "@/lib/cuentas/reglas";
import type { LeadDeSesion } from "@/lib/leads/servidor";
import CrearCuenta, { metadata } from "./page";

// Sin navegador ni base: la página de /cuenta/crear con la sesión, el Lead y la cuenta inventados. Aquí se fija qué
// pantalla ve cada quien (la tabla de 4.2 de la HU), con su texto, sus enlaces exactos y a lo sumo un aviso con rol; que
// la página solo lee la base cuando hay una sesión que puede tener Lead; y que no queda en buscadores. Con Auth y la base
// de verdad lo cubren integracion/cuenta-estudiante.test.ts y e2e/cuenta.spec.ts.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const base = vi.hoisted(() => ({
  lead: null as LeadDeSesion | null,
  tieneCuenta: false,
  leerLead: vi.fn(),
  leerCuenta: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/leads/servidor", () => ({
  leadDeLaSesion: async (id: string) => {
    base.leerLead(id);
    return base.lead;
  },
}));
vi.mock("@/lib/cuentas/servidor", () => ({
  leadTieneCuenta: async (id: string) => {
    base.leerCuenta(id);
    return base.tieneCuenta;
  },
}));
// Las acciones viven en el servidor y los formularios son del navegador: aquí solo se pintan.
vi.mock("./acciones", () => ({
  pedirCuenta: async () => ({ error: null, aviso: null, valores: {} }),
  terminarCuenta: async () => ({ error: null }),
}));
vi.mock("../../agendar/contacto/acciones", () => ({ dejarContacto: async () => ({ error: null, aviso: null, valores: {} }) }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
  unstable_rethrow: () => {},
}));

const ID_SESION = "5a5a5a5a-0000-4000-8000-000000000032";
const LEAD: LeadDeSesion = { id: "1e1e1e1e-0000-4000-8000-000000000032", nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null };

const como = (rol: Rol | null) => {
  sesion.actual = { idUsuario: ID_SESION, rol };
};

async function pintar(siguiente?: string, extra: Record<string, string | string[]> = {}): Promise<string> {
  const consulta = { ...(siguiente === undefined ? {} : { siguiente }), ...extra };
  return renderToStaticMarkup(await CrearCuenta({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Los destinos de los enlaces, ya desescapados. */
const enlaces = (html: string) => [...html.matchAll(/<a[^>]*href="([^"]*)"/g)].map((coincidencia) => coincidencia[1].replaceAll("&amp;", "&"));

/** Los enlaces con su texto: «destino → texto». */
const enlacesConTexto = (html: string) =>
  [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (coincidencia) => `${coincidencia[1].replaceAll("&amp;", "&")} → ${coincidencia[2].replace(/<[^>]+>/g, "").trim()}`,
  );

const avisosConRol = (html: string) => (html.match(/role="(?:status|alert)"/g) ?? []).length;

/** Quien va a la portada de ingresar con esta ruta de regreso. */
const INGRESAR = "Inicia sesión";

beforeEach(() => {
  sesion.actual = null;
  base.lead = null;
  base.tieneCuenta = false;
  base.leerLead.mockReset();
  base.leerCuenta.mockReset();
});

describe("/cuenta/crear: lo que no se filtra", () => {
  it("no queda en buscadores: muestra el nombre y el correo de la persona", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe("Crea tu cuenta · Calibra");
  });
});

describe("/cuenta/crear: estudiante, equipo y quienes no necesitan la base", () => {
  it("un Estudiante va a «Mis citas», sin formulario y sin leer la base", async () => {
    como("estudiante");
    base.lead = LEAD;

    await expect(pintar()).rejects.toThrow(new Error("redirect:/cita"));
    expect(base.leerLead).not.toHaveBeenCalled();
    expect(base.leerCuenta).not.toHaveBeenCalled();
  });

  it("un monitor o un admin ve que está en su cuenta del equipo, con el enlace a su panel y sin formulario ni lectura de la base", async () => {
    for (const [rol, panel] of [
      ["monitor", "/monitor"],
      ["admin", "/admin"],
    ] as const) {
      como(rol);
      const html = await pintar();

      expect(texto(html), rol).toContain("Estás en tu cuenta del equipo");
      expect(texto(html), rol).toContain(TEXTOS.equipo);
      expect(html, rol).not.toContain("<form");
      expect(html, rol).not.toContain("<button");
      expect(enlaces(html), rol).toContain(panel);
    }
    expect(base.leerLead).not.toHaveBeenCalled();
  });
});

describe("/cuenta/crear: sin Lead, el formulario de contacto", () => {
  it("sin sesión todavía (la anónima nace en el navegador): el formulario, sin leer la base", async () => {
    const html = await pintar();

    expect(texto(html)).toContain("Crea tu cuenta");
    expect(texto(html)).toContain(TEXTOS.crearContacto);
    expect(texto(html)).toContain("Ahí te llega el correo para confirmar tu cuenta.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear mi cuenta<\/button>/);
    for (const campo of ["nombre", "correo", "numero_telefono"]) expect(html).toContain(`name="${campo}"`);
    // Las dos casillas de autorización (HU-068): la de tratamiento, obligatoria, y la de novedades.
    expect(html).toContain('name="acepta_tratamiento_datos"');
    expect(html).toContain('name="acepta_contacto"');
    expect(html).not.toContain("readOnly");
    expect(base.leerLead).not.toHaveBeenCalled();
  });

  it("una sesión anónima sin Lead: el mismo formulario, y trae «¿Ya tienes cuenta? Inicia sesión» a /ingresar", async () => {
    como("anonimo");
    const html = await pintar();

    expect(html).toContain('name="nombre"');
    expect(enlacesConTexto(html)).toContain(`/ingresar → ¿Ya tienes cuenta? ${INGRESAR}`);
    expect(base.leerLead).toHaveBeenCalledWith(ID_SESION);
  });

  it("lleva la ruta de regreso en un campo oculto y en el enlace de ingresar", async () => {
    como("anonimo");
    const html = await pintar("/privacidad");

    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="siguiente"[^>]*value="\/privacidad"/);
    expect(enlaces(html)).toContain("/ingresar?siguiente=%2Fprivacidad");
  });

  it("una ruta externa o mal formada se ignora", async () => {
    como("anonimo");
    for (const externa of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/\\otro"]) {
      const html = await pintar(externa);
      expect(html, externa).toMatch(/<input[^>]*name="siguiente"[^>]*value="\/"/);
      expect(enlaces(html), externa).toContain("/ingresar");
      expect(html, externa).not.toContain("otro.sitio");
    }
  });

  it("no hay avisos con rol hasta que se envía algo", async () => {
    como("anonimo");
    expect(avisosConRol(await pintar())).toBe(0);
  });
});

describe("/cuenta/crear: con Lead", () => {
  beforeEach(() => {
    como("anonimo");
    base.lead = LEAD;
  });

  it("el resumen: nombre y correo como texto, sin campos, «Cambiar mis datos» y «Crear mi cuenta», y sin contraseña", async () => {
    const html = await pintar();

    expect(texto(html)).toContain(TEXTOS.resumen);
    expect(texto(html)).toContain("Nombre Camila Rojas");
    expect(texto(html)).toContain("Correo camila@uniandes.edu.co");
    expect(html).not.toContain("<input type=\"text\"");
    for (const campo of ['name="nombre"', 'name="correo"', 'type="password"', 'name="contrasena"']) expect(html).not.toContain(campo);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear mi cuenta<\/button>/);
    expect(base.leerCuenta).toHaveBeenCalledWith(LEAD.id);
  });

  it("con ?enviado=1 (acaba de dejar su contacto y pedir la cuenta) el resumen ya trae el aviso de que el correo salió, uno solo", async () => {
    const html = await pintar(undefined, { enviado: "1" });

    expect(texto(html)).toContain(`Listo. Si ${LEAD.correo} puede crear una cuenta, te llega un correo para confirmarla.`);
    expect(avisosConRol(html)).toBe(1);
    expect(html).toMatch(/<p[^>]*role="status"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear mi cuenta<\/button>/);
  });

  it("sin ?enviado=1, o con otro valor o repetido, no hay aviso", async () => {
    const casos: Record<string, string | string[]>[] = [{}, { enviado: "0" }, { enviado: "si" }, { enviado: ["1", "1"] }];
    for (const extra of casos) {
      expect(avisosConRol(await pintar(undefined, extra)), JSON.stringify(extra)).toBe(0);
    }
  });

  it("?enviado=1 sin Lead no dice nada del correo: el formulario de contacto sigue igual", async () => {
    base.lead = null;
    const html = await pintar(undefined, { enviado: "1" });

    expect(texto(html)).not.toContain("puede crear una cuenta");
    expect(html).toContain('name="nombre"');
  });

  it("«Cambiar mis datos» va a la edición del contacto con regreso a /cuenta/crear (con su ruta, codificada una sola vez)", async () => {
    expect(enlacesConTexto(await pintar())).toContain(
      `/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear")} → Cambiar mis datos`,
    );
    expect(enlacesConTexto(await pintar("/privacidad"))).toContain(
      `/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear?siguiente=%2Fprivacidad")} → Cambiar mis datos`,
    );
  });

  it("trae «¿Ya tienes cuenta? Inicia sesión» con la misma ruta de regreso", async () => {
    expect(enlacesConTexto(await pintar("/monitores?materia=X"))).toContain(
      `/ingresar?siguiente=${encodeURIComponent("/monitores?materia=X")} → ¿Ya tienes cuenta? ${INGRESAR}`,
    );
  });

  it("un correo de 80 caracteres y un nombre largo salen enteros, para que la tarjeta los parta", async () => {
    const correo = `${"a".repeat(61)}@${"d".repeat(15)}.co`;
    base.lead = { ...LEAD, nombre: "Maria ".repeat(15).trim(), correo };

    const html = await pintar();
    expect(correo).toHaveLength(80);
    expect(texto(html)).toContain(correo);
    expect(html).toContain("Maria Maria");
  });

  it("sin correo: pide agregarlo en «Cambiar mis datos» y no ofrece pedir la cuenta", async () => {
    base.lead = { ...LEAD, correo: null };
    const html = await pintar();

    expect(texto(html)).toContain(TEXTOS.sinCorreo);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<button/);
    expect(enlaces(html)).toContain(`/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear")}`);
  });

  it("si el Lead ya tiene cuenta: lo dice, ofrece iniciar sesión y restablecer, y no ofrece pedir otra", async () => {
    base.tieneCuenta = true;
    const html = await pintar("/privacidad");

    expect(texto(html)).toContain("Ya tienes una cuenta");
    expect(texto(html)).toContain(TEXTOS.yaTiene);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<button/);
    expect(enlacesConTexto(html)).toContain("/ingresar?siguiente=%2Fprivacidad → Iniciar sesión");
    expect(enlacesConTexto(html)).toContain("/restablecer → ¿Olvidaste tu contraseña?");
  });

  it("si la sesión es de otro navegador ligado al Lead que ya tiene cuenta, también lo dice (la base no deja crear otra)", async () => {
    como("anonimo");
    base.tieneCuenta = true;

    expect(texto(await pintar())).toContain("Ya tienes una cuenta");
  });
});

describe("/cuenta/crear: confirmó el correo y falta el Estudiante", () => {
  it("una sesión sin rol y no anónima ve «Terminar de crear mi cuenta», con su botón y sin formulario de contacto", async () => {
    como(null);
    base.lead = LEAD;
    const html = await pintar();

    expect(texto(html)).toContain("Terminar de crear mi cuenta");
    expect(texto(html)).toContain(TEXTOS.terminar);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Terminar de crear mi cuenta<\/button>/);
    expect(html).not.toContain('name="correo"');
    expect(avisosConRol(html)).toBe(0);
  });

  it("sin Lead también: lo que importa es que confirmó su correo", async () => {
    como(null);
    expect(texto(await pintar())).toContain("Terminar de crear mi cuenta");
  });
});

describe("/cuenta/crear: a lo sumo un aviso con rol y ningún texto con rayas largas", () => {
  it("en ninguna pantalla hay más de un status o alert, ni rayas largas", async () => {
    const casos: [Rol | null, LeadDeSesion | null, boolean][] = [
      ["anonimo", null, false],
      ["anonimo", LEAD, false],
      ["anonimo", { ...LEAD, correo: null }, false],
      ["anonimo", LEAD, true],
      [null, LEAD, false],
      ["monitor", null, false],
      ["admin", null, false],
    ];
    for (const [rol, lead, tieneCuenta] of casos) {
      como(rol);
      base.lead = lead;
      base.tieneCuenta = tieneCuenta;
      const html = await pintar();

      expect(avisosConRol(html), `${rol}/${lead?.correo}/${tieneCuenta}`).toBeLessThanOrEqual(1);
      expect(texto(html), `${rol}/${lead?.correo}/${tieneCuenta}`).not.toContain("—");
    }
  });
});
