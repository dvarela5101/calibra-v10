import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CitaSinPlazo, CitasSinPlazo } from "@/lib/admin/citas";
import CitasSinPlazoParaCancelar, { metadata } from "./page";

// Sin navegador ni base: la lista de las citas sin plazo para cancelar con la sesión y las citas inventadas, y se lee el
// HTML. Aquí se fija qué ve el admin (cada cita con su día, su hora, la materia, el monitor, quien agendó y su contacto, y
// el estado del pago; la lista vacía; el corte), que el texto libre se escapa, que el estilo no deja desbordar un correo
// largo y que ninguna cifra de comisión llega a la página. El recorrido con la base lo cubre e2e/cancelar-fuera-de-plazo.spec.ts.

const M1 = "11111111-0000-4000-8000-000000000052";
const M2 = "22222222-0000-4000-8000-000000000052";

const rutas = vi.hoisted(() => ({ pedidas: [] as [string, string][] }));
const datos = vi.hoisted(() => ({ citas: { filas: [], total: 0 } as CitasSinPlazo, falla: null as Error | null }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (rol: string, ruta: string) => {
    rutas.pedidas.push([rol, ruta]);
    return { idUsuario: "a0a0a0a0-0000-4000-8000-000000000052", rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/citas", () => ({
  cargarCitasSinPlazo: async () => {
    if (datos.falla) throw datos.falla;
    return datos.citas;
  },
  cargarCitaParaAutorizar: vi.fn(),
  autorizarCancelacion: vi.fn(),
}));

const CITA: CitaSinPlazo = {
  id: M1,
  inicio: new Date("2030-01-07T15:00:00.000Z"),
  fecha: "2030-01-07",
  hora: "10:00:00",
  duracionMin: 60,
  nombreMateria: "Cálculo Diferencial",
  nombreMonitor: "Andrés Gómez",
  lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: "3001234567" },
  estadoPago: "aprobado",
};

const OTRA: CitaSinPlazo = {
  ...CITA,
  id: M2,
  inicio: new Date("2030-01-07T16:30:00.000Z"),
  hora: "11:30:00",
  nombreMateria: "Física Mecánica",
  nombreMonitor: "Laura Díaz",
  lead: { nombre: "Luis Pérez", correo: null, telefono: "3109876543" },
  estadoPago: "en_revision",
};

async function pintar(filas: CitaSinPlazo[], total = filas.length): Promise<string> {
  datos.citas = { filas, total };
  return renderToStaticMarkup(await CitasSinPlazoParaCancelar());
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  rutas.pedidas = [];
  datos.falla = null;
});

describe("Citas sin plazo para cancelar (HU-052): lo que ve el admin", () => {
  it("el título, el subtítulo y la sesión: se pide el rol de admin con la ruta de la lista", async () => {
    expect(metadata.title).toBe("Citas sin plazo para cancelar · Calibra");
    const t = texto(await pintar([CITA]));
    expect(t).toContain("Cancelaciones");
    expect(t).toContain("Citas sin plazo para cancelar");
    expect(t).toContain(
      "Son las monitorías individuales confirmadas a las que ya se les pasó el plazo para cancelar y todavía no empiezan. Abre una para autorizar su cancelación en un caso extremo.",
    );
    // El rol cuenta tanto como la ruta: con otro rol, el admin rebotaría y un monitor o un Lead entrarían.
    expect(rutas.pedidas).toEqual([["admin", "/admin/citas"]]);
  });

  it("cada cita es un enlace a su página, con su día, su hora, la materia, el monitor, quien agendó con su contacto y el pago", async () => {
    const html = await pintar([CITA, OTRA]);
    expect(html).toContain(`href="/admin/citas/${M1}"`);
    expect(html).toContain(`href="/admin/citas/${M2}"`);
    expect(html.match(/<a [^>]*href="\/admin\/citas\//g)).toHaveLength(2);
    const t = texto(html);
    expect(t).toContain("7 de enero de 2030 a las 10:00 Cálculo Diferencial · Andrés Gómez Agendó Camila Rojas · camila@uniandes.edu.co · 3001234567 Pago aprobado");
    expect(t).toContain("7 de enero de 2030 a las 11:30 Física Mecánica · Laura Díaz Agendó Luis Pérez · 3109876543 Pago en revisión");
    expect(html).toContain('<time dateTime="2030-01-07T15:00:00.000Z">');
  });

  it("las citas salen en el orden en que llegan: la que empieza primero, arriba", async () => {
    const html = await pintar([CITA, OTRA]);
    expect(html.indexOf(M1)).toBeLessThan(html.indexOf(M2));
    const alReves = await pintar([OTRA, CITA]);
    expect(alReves.indexOf(M2)).toBeLessThan(alReves.indexOf(M1));
  });

  it("sin citas dice que no hay ninguna con el plazo vencido que todavía no empiece", async () => {
    const html = await pintar([]);
    expect(texto(html)).toContain("No hay citas con el plazo vencido que todavía no empiecen.");
    expect(html).not.toMatch(/<ul|href="\/admin\/citas\//);
  });

  it("el estado del pago de cada cita, sin cifras", async () => {
    for (const [estado, dicho] of [
      ["aprobado", "Pago aprobado"],
      ["en_revision", "Pago en revisión"],
      ["rechazado", "Pago rechazado"],
      ["sin_pagar", "Sin pagar"],
    ] as const) {
      expect(texto(await pintar([{ ...CITA, estadoPago: estado }])), estado).toContain(dicho);
    }
  });

  it("el contacto es el que haya: solo el correo, solo el teléfono o ninguno", async () => {
    expect(texto(await pintar([{ ...CITA, lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: null } }]))).toContain(
      "Agendó Camila Rojas · camila@uniandes.edu.co Pago",
    );
    expect(texto(await pintar([{ ...CITA, lead: { nombre: "Camila Rojas", correo: null, telefono: "3001234567" } }]))).toContain(
      "Agendó Camila Rojas · 3001234567 Pago",
    );
    expect(texto(await pintar([{ ...CITA, lead: { nombre: "Camila Rojas", correo: null, telefono: null } }]))).toContain(
      "Agendó Camila Rojas · Sin datos de contacto Pago",
    );
  });

  it("el nombre, el correo, la materia y el monitor son texto libre: se escapan", async () => {
    const html = await pintar([
      {
        ...CITA,
        nombreMateria: "<b>Materia</b>",
        nombreMonitor: "<i>Monitor</i>",
        lead: { nombre: "<img src=x onerror=alert(1)>", correo: "<script>alert(2)</script>@uniandes.edu.co", telefono: null },
      },
    ]);
    expect(html).not.toMatch(/<b>Materia|<i>Monitor|<img src=x|<script>alert/);
    expect(html).toContain("&lt;b&gt;Materia&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;@uniandes.edu.co");
  });

  it("si hay más citas de las que se muestran, lo dice; si caben todas, no", async () => {
    expect(texto(await pintar([CITA, OTRA], 250))).toContain("Se muestran las primeras 2 de 250.");
    expect(texto(await pintar([CITA, OTRA], 2))).not.toContain("Se muestran");
    expect(texto(await pintar([]))).not.toContain("Se muestran");
  });

  it("siempre se puede volver a la bandeja", async () => {
    for (const filas of [[], [CITA]]) {
      expect(await pintar(filas)).toMatch(/<a [^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
    }
  });

  it("si la lectura falla, lo dice como alerta y deja el camino de vuelta", async () => {
    datos.falla = new Error("La cita está incompleta.");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await CitasSinPlazoParaCancelar());
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
    expect(texto(html)).toContain("No pudimos cargar las citas");
    expect(html).toMatch(/<p role="alert"[^>]*>Recarga la página; si sigue igual, avisa al equipo\.<\/p>/);
    expect(html).not.toMatch(/<ul|href="\/admin\/citas\//);
    expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
  });
});

describe("Citas sin plazo para cancelar: el estilo", () => {
  const css = readFileSync(join(__dirname, "citas.module.css"), "utf8");
  const regla = (selector: string) => css.match(new RegExp(`\\n\\.${selector} \\{([^}]*)\\}`))?.[1] ?? "";

  it("cada cita mide 44 px o más, y el correo largo se parte en vez de desbordar la tarjeta", () => {
    expect(regla("filaEnlace")).toMatch(/min-block-size:\s*var\(--toque-min\)/);
    expect(css).toMatch(/\.metaLarga \{[^}]*composes:\s*meta;[^}]*overflow-wrap:\s*anywhere/);
  });

  it("ningún texto por debajo de 14 px y los colores salen de los tokens", () => {
    const tamanos = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(tamanos.length).toBeGreaterThan(0);
    for (const px of tamanos) expect(px).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient/);
  });
});

describe("Citas sin plazo para cancelar: sin cifras de comisión (CLAUDE.md, D-59)", () => {
  it("ni la lista, ni la vacía, ni el error de carga hablan de comisión, bruto o neto", async () => {
    expect(await pintar([CITA, OTRA])).not.toMatch(/comisi|bruto|neto/i);
    expect(await pintar([CITA, OTRA], 250)).not.toMatch(/comisi|bruto|neto/i);
    expect(await pintar([])).not.toMatch(/comisi|bruto|neto/i);
    datos.falla = new Error("se cayó");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(renderToStaticMarkup(await CitasSinPlazoParaCancelar())).not.toMatch(/comisi|bruto|neto/i);
    espia.mockRestore();
  });
});
