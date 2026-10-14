import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MateriaConEvaluaciones } from "@/lib/materias/servidor";
import MateriaYSusEvaluaciones, { metadata } from "./page";

// HU-055 sin navegador ni base: la página de una materia con la sesión, la materia y lo ligado inventados, y se lee el HTML.
// Aquí se fija qué ve el admin: la materia, sus evaluaciones (criterio 6), cuándo hay botón de borrar y cuándo la página dice
// por qué no (criterios 12, 13 y 15), la falla cerrada si no se pudo preguntar lo ligado y las fallas de lectura (criterio 18).
// El recorrido con la base lo cubren la integración y la e2e.

const h = vi.hoisted(() => ({
  rutas: [] as string[],
  materia: null as MateriaConEvaluaciones | null,
  /** Lo ligado a la materia; un Error simula que la consulta falla. */
  ligadoDeLaMateria: [] as string[] | Error,
  /** Lo ligado a cada evaluación por id; las que no están, nada ligado. */
  ligadoDeEvaluaciones: {} as Record<string, string[] | Error>,
  falla: null as Error | null,
  cliente: {} as object | null,
  lecturas: [] as string[],
}));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (rol: string, ruta: string) => {
    h.rutas.push(`${rol}:${ruta}`);
    return { idUsuario: "a0a0a0a0-0000-4000-8000-000000000055", rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/materias/servidor", () => ({
  cargarMateria: async (_cliente: unknown, id: string) => {
    h.lecturas.push(`materia:${id}`);
    if (h.falla) throw h.falla;
    return h.materia;
  },
  ligadoDeMateria: async (_cliente: unknown, id: string) => {
    h.lecturas.push(`ligado-materia:${id}`);
    if (h.ligadoDeLaMateria instanceof Error) throw h.ligadoDeLaMateria;
    return h.ligadoDeLaMateria;
  },
  ligadoDeEvaluacion: async (_cliente: unknown, id: string) => {
    h.lecturas.push(`ligado-evaluacion:${id}`);
    const ligado = h.ligadoDeEvaluaciones[id] ?? [];
    if (ligado instanceof Error) throw ligado;
    return ligado;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
// Las acciones viven en el servidor: aquí no se llaman.
vi.mock("@/app/admin/materias/acciones", () => ({ crear: vi.fn(), guardar: vi.fn(), guardarEvaluacion: vi.fn(), borrar: vi.fn(), borrarEvaluacion: vi.fn() }));

const ID = "11111111-0000-4000-8000-000000000055";
const E1 = "e1e1e1e1-0000-4000-8000-000000000055";
const E2 = "e2e2e2e2-0000-4000-8000-000000000055";
const E3 = "e3e3e3e3-0000-4000-8000-000000000055";

const evaluacion = (id: string, nombre: string, semana: number, acumulativo: boolean, activa: boolean) => ({ id, nombre, semana, acumulativo, activa });
const materia = (cambios: Partial<MateriaConEvaluaciones> = {}): MateriaConEvaluaciones => ({
  id: ID,
  nombre: "Cálculo Diferencial",
  codigo: "MATE-1214",
  evaluaciones: [],
  ...cambios,
});

async function pintar(consulta: Record<string, string> = {}, id = ID): Promise<string> {
  return renderToStaticMarkup(await MateriaYSusEvaluaciones({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas ni comentarios de React y con los espacios normalizados. */
const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();

const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));
const nombresDeBotones = (html: string) => botones(html).map((b) => b.nombre);

beforeEach(() => {
  h.rutas = [];
  h.lecturas = [];
  h.materia = materia();
  h.ligadoDeLaMateria = [];
  h.ligadoDeEvaluaciones = {};
  h.falla = null;
  h.cliente = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/admin/materias/[id]: la página", () => {
  it("pide el rol admin para esa materia y se titula «Materia · Calibra»", async () => {
    await pintar();
    expect(h.rutas).toEqual([`admin:/admin/materias/${ID}`]);
    expect(metadata.title).toBe("Materia · Calibra");
  });

  it("el h1 es el nombre de la materia, con el eyebrow «Materias y evaluaciones»", async () => {
    const html = await pintar();
    expect(html).toMatch(/<p[^>]*>Materias y evaluaciones<\/p>/);
    expect(html).toMatch(/<h1[^>]*>Cálculo Diferencial<\/h1>/);
  });

  it("un id que no es un uuid da notFound sin leer nada", async () => {
    await expect(pintar({}, "no-es-un-id")).rejects.toThrow("notFound");
    expect(h.lecturas).toEqual([]);
  });

  it("una materia que no existe da notFound", async () => {
    h.materia = null;
    await expect(pintar()).rejects.toThrow("notFound");
    expect(h.lecturas).toEqual([`materia:${ID}`]);
  });

  it("enlaza a la lista y a la bandeja", async () => {
    const html = await pintar();
    expect(html).toMatch(/<a[^>]*href="\/admin\/materias"[^>]*>Volver a las materias<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
  });
});

describe("/admin/materias/[id]: «Datos de la materia» (criterio 5)", () => {
  it("el formulario trae el nombre y el código guardados, el id oculto y «Guardar cambios»", async () => {
    const html = await pintar();
    expect(html).toMatch(/<h2[^>]*>Datos de la materia<\/h2>/);
    expect(html).toMatch(/<input[^>]*name="nombre"[^>]*value="Cálculo Diferencial"/);
    expect(html).toMatch(/<input[^>]*name="codigo"[^>]*value="MATE-1214"/);
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(nombresDeBotones(html)).toContain("Guardar cambios");
  });

  it("no avisa del código mientras el campo sea el guardado", async () => {
    expect(await pintar()).not.toContain("Los enlaces con el código anterior dejarán de encontrar esta materia.");
  });
});

describe("/admin/materias/[id]: sus evaluaciones (criterio 6)", () => {
  it("sin evaluaciones: «Esta materia no tiene evaluaciones. Las trae el banco (carpeta contenido/).»", async () => {
    const html = await pintar();
    expect(html).toMatch(/<h2[^>]*>Evaluaciones \(0\)<\/h2>/);
    expect(texto(html)).toContain("Esta materia no tiene evaluaciones. Las trae el banco (carpeta contenido/).");
  });

  it("cada evaluación: su nombre en un h3, su semana, si es acumulativa y «Activa»/«Inactiva» escritos, en el orden de la lectura", async () => {
    h.materia = materia({
      evaluaciones: [
        evaluacion(E1, "Parcial 1", 4, false, true),
        evaluacion(E2, "Parcial 2", 8, false, false),
        evaluacion(E3, "Examen final", 16, true, true),
      ],
    });
    const html = await pintar();
    expect(html).toMatch(/<h2[^>]*>Evaluaciones \(3\)<\/h2>/);
    expect(html).not.toContain("Esta materia no tiene evaluaciones");
    for (const [id, nombre, linea] of [
      [E1, "Parcial 1", "Semana 4 · No acumulativa · Activa"],
      [E2, "Parcial 2", "Semana 8 · No acumulativa · Inactiva"],
      [E3, "Examen final", "Semana 16 · Acumulativa · Activa"],
    ]) {
      expect(html, nombre).toMatch(new RegExp(`<h3 id="evaluacion-${id}"[^>]*>${nombre}</h3>`));
      expect(html, nombre).toContain(`>${linea}</p>`);
    }
    expect(html.indexOf("Parcial 1")).toBeLessThan(html.indexOf("Parcial 2"));
    expect(html.indexOf("Parcial 2")).toBeLessThan(html.indexOf("Examen final"));
  });

  it("cada evaluación lleva su formulario con el h3 como nombre, sus campos «Nombre» y «Semana» con ids propios y «Guardar evaluación»", async () => {
    h.materia = materia({ evaluaciones: [evaluacion(E1, "Parcial 1", 4, false, true), evaluacion(E2, "Parcial 2", 8, false, true)] });
    const html = await pintar();
    for (const [id, nombre, semana] of [
      [E1, "Parcial 1", "4"],
      [E2, "Parcial 2", "8"],
    ]) {
      expect(html).toMatch(new RegExp(`<form[^>]*aria-labelledby="evaluacion-${id}"`));
      expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${id}"`));
      expect(html).toMatch(new RegExp(`<label[^>]*for="evaluacion-nombre-${id}"[^>]*>Nombre</label>`));
      expect(html).toMatch(new RegExp(`<input[^>]*id="evaluacion-nombre-${id}"[^>]*value="${nombre}"`));
      expect(html).toMatch(new RegExp(`<label[^>]*for="evaluacion-semana-${id}"[^>]*>Semana</label>`));
      expect(html).toMatch(new RegExp(`<input[^>]*id="evaluacion-semana-${id}"[^>]*value="${semana}"`));
    }
    expect(nombresDeBotones(html).filter((n) => n === "Guardar evaluación")).toHaveLength(2);
  });

  it("los ids de los campos no se repiten en la página", async () => {
    h.materia = materia({ evaluaciones: [evaluacion(E1, "Parcial 1", 4, false, true), evaluacion(E2, "Parcial 2", 8, false, true)] });
    const ids = [...(await pintar()).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("/admin/materias/[id]: borrar la materia (criterios 12 y 13)", () => {
  it("sin nada ligado hay botón «Borrar materia»", async () => {
    const html = await pintar();
    expect(nombresDeBotones(html)).toContain("Borrar materia");
    expect(html).not.toContain("No se puede borrar");
    expect(html).not.toContain("¿Borrar la materia");
    expect(h.lecturas).toContain(`ligado-materia:${ID}`);
  });

  it("con algo ligado no hay botón y la página dice qué tiene, solo eso", async () => {
    const casos: [string[], string][] = [
      [
        ["evaluaciones", "temas", "certificados", "solicitudes", "diagnosticos", "monitorias"],
        "evaluaciones, temas, certificados, solicitudes de monitor, diagnósticos y monitorías",
      ],
      [["certificados"], "certificados"],
      [["certificados", "monitorias"], "certificados y monitorías"],
      // Aunque la base los mande en otro orden, se dicen en el orden fijo.
      [["temas", "evaluaciones"], "evaluaciones y temas"],
    ];
    for (const [ligado, frase] of casos) {
      h.ligadoDeLaMateria = ligado;
      const html = await pintar();
      expect(nombresDeBotones(html), frase).not.toContain("Borrar materia");
      expect(texto(html), frase).toContain(`No se puede borrar: tiene ${frase}.`);
    }
  });

  it("falla cerrada: si no se pudo preguntar lo ligado, no hay botón y se avisa como alerta", async () => {
    h.ligadoDeLaMateria = new Error("caída");
    const html = await pintar();
    expect(nombresDeBotones(html)).not.toContain("Borrar materia");
    expect(html).toMatch(/<p role="alert"[^>]*>No pudimos comprobar si se puede borrar\. Recarga la página\.<\/p>/);
    expect(html).not.toContain("No se puede borrar:");
    expect(console.error).toHaveBeenCalledWith("[materias] no se pudo leer lo ligado a la materia:", "caída");
  });
});

describe("/admin/materias/[id]: borrar una evaluación (criterio 15)", () => {
  beforeEach(() => {
    h.materia = materia({
      evaluaciones: [evaluacion(E1, "Parcial 1", 4, false, true), evaluacion(E2, "Parcial 2", 8, false, false), evaluacion(E3, "Examen final", 16, true, true)],
    });
    h.ligadoDeLaMateria = ["evaluaciones", "temas"];
  });

  it("una sin nada ligado tiene «Borrar»; con temas o diagnósticos no, y la página dice qué tiene", async () => {
    h.ligadoDeEvaluaciones = { [E1]: ["temas", "diagnosticos"], [E3]: ["temas"] };
    const html = await pintar();
    // Solo la evaluación E2 se puede borrar.
    expect(nombresDeBotones(html).filter((n) => n === "Borrar")).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<button[^>]*aria-describedby="evaluacion-${E2}"[^>]*>Borrar</button>`));
    const t = texto(html);
    expect(t).toContain("No se puede borrar: tiene temas y diagnósticos.");
    expect(t).toContain("No se puede borrar: tiene temas.");
    expect(t).not.toContain("No se puede borrar: tiene diagnósticos.");
  });

  it("solo con diagnósticos, dice «diagnósticos»", async () => {
    h.ligadoDeEvaluaciones = { [E1]: ["diagnosticos"], [E2]: ["diagnosticos"], [E3]: ["diagnosticos"] };
    const html = await pintar();
    expect(nombresDeBotones(html)).not.toContain("Borrar");
    expect(texto(html).match(/No se puede borrar: tiene diagnósticos\./g)).toHaveLength(3);
  });

  it("si lo ligado de una evaluación no se pudo leer, esa no ofrece borrar y las demás siguen igual", async () => {
    h.ligadoDeEvaluaciones = { [E1]: new Error("caída") };
    const html = await pintar();
    expect(nombresDeBotones(html).filter((n) => n === "Borrar")).toHaveLength(2);
    expect(html.match(/No pudimos comprobar si se puede borrar\. Recarga la página\./g)).toHaveLength(1);
    expect(html).toContain('role="alert"');
  });

  it("pide lo ligado de cada evaluación por su id", async () => {
    await pintar();
    expect(h.lecturas).toEqual(expect.arrayContaining([`ligado-evaluacion:${E1}`, `ligado-evaluacion:${E2}`, `ligado-evaluacion:${E3}`]));
  });
});

describe("/admin/materias/[id]?evaluacion_borrada= (criterio 15)", () => {
  it("después de borrar una evaluación, dice «Borramos la evaluación {nombre}.» como estado", async () => {
    const html = await pintar({ evaluacion_borrada: "Parcial 2" });
    expect(html).toMatch(/<p role="status"[^>]*>Borramos la evaluación Parcial 2\.<\/p>/);
  });

  it("sin el parámetro no hay aviso, y lo pinta como texto", async () => {
    expect(await pintar()).not.toContain("Borramos");
    const html = await pintar({ evaluacion_borrada: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Borramos la evaluación &lt;script&gt;alert(1)&lt;/script&gt;.");
  });
});

describe("/admin/materias/[id]: cuando la lectura falla (criterio 18)", () => {
  it("dice «No pudimos cargar las materias…» como alerta, con el enlace a la bandeja, y la falla queda en el registro", async () => {
    h.falla = new Error("caída");
    const html = await pintar();
    expect(html).toMatch(
      /<p role="alert"[^>]*>No pudimos cargar las materias\. Recarga la página; si sigue igual, avisa al equipo\.<\/p>/,
    );
    expect(html).toMatch(/<a[^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
    expect(html).not.toContain("Datos de la materia");
    expect(console.error).toHaveBeenCalledWith("[materias] no se pudo leer la materia:", "caída");
  });

  it("si falta la conexión, también", async () => {
    h.cliente = null;
    expect(await pintar()).toContain("No pudimos cargar las materias.");
  });
});

describe("/admin/materias/[id]: nombres largos y con HTML", () => {
  it("un nombre con HTML se pinta como texto", async () => {
    h.materia = materia({ nombre: "<img src=x onerror=alert(1)>", evaluaciones: [evaluacion(E1, "<b>Parcial</b>", 4, false, true)] });
    const html = await pintar();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Parcial</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
