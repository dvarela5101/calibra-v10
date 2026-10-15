import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MateriaDeLaLista } from "@/lib/materias/servidor";
import MateriasYEvaluaciones, { metadata } from "./page";

// HU-055 sin navegador ni base: la lista de materias con la sesión y las materias inventadas, y se lee el HTML. Aquí se
// fija qué ve el admin (criterio 1), el aviso de después de borrar (criterio 14) y las fallas de lectura (criterio 18).
// El recorrido con la base lo cubren la integración y la e2e.

const h = vi.hoisted(() => ({
  rutas: [] as string[],
  materias: [] as MateriaDeLaLista[],
  falla: null as Error | null,
  cliente: {} as object | null,
}));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (rol: string, ruta: string) => {
    h.rutas.push(`${rol}:${ruta}`);
    return { idUsuario: "a0a0a0a0-0000-4000-8000-000000000055", rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/materias/servidor", () => ({
  listarMaterias: async () => {
    if (h.falla) throw h.falla;
    return h.materias;
  },
}));
// Las acciones viven en el servidor: aquí no se llaman.
vi.mock("@/app/admin/materias/acciones", () => ({ crear: vi.fn(), guardar: vi.fn(), guardarEvaluacion: vi.fn(), borrar: vi.fn(), borrarEvaluacion: vi.fn() }));

const ID_A = "aaaaaaaa-0000-4000-8000-000000000055";
const ID_B = "bbbbbbbb-0000-4000-8000-000000000055";
const ID_C = "cccccccc-0000-4000-8000-000000000055";
const ID_D = "dddddddd-0000-4000-8000-000000000055";

const materia = (id: string, nombre: string, codigo: string, evaluaciones: number, activas: number): MateriaDeLaLista => ({ id, nombre, codigo, evaluaciones, activas });

async function pintar(consulta: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await MateriasYEvaluaciones({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas ni comentarios de React y con los espacios normalizados. */
const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();

beforeEach(() => {
  h.rutas = [];
  h.materias = [];
  h.falla = null;
  h.cliente = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/admin/materias: la página", () => {
  it("pide el rol admin para esa ruta y se titula «Materias y evaluaciones · Calibra»", async () => {
    await pintar();
    expect(h.rutas).toEqual(["admin:/admin/materias"]);
    expect(metadata.title).toBe("Materias y evaluaciones · Calibra");
  });

  it("tiene el eyebrow, el h1 y el subtítulo que explican qué se corrige aquí y qué trae el banco", async () => {
    const html = await pintar();
    expect(html).toMatch(/<p[^>]*>Administración<\/p>/);
    expect(html).toMatch(/<h1[^>]*>Materias y evaluaciones<\/h1>/);
    expect(texto(html)).toContain("Los temas, las habilidades y las preguntas vienen del banco (carpeta contenido/).");
  });
});

describe("/admin/materias: el formulario «Nueva materia» (criterio 1)", () => {
  it("sale arriba, con «Nombre», «Código» y el botón «Crear materia», aunque no haya materias", async () => {
    const html = await pintar();
    expect(html).toMatch(/<h2[^>]*>Nueva materia<\/h2>/);
    expect(html).toMatch(/<label[^>]*>Nombre<\/label>/);
    expect(html).toMatch(/<label[^>]*>Código<\/label>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear materia<\/button>/);
    expect(texto(html)).toContain("Cuatro letras, un guion y cuatro números, como MATE-1214.");
    // El formulario de crear no lleva el id de ninguna materia ni el aviso de cambiar el código.
    expect(html).not.toContain('name="id"');
    expect(html).not.toContain("dejarán de encontrar");
    expect(html.indexOf("Nueva materia")).toBeLessThan(html.indexOf("Materias ("));
  });
});

describe("/admin/materias: la lista (criterio 1)", () => {
  it("sin materias dice «Todavía no hay materias.» y no hay lista", async () => {
    const html = await pintar();
    expect(texto(html)).toContain("Todavía no hay materias.");
    expect(html).toMatch(/<h2[^>]*>Materias \(0\)<\/h2>/);
    expect(html).not.toContain("<ul");
  });

  it("cada materia: el nombre como enlace a su página y debajo su código y sus evaluaciones", async () => {
    h.materias = [
      materia(ID_A, "Álgebra Lineal", "MATE-1105", 0, 0),
      materia(ID_B, "Cálculo Diferencial", "MATE-1214", 3, 2),
      materia(ID_C, "Física I", "FISI-1518", 1, 1),
      materia(ID_D, "Física II", "FISI-1528", 1, 0),
    ];
    const html = await pintar();
    expect(html).toMatch(/<h2[^>]*>Materias \(4\)<\/h2>/);
    expect(html).not.toContain("Todavía no hay materias.");
    for (const [id, nombre, linea] of [
      [ID_A, "Álgebra Lineal", "MATE-1105 · Sin evaluaciones"],
      [ID_B, "Cálculo Diferencial", "MATE-1214 · 3 evaluaciones, 2 activas"],
      [ID_C, "Física I", "FISI-1518 · 1 evaluación, 1 activa"],
      [ID_D, "Física II", "FISI-1528 · 1 evaluación, ninguna activa"],
    ]) {
      expect(html, nombre).toMatch(new RegExp(`<a[^>]*href="/admin/materias/${id}"[^>]*>${nombre}</a>`));
      expect(html, nombre).toContain(`>${linea}</span>`);
    }
  });

  it("respeta el orden que trae la lectura (por nombre)", async () => {
    h.materias = [materia(ID_A, "Álgebra", "MATE-1105", 0, 0), materia(ID_B, "Cálculo", "MATE-1214", 0, 0)];
    const html = await pintar();
    expect(html.indexOf("Álgebra")).toBeLessThan(html.indexOf("Cálculo"));
  });

  it("un nombre con HTML se pinta como texto", async () => {
    h.materias = [materia(ID_A, "<script>alert(1)</script>", "MATE-1105", 0, 0)];
    const html = await pintar();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("enlaza de vuelta a la bandeja", async () => {
    expect(await pintar()).toMatch(/<a[^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
  });
});

describe("/admin/materias: cuando la lectura falla (criterio 18)", () => {
  it("dice «No pudimos cargar las materias…» como alerta, con el enlace a la bandeja, y deja la falla en el registro", async () => {
    h.falla = new Error("caída");
    const html = await pintar();
    expect(html).toMatch(
      /<p role="alert"[^>]*>No pudimos cargar las materias\. Recarga la página; si sigue igual, avisa al equipo\.<\/p>/,
    );
    expect(html).toMatch(/<a[^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
    expect(html).not.toContain("Nueva materia");
    expect(html).not.toContain("Todavía no hay materias.");
    expect(console.error).toHaveBeenCalledWith("[materias] no se pudieron leer las materias:", "caída");
  });

  it("si falta la conexión, también", async () => {
    h.cliente = null;
    expect(await pintar()).toContain('role="alert"');
  });
});

describe("/admin/materias?borrada= (criterio 14)", () => {
  it("después de borrar, dice «Borramos la materia {nombre}.» como estado", async () => {
    const html = await pintar({ borrada: "Cálculo Diferencial" });
    expect(html).toMatch(/<p role="status"[^>]*>Borramos la materia Cálculo Diferencial\.<\/p>/);
  });

  it("también lo dice cuando la lista no se puede leer", async () => {
    h.falla = new Error("caída");
    expect(await pintar({ borrada: "Cálculo" })).toContain("Borramos la materia Cálculo.");
  });

  it("sin el parámetro, o vacío, no hay ningún aviso de borrado", async () => {
    expect(await pintar()).not.toContain("Borramos");
    expect(await pintar({ borrada: "   " })).not.toContain("Borramos");
    expect(await pintar()).not.toContain('role="status"');
  });

  it("lo pinta como texto: un <script> queda escapado y no se interpreta", async () => {
    const html = await pintar({ borrada: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Borramos la materia &lt;script&gt;alert(1)&lt;/script&gt;.");
  });

  it("recorta el nombre a 120 caracteres", async () => {
    const html = await pintar({ borrada: "a".repeat(500) });
    expect(html).toContain(`Borramos la materia ${"a".repeat(120)}.`);
    expect(html).not.toContain("a".repeat(121));
  });

  it("con el parámetro repetido toma el primero", async () => {
    expect(texto(await pintar({ borrada: ["Uno", "Dos"] }))).toContain("Borramos la materia Uno.");
  });
});
