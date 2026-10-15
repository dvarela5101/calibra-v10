import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// HU-050 y D-59: las cifras de comisión se muestran en `/monitor/desembolsos`, al monitor dueño de cada desembolso.
// HU-096 (D-71 b) suma un segundo lugar: la regla general (el porcentaje y el tope, sin ningún monto) en el registro del
// monitor, solo con una invitación vigente. Ese texto vive en `src/lib/plazos/regla-general.ts`, que ya está permitido;
// la página del registro es la única que lo llama (regla G), sin ningún literal con la palabra.
//
// Antes, la prohibición estaba repartida en comentarios y en unas 15 pruebas de pantallas que ya existían. Esta guarda
// vigila lo que importa: que ninguna pantalla, correo ni consulta NUEVA reciba la comisión sin que una prueba se ponga en rojo.
//
// La excepción cabe en tres lugares: la función de la base (la vigila `supabase/tests/mis_desembolsos.test.sql`), el
// módulo `src/lib/desembolsos/` y la carpeta `src/app/monitor/desembolsos/`. Aquí se vigilan los dos últimos y el
// resto del código (G2), y que la regla escrita en CLAUDE.md y en el README nombre la excepción (G4). Una cifra que
// llegue a una pantalla con otro nombre (un cálculo propio) no la ve ningún escáner: la atrapa el barrido de HTML de
// `e2e/mis-desembolsos.spec.ts`.
//
// Se mira el código con la API de TypeScript para leer literales (textos, plantillas, JSX) y no comentarios.

const RAIZ = join(__dirname, "..");
const SRC = join(RAIZ, "src");

type Fuente = { ruta: string; texto: string };
type Regla = "A" | "B" | "C" | "D" | "E" | "F" | "G";
type Hallazgo = { regla: Regla; ruta: string; detalle: string };

/** Todos los .ts y .tsx de una carpeta, sin las pruebas. */
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Lo que se escanea: `src/**` sin las pruebas y sin los tipos que genera la base (`npm run db:tipos`). */
const archivos: Fuente[] = fuentes(SRC)
  .map((ruta) => ({ ruta: relative(RAIZ, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") }))
  .filter((a) => a.ruta !== "src/lib/supabase/tipos.ts");

/** El módulo y la carpeta donde la comisión puede aparecer. */
const MODULO = "src/lib/desembolsos/";
const PANTALLA = "src/app/monitor/desembolsos/";
const esPropio = (ruta: string) => ruta.startsWith(MODULO) || ruta.startsWith(PANTALLA);

/** El único archivo que habla con la función de la base. */
const LECTOR = "src/lib/desembolsos/servidor.ts";

/** Dónde más puede aparecer la palabra, y por qué. Cada entrada tiene que existir. */
const PERMITIDOS_PARA_LA_PALABRA = [
  {
    prefijo: "src/lib/plazos/",
    motivo:
      "El motor de plazos calcula la comisión (N-2) y lee sus parámetros de `parametros_comision`; no la entrega a una pantalla, salvo la regla general (porcentaje y tope, sin montos) que arma `regla-general.ts` para el registro del monitor (HU-096).",
  },
];

/** Quién puede calcular la comisión: solo el motor. Una pantalla que la calcule por su cuenta rompe N-2. */
const CALCULOS_DE_COMISION = new Set(["calcularComision", "calcularMontoNeto", "cargarParametrosComision"]);
const FUERA_DE_LOS_CALCULOS = "src/lib/plazos/";

/** La regla general del registro (HU-096): el módulo que la arma, quién puede usarla y con qué nombres. */
const REGLA_GENERAL = "src/lib/plazos/regla-general";
const USA_LA_REGLA_GENERAL = "src/app/(cuentas)/monitores/registro/page.tsx";
const FUNCIONES_DE_LA_REGLA_GENERAL = new Set(["describirReglaDeComision", "textoDeLaReglaDeComision"]);
const puedeUsarLaReglaGeneral = (ruta: string) => ruta.startsWith(FUERA_DE_LOS_CALCULOS) || ruta === USA_LA_REGLA_GENERAL;

// ---------------------------------------------------------------------------
// El escáner: una función pura que recibe una ruta y un texto
// ---------------------------------------------------------------------------

function analizar({ ruta, texto }: Fuente): ts.SourceFile {
  return ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function recorrer(nodo: ts.Node, visitar: (n: ts.Node) => void): void {
  visitar(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, visitar));
}

/** El texto de un nodo que es un literal (cadena, plantilla o texto de JSX); `null` si es otra cosa. Los comentarios no son nodos. */
function textoDeLiteral(nodo: ts.Node): string | null {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) {
    return nodo.text;
  }
  return ts.isJsxText(nodo) ? nodo.text : null;
}

/** Todos los literales de un archivo. */
function literalesDe(fuente: Fuente): string[] {
  const literales: string[] = [];
  recorrer(analizar(fuente), (nodo) => {
    const texto = textoDeLiteral(nodo);
    if (texto !== null) literales.push(texto);
  });
  return literales;
}

/** Lo que un nodo importa, si es una importación: estática, reexportación, dinámica, `require` o `import("…").Tipo`. */
function especificadorDe(nodo: ts.Node): string | null {
  if ((ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) && nodo.moduleSpecifier && ts.isStringLiteral(nodo.moduleSpecifier)) {
    return nodo.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(nodo) && ts.isExternalModuleReference(nodo.moduleReference) && ts.isStringLiteral(nodo.moduleReference.expression)) {
    return nodo.moduleReference.expression.text;
  }
  if (ts.isImportTypeNode(nodo) && ts.isLiteralTypeNode(nodo.argument) && ts.isStringLiteral(nodo.argument.literal)) return nodo.argument.literal.text;
  if (ts.isCallExpression(nodo)) {
    const [primero] = nodo.arguments;
    const esImportacion = nodo.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(nodo.expression) && nodo.expression.text === "require");
    if (esImportacion && primero && ts.isStringLiteralLike(primero)) return primero.text;
  }
  return null;
}

/** La ruta (desde la raíz del repo, con `/`) a la que apunta un especificador; `null` si es un paquete. */
function resolver(desde: string, especificador: string): string | null {
  if (especificador.startsWith("@/")) return `src/${especificador.slice(2)}`;
  if (especificador.startsWith(".")) return posix.normalize(posix.join(posix.dirname(desde), especificador));
  return null;
}

const esDelModuloOLaPantalla = (destino: string) =>
  destino === MODULO.slice(0, -1) || destino.startsWith(MODULO) || destino === PANTALLA.slice(0, -1) || destino.startsWith(PANTALLA);

/** `.select()` o `.select("*")` (también `"id, *"`): todas las columnas. */
function pideTodasLasColumnas(llamada: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(llamada.expression) || llamada.expression.name.text !== "select") return false;
  const [columnas] = llamada.arguments;
  if (!columnas) return true;
  const texto = textoDeLiteral(columnas);
  return texto !== null && /(^|,)\s*\*\s*(,|$)/.test(texto);
}

/** Si la cadena de llamadas de `llamada` nace en `.from("desembolso")`, por ejemplo `.from("desembolso").update(…).eq(…).select()`. */
function nacioEnDesembolso(llamada: ts.CallExpression): boolean {
  let actual: ts.Expression = llamada.expression;
  for (;;) {
    if (ts.isCallExpression(actual)) {
      const { expression, arguments: argumentos } = actual;
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === "from" && argumentos[0] && textoDeLiteral(argumentos[0]) === "desembolso") return true;
      actual = expression;
    } else if (ts.isPropertyAccessExpression(actual) || ts.isAwaitExpression(actual) || ts.isParenthesizedExpression(actual) || ts.isNonNullExpression(actual) || ts.isAsExpression(actual)) {
      actual = actual.expression;
    } else {
      return false;
    }
  }
}

/** Empieza con la directiva "use client" (los comentarios y la primera línea en blanco no cuentan). */
const esDeCliente = (archivo: ts.SourceFile) =>
  archivo.statements.some((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client");

/** Revisa un archivo contra las reglas A a F de D-59 y la G de HU-096. Vacío si cumple. */
function revisar(fuente: Fuente): Hallazgo[] {
  const { ruta } = fuente;
  const archivo = analizar(fuente);
  const hallazgos: Hallazgo[] = [];
  const nota = (regla: Regla, detalle: string) => hallazgos.push({ regla, ruta, detalle });
  const propio = esPropio(ruta);
  const permitidaLaPalabra = propio || PERMITIDOS_PARA_LA_PALABRA.some((p) => ruta.startsWith(p.prefijo));

  recorrer(archivo, (nodo) => {
    const literal = textoDeLiteral(nodo);
    if (literal !== null) {
      // A. Solo servidor.ts del módulo habla con la función de la base.
      if (literal.includes("mis_desembolsos") && ruta !== LECTOR) nota("A", `llama o nombra mis_desembolsos: "${literal.slice(0, 40)}"`);
      // C. Ningún texto, plantilla, JSX ni columna pedida dice «comisión» o «bruto» fuera de los lugares permitidos.
      if (!permitidaLaPalabra && /comisi[oó]n|bruto/i.test(literal)) nota("C", `el literal dice comisión o bruto: "${literal.trim().slice(0, 40)}"`);
    }

    // B. Solo el módulo y la pantalla importan el módulo (o la carpeta de la pantalla, que lo arrastraría).
    const especificador = especificadorDe(nodo);
    const destino = especificador === null ? null : resolver(ruta, especificador);
    if (destino !== null && !propio && esDelModuloOLaPantalla(destino)) nota("B", `importa ${especificador}`);

    // G. La regla general (HU-096) solo la usa el registro del monitor: nadie más la importa ni llama sus funciones.
    if (!puedeUsarLaReglaGeneral(ruta)) {
      if (destino !== null && destino.replace(/\.tsx?$/, "") === REGLA_GENERAL) nota("G", `importa ${especificador}`);
      if (ts.isIdentifier(nodo) && FUNCIONES_DE_LA_REGLA_GENERAL.has(nodo.text)) nota("G", `usa ${nodo.text}`);
    }

    // D. Nadie calcula la comisión fuera del motor de plazos.
    if (ts.isIdentifier(nodo) && CALCULOS_DE_COMISION.has(nodo.text) && !ruta.startsWith(FUERA_DE_LOS_CALCULOS)) nota("D", `usa ${nodo.text}`);

    // E. Nadie lee toda la fila de `desembolso`.
    if (ts.isCallExpression(nodo) && pideTodasLasColumnas(nodo) && nacioEnDesembolso(nodo)) nota("E", 'lee todas las columnas de .from("desembolso")');
  });

  // F. El módulo que sabe de la comisión se queda en el servidor.
  if (propio && esDeCliente(archivo)) nota("F", 'declara "use client"');
  return hallazgos;
}

const hallazgosDe = (regla: Regla) => archivos.flatMap(revisar).filter((h) => h.regla === regla).map((h) => `${h.ruta}: ${h.detalle}`);

// ---------------------------------------------------------------------------
// G2. El código fuente
// ---------------------------------------------------------------------------

describe("la comisión solo se muestra en /monitor/desembolsos y la regla general en el registro (D-59, HU-096, G2)", () => {
  it("A. solo src/lib/desembolsos/servidor.ts nombra mis_desembolsos", () => {
    expect(hallazgosDe("A")).toEqual([]);
  });

  it("B. solo src/lib/desembolsos y src/app/monitor/desembolsos importan el módulo de los desembolsos (también con ruta relativa o import dinámico)", () => {
    expect(hallazgosDe("B")).toEqual([]);
  });

  it("C. fuera del módulo y de su pantalla, ningún texto, plantilla, JSX ni columna pedida dice «comisión» o «bruto»", () => {
    expect(hallazgosDe("C")).toEqual([]);
  });

  it("D. nadie calcula la comisión fuera de src/lib/plazos (N-2): calcularComision, calcularMontoNeto y cargarParametrosComision", () => {
    expect(hallazgosDe("D")).toEqual([]);
  });

  it('E. ningún .from("desembolso") termina en .select("*") ni en .select()', () => {
    expect(hallazgosDe("E")).toEqual([]);
  });

  it('F. ningún archivo del módulo ni de la pantalla es "use client": no viajan en el paquete del navegador', () => {
    expect(hallazgosDe("F")).toEqual([]);
  });

  it("G. solo la página del registro del monitor usa la regla general (HU-096): nadie más importa regla-general ni llama sus funciones", () => {
    expect(hallazgosDe("G")).toEqual([]);
  });

  it("la lista de lugares permitidos para la palabra no se pudre: cada entrada existe, tiene motivo y se usa", () => {
    for (const { prefijo, motivo } of PERMITIDOS_PARA_LA_PALABRA) {
      const delPrefijo = archivos.filter((a) => a.ruta.startsWith(prefijo));
      expect(delPrefijo.length, `${prefijo} no existe`).toBeGreaterThan(0);
      expect(motivo.length, `${prefijo} sin motivo`).toBeGreaterThan(20);
      // Una entrada que nadie usa es una excepción de más: se quita.
      const usada = delPrefijo.some((a) => literalesDe(a).some((l) => /comisi[oó]n|bruto/i.test(l)) || [...CALCULOS_DE_COMISION].some((c) => a.texto.includes(c)));
      expect(usada, `${prefijo} no hace falta`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// G2.G. Controles: una guarda que recorre cero archivos o ya no ve un patrón pasa en vacío
// ---------------------------------------------------------------------------

describe("los controles de la guarda (G2.G)", () => {
  it("control positivo: el escáner revisó más de 100 archivos y ve el rótulo «Comisión de Calibra» y mis_desembolsos donde deben estar", () => {
    expect(archivos.length).toBeGreaterThan(100);
    const reglas = archivos.find((a) => a.ruta === "src/lib/desembolsos/reglas.ts");
    const servidor = archivos.find((a) => a.ruta === LECTOR);
    expect(reglas, "falta src/lib/desembolsos/reglas.ts").toBeDefined();
    expect(servidor, "falta src/lib/desembolsos/servidor.ts").toBeDefined();
    expect(literalesDe(reglas!).some((l) => l.includes("Comisión de Calibra"))).toBe(true);
    expect(literalesDe(servidor!)).toContain("mis_desembolsos");
    // La pantalla pinta esas cifras: la carpeta existe y el escáner la reconoce como propia.
    expect(archivos.some((a) => a.ruta === "src/app/monitor/desembolsos/page.tsx")).toBe(true);
    expect(esPropio("src/app/monitor/desembolsos/page.tsx")).toBe(true);
  });

  it("control positivo: las reglas D y E ven lo que vigilan en el motor de plazos y en las consultas reales", () => {
    // El motor define las funciones de la comisión: el escáner las ve (y por eso la regla D importa de verdad).
    const motor = archivos.find((a) => a.ruta === "src/lib/plazos/motor.ts")!;
    expect(revisar({ ruta: "src/lib/otra/copia-del-motor.ts", texto: motor.texto }).some((h) => h.regla === "D")).toBe(true);
    // Hay consultas reales a `desembolso` y piden columnas: la regla E las recorre sin señalarlas.
    const consultas = archivos.filter((a) => a.texto.includes('.from("desembolso")'));
    expect(consultas.length).toBeGreaterThan(0);
    for (const consulta of consultas) expect(revisar(consulta).filter((h) => h.regla === "E"), consulta.ruta).toEqual([]);
  });

  it("control positivo (HU-096): el texto de la regla general del registro vive en src/lib/plazos/regla-general.ts, y el registro y los correos no dicen la palabra", () => {
    const regla = archivos.find((a) => a.ruta === "src/lib/plazos/regla-general.ts");
    expect(regla, "falta src/lib/plazos/regla-general.ts").toBeDefined();
    expect(literalesDe(regla!).some((l) => /comisi[oó]n/i.test(l))).toBe(true);
    expect(revisar(regla!)).toEqual([]);
    // La página y el formulario del registro solo reciben el texto armado: ningún literal suyo dice comisión ni bruto.
    const delRegistro = archivos.filter((a) => a.ruta.startsWith("src/app/(cuentas)/monitores/registro/"));
    expect(delRegistro.map((a) => a.ruta)).toContain("src/app/(cuentas)/monitores/registro/page.tsx");
    for (const a of delRegistro) expect(revisar(a), a.ruta).toEqual([]);
    // La página del registro sí la usa: si deja de hacerlo, la regla G vigila un nombre que ya no existe.
    const pagina = archivos.find((a) => a.ruta === USA_LA_REGLA_GENERAL)!;
    expect(pagina.texto).toContain("describirReglaDeComision");
    expect(revisar({ ruta: "src/app/monitor/agenda/page.tsx", texto: pagina.texto }).some((h) => h.regla === "G")).toBe(true);
    // Las plantillas de correo (invitacion_monitor incluida) existen y siguen limpias.
    const plantillas = archivos.find((a) => a.ruta === "src/lib/correo/plantillas.ts");
    expect(plantillas, "falta src/lib/correo/plantillas.ts").toBeDefined();
    expect(revisar(plantillas!)).toEqual([]);
  });

  const MALAS: [string, Fuente, Regla][] = [
    ["un literal «Comisión» en la agenda del monitor", { ruta: "src/app/monitor/agenda/x.tsx", texto: 'export const x = "Comisión";' }, "C"],
    ["«COMISIÓN» en mayúsculas", { ruta: "src/lib/admin/x.ts", texto: 'export const x = "COMISIÓN";' }, "C"],
    ["«comision» sin tilde", { ruta: "src/lib/admin/x.ts", texto: 'export const x = "comision";' }, "C"],
    ["«Neto y bruto» en un componente del admin", { ruta: "src/app/admin/x/Componente.tsx", texto: "export function X() { return <p>Neto y bruto</p>; }" }, "C"],
    ["un atributo de JSX con la palabra", { ruta: "src/app/admin/x/Componente.tsx", texto: 'export function X() { return <p title="la comisión">.</p>; }' }, "C"],
    ["la palabra en src/lib/correo/plantillas.ts (D-71 b, pregunta 2)", { ruta: "src/lib/correo/plantillas.ts", texto: 'export const t = "Calibra descuenta una comisión";' }, "C"],
    ["el mismo texto de la regla general copiado en la página del registro", { ruta: "src/app/(cuentas)/monitores/registro/page.tsx", texto: 'export const t = "Calibra descuenta una comisión del 10 %";' }, "C"],
    ["la regla general copiada en el formulario del registro (JSX)", { ruta: "src/app/(cuentas)/monitores/registro/FormularioRegistro.tsx", texto: "export function F() { return <p>Calibra descuenta una comisión</p>; }" }, "C"],
    ["la página del registro calculando la comisión", { ruta: "src/app/(cuentas)/monitores/registro/page.tsx", texto: "export const p = cargarParametrosComision;" }, "D"],
    ["una plantilla de correo con la palabra", { ruta: "src/lib/correo/x.ts", texto: "export const t = (n: number) => `Tu comisión es ${n}`;" }, "C"],
    ["la columna monto_bruto pedida en una consulta", { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("pago").select("id, monto_bruto");' }, "C"],
    ["la función de la comisión llamada por rpc", { ruta: "src/lib/admin/x.ts", texto: 'cliente.rpc("comision", { p_monto_bruto: 1 });' }, "C"],
    ["rpc(«mis_desembolsos») en la agenda", { ruta: "src/lib/agenda/x.ts", texto: 'cliente.rpc("mis_desembolsos");' }, "A"],
    ["mis_desembolsos en un archivo del propio módulo que no es el lector", { ruta: "src/lib/desembolsos/otro.ts", texto: 'cliente.rpc("mis_desembolsos");' }, "A"],
    ["un import relativo al módulo desde la agenda", { ruta: "src/lib/agenda/x.ts", texto: 'import { TEXTOS } from "../desembolsos/reglas";' }, "B"],
    ["un import con alias al lector desde una pantalla", { ruta: "src/app/monitor/x/page.tsx", texto: 'import { cargarMisDesembolsos } from "@/lib/desembolsos/servidor";' }, "B"],
    ["un import dinámico", { ruta: "src/app/monitor/x/page.tsx", texto: 'export async function f() { return await import("@/lib/desembolsos/reglas"); }' }, "B"],
    ["una reexportación", { ruta: "src/lib/agenda/x.ts", texto: 'export * from "@/lib/desembolsos/reglas";' }, "B"],
    ["un require", { ruta: "src/lib/agenda/x.ts", texto: 'const m = require("../desembolsos/reglas");' }, "B"],
    ["un import de tipo con import()", { ruta: "src/lib/agenda/x.ts", texto: 'export type T = import("@/lib/desembolsos/reglas").DesembolsoDelMonitor;' }, "B"],
    ["el componente de la tarjeta importado desde otra pantalla", { ruta: "src/app/monitor/agenda/page.tsx", texto: 'import { TarjetaDeDesembolso } from "../desembolsos/TarjetaDeDesembolso";' }, "B"],
    ["calcularComision importado en una pantalla", { ruta: "src/app/monitor/agenda/page.tsx", texto: 'import { calcularComision } from "@/lib/plazos/motor";' }, "D"],
    ["calcularMontoNeto por espacio de nombres", { ruta: "src/lib/admin/x.ts", texto: 'import * as motor from "@/lib/plazos/motor"; export const n = motor.calcularMontoNeto(1, p);' }, "D"],
    ["cargarParametrosComision en la pantalla de los desembolsos", { ruta: "src/app/monitor/desembolsos/page.tsx", texto: "export const p = cargarParametrosComision;" }, "D"],
    ['.from("desembolso").select("*")', { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("desembolso").select("*");' }, "E"],
    ['.from("desembolso").select()', { ruta: "src/lib/admin/x.ts", texto: 'await cliente.from("desembolso").select();' }, "E"],
    ['.from("desembolso").update(…).eq(…).select()', { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("desembolso").update({}).eq("id", 1).select();' }, "E"],
    ["un select con * entre otras columnas", { ruta: "src/lib/admin/x.ts", texto: 'cliente!.from("desembolso").select("id, *").single();' }, "E"],
    ['"use client" en el módulo', { ruta: "src/lib/desembolsos/x.ts", texto: '"use client";\nexport const x = 1;' }, "F"],
    ["la regla general importada en la agenda del monitor", { ruta: "src/app/monitor/agenda/page.tsx", texto: 'import { describirReglaDeComision } from "@/lib/plazos/regla-general";' }, "G"],
    ["la regla general importada con ruta relativa en una plantilla de correo", { ruta: "src/lib/correo/x.ts", texto: 'import { textoDeLaReglaDeComision } from "../plazos/regla-general";' }, "G"],
    ["la regla general por import dinámico en el formulario del registro", { ruta: "src/app/(cuentas)/monitores/registro/FormularioRegistro.tsx", texto: 'export async function f() { return import("@/lib/plazos/regla-general"); }' }, "G"],
    ["la función de la regla general recibida por otro camino", { ruta: "src/app/admin/x/page.tsx", texto: "export const t = m.textoDeLaReglaDeComision;" }, "G"],
    ["'use client' en la tarjeta de la pantalla", { ruta: "src/app/monitor/desembolsos/TarjetaDeDesembolso.tsx", texto: "'use client';\nexport function T() { return null; }" }, "F"],
  ];

  it.each(MALAS)("control negativo: señala %s", (_nombre, fuente, regla) => {
    expect(revisar(fuente).map((h) => h.regla)).toContain(regla);
  });

  const BUENAS: [string, Fuente][] = [
    ["la palabra en un comentario de línea", { ruta: "src/app/monitor/agenda/x.ts", texto: "// La comisión y el bruto no se muestran aquí.\nexport const x = 1;" }],
    ["la palabra en un comentario de bloque", { ruta: "src/lib/admin/x.ts", texto: "/** Nunca la comisión ni el bruto (CLAUDE.md). */\nexport const x = 1;" }],
    ["la palabra en un comentario dentro de JSX", { ruta: "src/app/admin/x/Componente.tsx", texto: "export function X() { return <p>{/* comisión */}Hola</p>; }" }],
    ["una variable que se llama comision, que no es un literal", { ruta: "src/lib/admin/x.ts", texto: "const comision = 5; export const x = comision;" }],
    ["el módulo de los desembolsos diciendo «Comisión»", { ruta: "src/lib/desembolsos/reglas.ts", texto: 'export const R = "Comisión de Calibra";' }],
    ["la pantalla de los desembolsos diciendo «bruto» y llamando al módulo", { ruta: "src/app/monitor/desembolsos/page.tsx", texto: 'import { R } from "@/lib/desembolsos/reglas"; export const x = "bruto";' }],
    ["el lector llamando a la función", { ruta: "src/lib/desembolsos/servidor.ts", texto: 'cliente.rpc("mis_desembolsos");' }],
    ["el módulo importando a su vecino con ruta relativa", { ruta: "src/lib/desembolsos/servidor.ts", texto: 'import { esSituacion } from "./reglas";' }],
    ["el motor de plazos diciendo «comisión» y calculándola", { ruta: "src/lib/plazos/motor.ts", texto: 'export function calcularComision() { return "comisión"; }' }],
    ["el módulo del admin que se parece en el nombre", { ruta: "src/lib/admin/x.ts", texto: 'import { cargarDesembolso } from "@/lib/admin/desembolsos";' }],
    ["una carpeta de otro lado que empieza igual", { ruta: "src/lib/agenda/x.ts", texto: 'import { x } from "../desembolsos-otros/reglas";' }],
    ["un paquete cualquiera", { ruta: "src/lib/agenda/x.ts", texto: 'import { x } from "desembolsos";' }],
    ['.from("desembolso") pidiendo columnas', { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("desembolso").select("id, estado, monto_neto");' }],
    ['.from("pago").select("*"), que no es la tabla vigilada', { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("pago").select("*");' }],
    ["la página del registro usando la regla general", { ruta: "src/app/(cuentas)/monitores/registro/page.tsx", texto: 'import { describirReglaDeComision } from "@/lib/plazos/regla-general"; export const t = describirReglaDeComision;' }],
    ["otro módulo del motor de plazos usando la regla general", { ruta: "src/lib/plazos/x.ts", texto: 'import { textoDeLaReglaDeComision } from "./regla-general";' }],
    ["un import del motor de plazos que no es la regla general", { ruta: "src/app/monitor/agenda/page.tsx", texto: 'import { x } from "@/lib/plazos/regla-general-otra";' }],
    ["un select de todo en una cadena que no nace en desembolso", { ruta: "src/lib/admin/x.ts", texto: 'cliente.from("monitoria").select("*, desembolso(id)");' }],
  ];

  it.each(BUENAS)("control negativo: no señala %s", (_nombre, fuente) => {
    expect(revisar(fuente)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G4. La excepción está nombrada
// ---------------------------------------------------------------------------

describe("CLAUDE.md y el README nombran la excepción de la comisión (D-59, G4)", () => {
  // Es frágil a propósito: reescribir la frase obliga a mirar la excepción.
  it.each(["CLAUDE.md", "README.md"])("%s dice dónde sí se muestra la comisión y de qué decisión sale", (nombre) => {
    const lineas = readFileSync(join(RAIZ, nombre), "utf8")
      .split(/\r?\n/)
      .filter((linea) => /nunca mostrar cifras de comisi[oó]n/i.test(linea));
    expect(lineas, `${nombre}: la regla de las cifras de comisión`).toHaveLength(1);
    expect(lineas[0], nombre).toContain("/monitor/desembolsos");
    expect(lineas[0], nombre).toContain("D-59");
  });
});
