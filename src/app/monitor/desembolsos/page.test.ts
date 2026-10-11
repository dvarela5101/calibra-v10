import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesembolsoDelMonitor, Situacion } from "@/lib/desembolsos/reglas";
import type { MisDesembolsos } from "@/lib/desembolsos/servidor";
import estilos from "./desembolsos.module.css";
import MisDesembolsosPagina, { metadata } from "./page";

// Sin navegador ni base: la página de los desembolsos con la sesión y la carga inventadas, y se lee el HTML. Aquí se
// fija qué ve el monitor en cada situación (criterios 1 y 3 a 15) y que no se escapa nada más. El recorrido con la
// base lo cubren la integración y la e2e.

const YO = "a0a0a0a0-0000-4000-8000-000000000050";
const id = (n: number) => `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, "0")}`;

const rutas = vi.hoisted(() => ({ pedidas: [] as string[], orden: [] as string[], idsPedidos: [] as string[] }));
const datos = vi.hoisted(() => ({ carga: { desembolsos: [], llaveActual: null } as MisDesembolsos, falla: null as unknown }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.orden.push("exigirRol");
    rutas.pedidas.push(`${_rol} ${ruta}`);
    return { idUsuario: YO, rol: "monitor" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: async () => {
    rutas.orden.push("cliente");
    return {};
  },
}));
vi.mock("@/lib/desembolsos/servidor", () => ({
  cargarMisDesembolsos: async (_cliente: unknown, idUsuario: string) => {
    rutas.orden.push("cargar");
    rutas.idsPedidos.push(idUsuario);
    if (datos.falla) throw datos.falla;
    return datos.carga;
  },
}));

/** 11:00 a. m. en Bogotá del 30 de diciembre de 2031. */
const DESDE = new Date("2031-12-30T16:00:00.000Z");

function desembolso(n: number, cambios: Partial<DesembolsoDelMonitor> = {}): DesembolsoDelMonitor {
  return {
    idDesembolso: id(n),
    fecha: "2031-12-01",
    hora: "10:00:00",
    duracionMin: 60,
    nombreMateria: "Cálculo Diferencial",
    situacion: "listo",
    desembolsableDesde: null,
    montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
    llaveDestino: "llave-m-50",
    referencia: null,
    diaDeTransferencia: null,
    ...cambios,
  };
}

const transferido = (n: number, cambios: Partial<DesembolsoDelMonitor> = {}) =>
  desembolso(n, {
    situacion: "transferido",
    montos: { bruto: 18_000, comision: 1_800, neto: 16_200 },
    referencia: `REF-50-${String(n).padStart(2, "0")}`,
    diaDeTransferencia: "2031-12-30",
    ...cambios,
  });

const anulado = (n: number, cambios: Partial<DesembolsoDelMonitor> = {}) =>
  desembolso(n, { situacion: "anulado", montos: null, llaveDestino: null, ...cambios });

async function pintar(desembolsos: DesembolsoDelMonitor[], llaveActual: string | null = "llave-m-50"): Promise<string> {
  datos.carga = { desembolsos, llaveActual };
  return renderToStaticMarkup(await MisDesembolsosPagina());
}

/**
 * El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). Los comentarios que React
 * pone entre textos vecinos y las etiquetas que van dentro de una frase (`a`, `time`) no parten el renglón.
 */
const texto = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<\/?(?:a|time)(?:\s[^>]*)?>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Cada tarjeta (`<li>`) de la página, ya como texto. */
const tarjetas = (html: string) => (html.match(/<li[\s>][\s\S]*?<\/li>/g) ?? []).map(texto);

const SITUACIONES_POR_TRANSFERIR: Situacion[] = ["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera"];

const porTransferir = (): DesembolsoDelMonitor[] =>
  SITUACIONES_POR_TRANSFERIR.map((situacion, i) =>
    desembolso(i + 1, { situacion, fecha: `2031-12-0${i + 1}`, desembolsableDesde: situacion === "en_plazo" ? DESDE : null }),
  );

beforeEach(() => {
  rutas.pedidas = [];
  rutas.orden = [];
  rutas.idsPedidos = [];
  datos.falla = null;
  datos.carga = { desembolsos: [], llaveActual: null };
  vi.stubEnv("CORREO_DATOS_PERSONALES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Mis desembolsos (HU-050): la sesión y el error", () => {
  it("pide el rol de monitor antes de abrir el cliente y de leer nada, y lee con el id de la sesión", async () => {
    await pintar([desembolso(1)]);
    expect(rutas.pedidas).toEqual(["monitor /monitor/desembolsos"]);
    expect(rutas.orden).toEqual(["exigirRol", "cliente", "cargar"]);
    expect(rutas.idsPedidos).toEqual([YO]);
  });

  it("no tiene formularios ni botones: es solo una lista", async () => {
    const html = await pintar([...porTransferir(), transferido(6), anulado(7)]);
    expect(html).not.toMatch(/<form|<button|<input|<textarea|<select/);
  });

  it("el título de la pestaña", () => {
    expect(metadata.title).toBe("Mis desembolsos · Calibra");
  });

  it("si la lectura falla, dice que no pudo cargar, con role=alert y el enlace de vuelta, y no pinta una lista vacía", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    datos.falla = new Error("No se pudo leer los desembolsos: 42501 sin permiso");
    const html = renderToStaticMarkup(await MisDesembolsosPagina());
    expect(html).toMatch(/<p role="alert"[^>]*>No pudimos cargar tus desembolsos\. Recarga la página; si sigue igual, avisa al equipo\.<\/p>/);
    expect(html).toMatch(/<a [^>]*href="\/monitor"[^>]*>Volver a mi panel<\/a>/);
    const t = texto(html);
    expect(t).not.toContain("Todavía no tienes desembolsos");
    expect(t).not.toContain("Ninguno por ahora");
    expect(t).not.toContain("Por transferir");
    // El log lleva solo el mensaje.
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[desembolsos] no se pudo cargar:", "No se pudo leer los desembolsos: 42501 sin permiso");
  });

  it("si lo que se lanzó no es un Error, lo registra tal cual y pinta el mismo error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    datos.falla = "se cayó";
    const html = renderToStaticMarkup(await MisDesembolsosPagina());
    expect(html).toContain('role="alert"');
    expect(log).toHaveBeenCalledWith("[desembolsos] no se pudo cargar:", "se cayó");
  });
});

describe("Mis desembolsos: los grupos (criterios 1, 13 y 15)", () => {
  it("sin desembolsos dice cómo aparece el primero y no pinta grupos", async () => {
    const html = await pintar([]);
    expect(html).toMatch(/<p role="status"[^>]*>Todavía no tienes desembolsos\. Aparece uno cuando una monitoría tuya queda realizada\.<\/p>/);
    expect(html).toMatch(/<a [^>]*href="\/monitor"[^>]*>Volver a mi panel<\/a>/);
    expect(html).not.toContain("<section");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("Ninguno por ahora");
  });

  it("pinta Por transferir y Transferidos con su conteo, y Anulados solo si hay alguno", async () => {
    const conAnulado = texto(await pintar([...porTransferir(), transferido(6), transferido(7), anulado(8)]));
    expect(conAnulado).toContain("Por transferir (5)");
    expect(conAnulado).toContain("Transferidos (2)");
    expect(conAnulado).toContain("Anulados (1)");
    const sinAnulado = texto(await pintar([...porTransferir(), transferido(6)]));
    expect(sinAnulado).toContain("Por transferir (5)");
    expect(sinAnulado).toContain("Transferidos (1)");
    expect(sinAnulado).not.toContain("Anulados");
  });

  it("los grupos salen en este orden: Por transferir, Transferidos, Anulados", async () => {
    const html = await pintar([anulado(8), transferido(6), ...porTransferir()]);
    const orden = ["Por transferir (5)", "Transferidos (1)", "Anulados (1)"].map((titulo) => html.indexOf(titulo));
    expect(orden.every((posicion) => posicion > -1)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("un grupo sin desembolsos dice «Ninguno por ahora.»", async () => {
    const soloTransferido = await pintar([transferido(6)]);
    expect(soloTransferido).toMatch(/<h2[^>]*>Por transferir \(0\)<\/h2><p class="[^"]*">Ninguno por ahora\.<\/p>/);
    const soloPorTransferir = await pintar([desembolso(1)]);
    expect(soloPorTransferir).toMatch(/<h2[^>]*>Transferidos \(0\)<\/h2><p class="[^"]*">Ninguno por ahora\.<\/p>/);
    expect(texto(await pintar([anulado(8)]))).toContain("Anulados (1)");
  });

  it("cada tarjeta lleva el día con su semana, la hora de inicio a la de fin, la materia y la duración", async () => {
    const [tarjeta] = tarjetas(await pintar([desembolso(1, { fecha: "2031-12-01", hora: "10:00:00", duracionMin: 90 })]));
    expect(tarjeta).toContain("Lunes, 1 de diciembre, 10:00 a 11:30");
    expect(tarjeta).toContain("Cálculo Diferencial · 90 min");
  });

  it("el día de la sesión va en <time dateTime> con la fecha de Bogotá que trae la base", async () => {
    expect(await pintar([desembolso(1, { fecha: "2031-12-01" })])).toMatch(/<time dateTime="2031-12-01">Lunes, 1 de diciembre<\/time>/);
  });

  it("por transferir: del día más viejo al más reciente", async () => {
    const t = texto(await pintar([desembolso(1, { fecha: "2031-12-15" }), desembolso(2, { fecha: "2031-12-01" }), desembolso(3, { fecha: "2031-12-08" })]));
    expect([t.indexOf("1 de diciembre"), t.indexOf("8 de diciembre"), t.indexOf("15 de diciembre")].every((p) => p > -1)).toBe(true);
    expect(t.indexOf("1 de diciembre")).toBeLessThan(t.indexOf("8 de diciembre"));
    expect(t.indexOf("8 de diciembre")).toBeLessThan(t.indexOf("15 de diciembre"));
  });

  it("transferidos: del más reciente al más viejo por día de transferencia", async () => {
    const html = await pintar([
      transferido(1, { diaDeTransferencia: "2031-12-10", referencia: "REF-VIEJA" }),
      transferido(2, { diaDeTransferencia: "2031-12-30", referencia: "REF-NUEVA" }),
    ]);
    expect(html.indexOf("REF-NUEVA")).toBeGreaterThan(-1);
    expect(html.indexOf("REF-NUEVA")).toBeLessThan(html.indexOf("REF-VIEJA"));
  });

  it("10 transferidos se ven todos; con 11, el más viejo queda detrás de «Ver 1 desembolso más»", async () => {
    const lista = (cuantos: number) =>
      Array.from({ length: cuantos }, (_, i) => transferido(i + 1, { diaDeTransferencia: `2031-12-${String(30 - i).padStart(2, "0")}`, referencia: `REF-N-${i + 1}` }));
    const diez = await pintar(lista(10));
    expect(diez).not.toContain("<details");
    expect(texto(diez)).not.toContain("Ver ");

    const once = await pintar(lista(11));
    expect(once).toMatch(/<details[^>]*><summary[^>]*>Ver 1 desembolso más<\/summary>/);
    const dentro = once.slice(once.indexOf("<details"), once.indexOf("</details>"));
    const fuera = once.slice(0, once.indexOf("<details"));
    // Los 10 más recientes (REF-N-1 a REF-N-10) están a la vista; el más viejo (REF-N-11), adentro.
    for (let i = 1; i <= 10; i++) expect(fuera, `REF-N-${i}`).toContain(`REF-N-${i}<`);
    expect(fuera).not.toContain("REF-N-11<");
    expect(dentro).toContain("REF-N-11<");
    expect(once.indexOf("<details")).toBeGreaterThan(once.indexOf("Transferidos (11)"));
  });

  it("con 25 transferidos el resumen cuenta los 15 que quedan", async () => {
    const lista = Array.from({ length: 25 }, (_, i) => transferido(i + 1, { diaDeTransferencia: `2031-11-${String(25 - i).padStart(2, "0")}` }));
    expect(await pintar(lista)).toMatch(/<summary[^>]*>Ver 15 desembolsos más<\/summary>/);
  });

  it("ningún otro grupo se parte: 11 por transferir se ven todos", async () => {
    const lista = Array.from({ length: 11 }, (_, i) => desembolso(i + 1, { fecha: `2031-12-${String(i + 1).padStart(2, "0")}` }));
    const html = await pintar(lista);
    expect(html).not.toContain("<details");
    expect(tarjetas(html)).toHaveLength(11);
  });
});

describe("Mis desembolsos: cada situación (criterios 3 a 9)", () => {
  const TRES_CIFRAS = ["$ 37.000", "$ 3.700", "$ 33.300"];

  /** Las cifras de dinero que hay en un texto. */
  const pesosDe = (t: string) => t.match(/\$ ?[\d.]+/g) ?? [];

  it("en plazo: dice después de qué día y a qué hora (Bogotá) se puede transferir, con las tres cifras estimadas", async () => {
    const [t] = tarjetas(await pintar([desembolso(1, { situacion: "en_plazo", desembolsableDesde: DESDE })]));
    expect(t).toContain("Se puede transferir después del 30 de diciembre de 2031 a las 11:00 a. m.");
    expect(t).not.toContain("a. m..");
    expect(pesosDe(t)).toEqual(TRES_CIFRAS);
  });

  it("en plazo, cerca de la medianoche: las 22:00 del 30 en Bogotá no son el 31", async () => {
    const [t] = tarjetas(await pintar([desembolso(1, { situacion: "en_plazo", desembolsableDesde: new Date("2031-12-31T03:00:00.000Z") })]));
    expect(t).toContain("Se puede transferir después del 30 de diciembre de 2031 a las 10:00 p. m.");
  });

  it("listo: dice que un admin lo transfiere a su llave, sin prometer un día", async () => {
    const [t] = tarjetas(await pintar([desembolso(1, { situacion: "listo" })]));
    expect(t).toContain("Listo para transferir. Un admin lo transfiere a tu llave.");
    expect(t).not.toMatch(/Se puede transferir después/);
    expect(pesosDe(t)).toEqual(TRES_CIFRAS);
  });

  it("pago en revisión y pago rechazado: «En espera» y nombra el pago", async () => {
    const [enRevision] = tarjetas(await pintar([desembolso(1, { situacion: "pago_en_revision" })]));
    expect(enRevision).toContain("En espera: un pago de esta monitoría sigue en revisión.");
    const [rechazado] = tarjetas(await pintar([desembolso(1, { situacion: "pago_rechazado" })]));
    expect(rechazado).toContain("En espera: Calibra está resolviendo un pago rechazado de esta monitoría.");
  });

  it("en espera por cualquier otra razón: dice que Calibra tiene que resolver algo, sin «reporte» ni «inasistencia» (D-59 b)", async () => {
    const html = await pintar([desembolso(1, { situacion: "en_espera" })]);
    const [t] = tarjetas(html);
    expect(t).toContain("En espera: Calibra tiene que resolver algo de esta monitoría antes de transferir.");
    expect(t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()).not.toMatch(/reporte|inasisten/);
    // Ni la página entera, que es la de un monitor que solo tiene este desembolso.
    expect(texto(html).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()).not.toMatch(/reporte|inasisten/);
  });

  it("transferido: el día de la transferencia, la referencia, la llave copiada y los montos finales, sin «Estimado»", async () => {
    const [t] = tarjetas(
      await pintar([transferido(9, { referencia: "REF-50-09", llaveDestino: "llave-m-50-anterior", diaDeTransferencia: "2031-12-30" })]),
    );
    expect(t).toContain("Transferido el 30 de diciembre de 2031.");
    expect(t).toContain("Referencia: REF-50-09");
    expect(t).toContain("Llave: llave-m-50-anterior");
    expect(pesosDe(t)).toEqual(["$ 18.000", "$ 1.800", "$ 16.200"]);
    expect(t).not.toMatch(/estimado/i);
    expect(t).not.toContain("Los montos se confirman");
  });

  it("transferido: pinta la llave que quedó copiada, no la que el monitor tiene hoy, y no avisa de ningún cambio", async () => {
    const html = await pintar([transferido(9, { llaveDestino: "llave-copiada-1" })], "llave-actual-2");
    expect(html).toContain("llave-copiada-1");
    expect(html).not.toContain("llave-actual-2");
    expect(texto(html)).not.toContain("Cambiaste tu llave");
  });

  it("anulado: dice por qué y que no se transfiere, sin montos ni llave", async () => {
    const html = await pintar([anulado(8, { llaveDestino: "llave-del-anulado" })]);
    const [t] = tarjetas(html);
    expect(t).toContain("Anulado: la monitoría se canceló porque se aceptó un reporte de inasistencia. No se transfiere.");
    expect(pesosDe(t)).toEqual([]);
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("llave-del-anulado");
    expect(t).not.toMatch(/Total de la monitoría|Comisión|Te transferimos|Estimado|Llave|Referencia/);
  });

  it("el anulado no recibe montos aunque el objeto los traiga", async () => {
    const html = await pintar([anulado(8, { montos: { bruto: 99_999, comision: 9_999, neto: 90_000 }, llaveDestino: "llave-del-anulado" })]);
    expect(html).not.toContain("99.999");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("llave-del-anulado");
  });
});

describe("Mis desembolsos: el color de la situación (criterios 7, 8 y 16)", () => {
  /** Las clases de cada `<span>` que es la frase de la situación (la que lleva la clase `situacion`), una lista por frase. */
  const frasesDeSituacion = (html: string): string[][] =>
    [...html.matchAll(/<span class="([^"]*)">/g)].map(([, clases]) => clases.split(/\s+/)).filter((clases) => clases.includes(estilos.situacion));

  it("control: el módulo de estilos da un nombre distinto a cada clase que la tarjeta usa para destacar", () => {
    const nombres = [estilos.situacion, estilos.transferido, estilos.anulado, estilos.neto, estilos.fila];
    expect(nombres.every(Boolean)).toBe(true);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("el transferido lleva la clase del verde de texto y el anulado la del rojo de texto; las demás situaciones, ninguna de las dos", async () => {
    for (const d of [...porTransferir(), transferido(6), anulado(7)]) {
      const frases = frasesDeSituacion(await pintar([d]));
      expect(frases, `${d.situacion}: una sola frase de situación`).toHaveLength(1);
      expect(frases[0].includes(estilos.transferido), `${d.situacion}: verde`).toBe(d.situacion === "transferido");
      expect(frases[0].includes(estilos.anulado), `${d.situacion}: rojo`).toBe(d.situacion === "anulado");
    }
  });
});

describe("Mis desembolsos: las tres cifras (criterio 9, D-59 a)", () => {
  it("en cada situación con monto: total, comisión y neto, en este orden, con los valores exactos y ninguna otra cifra", async () => {
    for (const situacion of SITUACIONES_POR_TRANSFERIR) {
      const html = await pintar([desembolso(1, { situacion, desembolsableDesde: situacion === "en_plazo" ? DESDE : null })]);
      const orden = [
        "Estimado: total de la monitoría",
        "$ 37.000",
        "Estimado: comisión de Calibra",
        "$ 3.700",
        "Estimado: te transferimos",
        "$ 33.300",
      ].map((fragmento) => texto(html).indexOf(fragmento));
      expect(orden.every((posicion) => posicion > -1), situacion).toBe(true);
      expect([...orden].sort((a, b) => a - b), situacion).toEqual(orden);
      expect(texto(html).match(/\$ ?[\d.]+/g), situacion).toEqual(["$ 37.000", "$ 3.700", "$ 33.300"]);
    }
  });

  it("las cifras van en una lista de definiciones, con el neto en el último renglón", async () => {
    const html = await pintar([desembolso(1)]);
    const filas = html.match(/<div class="[^"]*"><dt[^>]*>[^<]*<\/dt><dd[^>]*>[^<]*<\/dd><\/div>/g) ?? [];
    expect(filas.map(texto)).toEqual(["Estimado: total de la monitoría $ 37.000", "Estimado: comisión de Calibra $ 3.700", "Estimado: te transferimos $ 33.300"]);
    expect(html).toMatch(/<dl[^>]*>/);
  });

  it("la cifra que se transfiere es la única con el destaque del neto (negrita y más grande), en cada situación con monto", async () => {
    // El nombre de cada clase sale del mismo módulo de estilos que usa la tarjeta, así que la prueba no depende de cómo se escriba el nombre.
    expect(estilos.neto).toBeTruthy();
    expect(estilos.neto).not.toBe(estilos.fila);
    for (const d of [...porTransferir(), transferido(6)]) {
      const filas = [...(await pintar([d])).matchAll(/<div class="([^"]*)"><dt/g)].map(([, clases]) => clases.split(/\s+/));
      expect(filas, d.situacion).toHaveLength(3);
      expect(filas.map((clases) => clases.includes(estilos.fila)), `${d.situacion}: las tres son filas`).toEqual([true, true, true]);
      expect(filas.map((clases) => clases.includes(estilos.neto)), `${d.situacion}: solo la última es el neto`).toEqual([false, false, true]);
    }
  });

  it("un por transferir lo dice: son estimados y se confirman al transferir", async () => {
    const t = texto(await pintar(porTransferir()));
    expect(t.match(/Los montos se confirman cuando un admin hace la transferencia\./g)).toHaveLength(5);
    expect(t.match(/Estimado: total de la monitoría/g)).toHaveLength(5);
  });

  it("un transferido no lleva «Estimado» ni la línea de confirmación", async () => {
    const t = texto(await pintar([transferido(6)]));
    expect(t).toContain("Total de la monitoría");
    expect(t).toContain("Comisión de Calibra");
    expect(t).toContain("Te transferimos");
    expect(t).not.toMatch(/estimado|se confirman/i);
  });

  it("con bruto 0 no pinta tres ceros: dice que todavía no hay un monto", async () => {
    const html = await pintar([desembolso(1, { situacion: "pago_en_revision", montos: { bruto: 0, comision: 0, neto: 0 } })]);
    const [t] = tarjetas(html);
    expect(t).toContain("En espera: un pago de esta monitoría sigue en revisión.");
    expect(t).toContain("Todavía no hay un monto para transferir.");
    expect(t).not.toContain("$");
    expect(t).not.toMatch(/Estimado|Comisión|Te transferimos|Los montos se confirman/);
    expect(html).not.toContain("<dl");
  });

  it("los pesos llevan el formato del resto de la app", async () => {
    const html = await pintar([desembolso(1, { montos: { bruto: 200_000, comision: 15_000, neto: 185_000 } })]);
    expect(texto(html)).toMatch(/\$ 200\.000.*\$ 15\.000.*\$ 185\.000/);
  });
});

describe("Mis desembolsos: la llave que cambió (criterio 11, HU-013)", () => {
  const CAMBIO = "Cambiaste tu llave después de esta monitoría. Los pagos que ya estaban en camino siguen yendo a la anterior: llave-anterior.";

  it("con el correo configurado dice a cuál llave se transfiere y a quién escribir, con un enlace mailto", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.test");
    const html = await pintar([desembolso(1, { llaveDestino: "llave-anterior" })], "llave-nueva");
    expect(texto(html)).toContain(`${CAMBIO} Si esa llave ya no sirve, escribe a soporte@calibra.test.`);
    expect(html).toMatch(/<a [^>]*href="mailto:soporte@calibra\.test"[^>]*>soporte@calibra\.test<\/a>/);
  });

  it("sin el correo configurado omite esa línea y no pinta ningún enlace de correo", async () => {
    const html = await pintar([desembolso(1, { llaveDestino: "llave-anterior" })], "llave-nueva");
    const t = texto(html);
    expect(t).toContain(CAMBIO);
    expect(t).not.toContain("Si esa llave ya no sirve");
    expect(html).not.toContain("mailto:");
  });

  it("si la llave es la misma, no avisa de nada", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.test");
    const html = await pintar([desembolso(1, { llaveDestino: "llave-m-50" })], "llave-m-50");
    expect(texto(html)).not.toContain("Cambiaste tu llave");
    expect(html).not.toContain("mailto:");
  });

  it("si no se sabe la llave de hoy, no avisa de nada", async () => {
    expect(texto(await pintar([desembolso(1, { llaveDestino: "llave-anterior" })], null))).not.toContain("Cambiaste tu llave");
  });

  it("el aviso va solo en las tarjetas que se van a transferir, no en las transferidas ni en las anuladas", async () => {
    const lista = [desembolso(1, { llaveDestino: "llave-anterior" }), transferido(2, { llaveDestino: "llave-anterior" }), anulado(3)];
    const conAviso = tarjetas(await pintar(lista, "llave-nueva")).filter((t) => t.includes("Cambiaste tu llave"));
    expect(conAviso).toHaveLength(1);
    expect(conAviso[0]).toContain("Listo para transferir");
  });
});

describe("Mis desembolsos: lo que no se ve (criterio 12, P-37)", () => {
  it("escapa la referencia y la llave que escribió una persona", async () => {
    const html = await pintar([transferido(1, { referencia: '<script>alert("x")</script>', llaveDestino: "<img src=x onerror=alert(1)>" })]);
    expect(html).not.toContain("<script>alert");
    // El logo de la marca sí es un <img>: se busca el que escribió la persona.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });

  it("un objeto con campos de más no los lleva al HTML (id del admin, estudiante, pagador, contacto, motivo, foto)", async () => {
    const intruso = {
      ...porTransferir()[1],
      idAdmin: "ADMIN-ID-SECRETO",
      nombreAdmin: "Admin Secreto",
      nombreEstudiante: "Estudiante Secreto",
      nombrePagador: "Pagador Secreto",
      contacto: "3009998888",
      correoEstudiante: "estudiante@secreto.test",
      motivo: "con_reporte",
      motivos: ["caso_abierto", "pagos_en_revision", "sin_pagos_aprobados", "no_realizada"],
      montoFoto: 25_000,
      montoDeUnPago: 12_345,
    };
    const html = await pintar([intruso as DesembolsoDelMonitor]);
    for (const valor of ["ADMIN-ID-SECRETO", "Admin Secreto", "Estudiante Secreto", "Pagador Secreto", "3009998888", "estudiante@secreto.test", "con_reporte", "caso_abierto", "pagos_en_revision", "sin_pagos_aprobados", "no_realizada", "25.000", "12.345"]) {
      expect(html, valor).not.toContain(valor);
    }
  });

  it("el HTML de una pantalla con todas las situaciones no trae ningún motivo interno ni el nombre de la situación", async () => {
    const html = await pintar([
      ...porTransferir(),
      transferido(6),
      anulado(7),
    ]);
    for (const palabra of ["con_reporte", "caso_abierto", "pagos_en_revision", "sin_pagos_aprobados", "no_realizada", "en_plazo", "pago_en_revision", "pago_rechazado", "en_espera"]) {
      expect(html, palabra).not.toContain(palabra);
    }
  });

  it("solo la tarjeta anulada dice «reporte» o «inasistencia»", async () => {
    const hablan = tarjetas(await pintar([...porTransferir(), transferido(6), anulado(7)])).filter((t) => /reporte|inasistencia/i.test(t));
    expect(hablan).toHaveLength(1);
    expect(hablan[0]).toContain("Anulado:");
  });
});
