import { join } from "node:path";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { dibujarTexto } from "../src/components/contenido/dibujar";
import { partirEnunciado } from "../src/lib/contenido/enunciado";
import { leerMate } from "../src/lib/contenido/leer";
import { intentarAnalizar, partirMate } from "../src/lib/contenido/mate";
import { EJEMPLO_POR_COMANDO, FORMULAS_ANIDADAS } from "../pruebas/ejemplos-mate";
import { leerBanco } from "../scripts/contenido/banco.mts";

// HU-083: fórmulas y código del banco de preguntas, medidos en un navegador (los criterios de pantalla: apilado de la
// fracción, 14 px, scroll del bloque, teclado). La lógica de texto está en src/lib/contenido/*.test.ts.
//
// Ninguna pantalla muestra todavía preguntas (HU-009, HU-022 y HU-039), así que la prueba fabrica su página: toma las hojas de
// estilo COMPILADAS de la página pública (`/`, con lo que importa layout.tsx: tokens, globals y contenido.css) y arma el
// interior con el componente real (`dibujarTexto`, el mismo que usa TextoDelBanco). La sirve con page.route en la misma
// dirección de la app, así que `/_next/static/...` (CSS y fuentes) carga del servidor de verdad. No hay ninguna ruta de
// prueba en src/app. El archivo es .ts y no .tsx a propósito: Playwright compila un .tsx con su propio runtime de JSX y React
// no dibuja lo que sale.
//
// Corre en `movil` (390×844) y en `escritorio` (1280×800), como todas. html y body llevan `overflow-x: hidden`
// (globals.css): scrollWidth del documento nunca delata un desborde, así que se mide cada elemento.

const RUTA = "/__prueba/texto-del-banco";
const RAIZ_CONTENIDO = join(__dirname, "../contenido");

const escaparAtributo = (texto: string) => texto.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Lo que el banco tiene hoy: los textos que ve una persona y las fórmulas y los bloques de código que traen. */
function delBanco() {
  const { banco } = leerBanco(RAIZ_CONTENIDO);
  const textos: string[] = [];
  /** Las opciones de respuesta que llevan alguna fórmula (en HU-009 cada una es un radio que necesita nombre). */
  const opciones: string[] = [];
  for (const materia of banco.materias) {
    for (const tema of materia.temas) {
      for (const h of tema.habilidades) textos.push(h.descripcion);
      for (const m of tema.misconcepciones) textos.push(m.descripcion);
      for (const p of tema.preguntas) {
        textos.push(p.enunciado);
        for (const o of p.opciones) {
          textos.push(o.texto);
          if (partirMate(o.texto).some((parte) => parte.mate && !parte.abierto)) opciones.push(o.texto);
          if (o.error) textos.push(o.error);
        }
        if (p.solucion) textos.push(p.solucion);
      }
    }
  }
  const formulas: string[] = [];
  const bloques: { enunciado: string; programa: string }[] = [];
  for (const texto of textos) {
    for (const trozo of partirEnunciado(texto)) {
      if (trozo.codigo) bloques.push({ enunciado: texto, programa: trozo.texto });
      else for (const parte of partirMate(trozo.texto)) if (parte.mate && !parte.abierto) formulas.push(parte.texto);
    }
  }
  return { formulas, bloques, opciones };
}

/** Lo que dice el nombre accesible de un texto del banco: la prosa tal cual y cada fórmula con su lectura. */
function nombreEsperado(texto: string): string {
  return partirMate(texto)
    .map((trozo) => {
      if (!trozo.mate) return trozo.texto;
      const analisis = trozo.abierto ? null : intentarAnalizar(trozo.texto);
      return analisis?.ok ? leerMate(analisis.arbol) : `$${trozo.texto}${trozo.abierto ? "" : "$"}`;
    })
    .join("");
}

/**
 * Abre una página con las hojas de estilo de la pública y `interior` dentro de una columna como la de las pantallas
 * (`--col` y `--pad-x`). El `<html>` lleva los mismos atributos que el de la app (idioma y variables de fuente).
 */
async function abrir(page: Page, request: APIRequestContext, interior: string): Promise<void> {
  const inicio = await request.get("/");
  expect(inicio.ok(), "la página pública responde").toBe(true);
  const marcado = await inicio.text();
  const atributosHtml = /<html([^>]*)>/.exec(marcado)?.[1] ?? "";
  const hojas = [...marcado.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>|<style\b[\s\S]*?<\/style>/g)].map((m) => m[0]);
  expect(hojas.length, "la página pública trae sus hojas de estilo").toBeGreaterThan(0);
  const documento =
    `<!DOCTYPE html><html${atributosHtml}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Texto del banco</title>${hojas.join("")}</head><body>` +
    `<main id="prueba" style="max-inline-size:var(--col);padding-inline:var(--pad-x);margin-inline:auto">${interior}</main></body></html>`;
  await page.route(`**${RUTA}`, (ruta) => ruta.fulfill({ contentType: "text/html; charset=utf-8", body: documento }));
  await page.goto(RUTA);
  await expect(page.locator("#prueba")).toBeVisible();
}

const dibujar = (texto: string) => renderToStaticMarkup(dibujarTexto(texto));

/**
 * Descarga Noto Sans Math, la de src/app/fuentes que carga layout.tsx con next/font, y dice cuántas caras bajó y en qué estado
 * quedaron. El nombre de familia lo inventa el empaquetador (`notoSansMath` con Turbopack, uno con hash con webpack), así que se
 * lee de `--fuente-math` en el `<html>`, la variable que usa contenido.css, en vez de escribirlo aquí.
 */
async function cargarFuenteDeMate(page: Page): Promise<{ familia: string; caras: number; estados: string[] }> {
  return page.evaluate(async () => {
    const familia = getComputedStyle(document.documentElement).getPropertyValue("--fuente-math").trim().replace(/^["']|["']$/g, "");
    if (!familia) return { familia, caras: 0, estados: [] };
    const caras = await document.fonts.load(`16px "${familia}"`);
    return { familia, caras: caras.length, estados: caras.map((cara) => cara.status) };
  });
}

/** Un `<p>` por texto, con su fuente en `data-fuente`. */
const parrafos = (textos: string[]) => textos.map((t) => `<p data-fuente="${escaparAtributo(t)}">${dibujar(t)}</p>`).join("");

/**
 * El rol y el nombre que Chromium expone en su árbol de accesibilidad (el que leería un lector de pantalla) para cada elemento que
 * cumple el selector, en el orden del documento. Solo Chromium, que es lo que corre aquí.
 */
async function nombresAccesibles(context: BrowserContext, page: Page, selector: string): Promise<{ rol: string; nombre: string }[]> {
  const sesion = await context.newCDPSession(page);
  await sesion.send("DOM.enable");
  await sesion.send("Accessibility.enable");
  const { root } = await sesion.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await sesion.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
  const nombres: { rol: string; nombre: string }[] = [];
  for (const nodeId of nodeIds) {
    const { nodes } = await sesion.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    nombres.push({ rol: String(nodes[0]?.role?.value ?? ""), nombre: String(nodes[0]?.name?.value ?? "") });
  }
  return nombres;
}

/**
 * Elementos que se salen de la ventana o cuyo contenido se sale de su caja. Copia adaptada de `medir` de
 * resolver-reportes.spec.ts: el `pre` queda fuera porque su scroll interno es legítimo (se prueba aparte), y una fórmula con
 * scroll propio también (ella y lo que lleva dentro: la parte que se sale está recortada y se alcanza desplazándola). Que una
 * fórmula del banco no necesite ese scroll lo comprueba su propio caso.
 */
async function desbordados(page: Page) {
  return page.evaluate(() => {
    const ancho = window.innerWidth;
    const conScroll = (math: Element | null) => math !== null && math.scrollWidth > math.clientWidth + 1;
    return [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        const caja = el.getBoundingClientRect();
        return caja.width > 0 && caja.height > 0 && !el.closest("pre") && !conScroll(el.closest("math"));
      })
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fuera = caja.right > ancho + 1 || caja.left < -1;
        const contenidoFuera = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
        return fuera || contenidoFuera
          ? [{ elemento: el.tagName.toLowerCase(), texto: (el.textContent ?? "").trim().slice(0, 40), izquierda: Math.round(caja.left), derecha: Math.round(caja.right) }]
          : [];
      });
  });
}

test.describe("Texto del banco (HU-083)", () => {
  test("criterio 1: la fracción queda apilada, con su subíndice más abajo, y no queda texto crudo", async ({ page, request }) => {
    await abrir(page, request, `<p id="caso">${dibujar(String.raw`$\frac{1}{R_{\text{eq}}}$`)}</p>`);

    const medidas = await page.evaluate(() => {
      const fraccion = document.querySelector("math > mfrac");
      const [numerador, denominador] = fraccion ? [...fraccion.children] : [];
      const caja = (el?: Element | null) => el?.getBoundingClientRect();
      const n = caja(numerador);
      const d = caja(denominador);
      const base = caja(document.querySelector("msub > mi"));
      const sub = caja(document.querySelector("msub > mtext"));
      return {
        hijos: fraccion?.children.length,
        numeradorEncima: n && d ? n.bottom <= d.top + 1 : null,
        seSolapan: n && d ? n.left < d.right && d.left < n.right : null,
        subindiceMasAbajo: base && sub ? sub.top + sub.height / 2 > base.top + base.height / 2 : null,
        texto: document.querySelector<HTMLElement>("#caso")?.innerText ?? "",
      };
    });

    expect(medidas.hijos, "la fracción tiene numerador y denominador").toBe(2);
    expect(medidas.numeradorEncima, "el numerador va encima del denominador").toBe(true);
    expect(medidas.seSolapan, "uno está sobre el otro, no uno al lado del otro").toBe(true);
    expect(medidas.subindiceMasAbajo, "el subíndice eq baja respecto de R").toBe(true);
    expect(medidas.texto).not.toMatch(/[$\\{}]/);
    expect(await desbordados(page)).toEqual([]);
  });

  test("criterio 6: el texto de toda fórmula, subíndices incluidos, mide 14 px o más con cualquier base", async ({ page, request }) => {
    // Dibuja unas 1.200 fórmulas (392 por tres bases): con los demás casos en paralelo tarda hasta 20 s en una máquina lenta.
    test.setTimeout(90_000);
    const { formulas } = delBanco();
    const fuentes = [...new Set([...Object.values(EJEMPLO_POR_COMANDO), ...FORMULAS_ANIDADAS, ...formulas])];
    const bases = [14, 16, 17];
    const casos = bases.flatMap((base) =>
      fuentes.map((f) => `<div class="caso" data-base="${base}" data-fuente="${escaparAtributo(f)}" style="font-size:${base}px"><p>${dibujar(`$${f}$`)}</p></div>`),
    );
    await abrir(page, request, casos.join(""));

    const resultado = await page.evaluate(() => {
      const fallos: { base: string; fuente: string; elemento: string; px: number }[] = [];
      let casos = 0;
      let sinMath = 0;
      let menor = Infinity;
      for (const caso of document.querySelectorAll<HTMLElement>(".caso")) {
        casos += 1;
        if (!caso.querySelector("math")) sinMath += 1;
        // Cada hoja de la fórmula y todo elemento con texto propio.
        const conTexto = [...caso.querySelectorAll<HTMLElement>("*")].filter(
          (el) => /^(mi|mn|mo|mtext)$/.test(el.localName) || [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
        );
        for (const el of conTexto) {
          if (!el.textContent?.trim()) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          menor = Math.min(menor, px);
          if (px < 14) fallos.push({ base: caso.dataset.base ?? "", fuente: caso.dataset.fuente ?? "", elemento: `${el.localName} «${el.textContent.trim().slice(0, 12)}»`, px });
        }
      }
      return { casos, sinMath, menor, fallos: fallos.slice(0, 12) };
    });

    expect(resultado.casos).toBe(fuentes.length * bases.length);
    expect(resultado.sinMath, "todas se dibujan como fórmula").toBe(0);
    expect(resultado.fallos, "texto por debajo de 14 px").toEqual([]);
    expect(resultado.menor).toBeGreaterThanOrEqual(14);
  });

  test("las fórmulas del banco caben en la columna, sin scroll y sin agrandar el texto (con Noto Sans Math)", async ({ page, request }) => {
    // Se mide con Noto Sans Math, la del repo: antes de medir se comprueba que cargó (sin ella el navegador cae en una fuente del
    // sistema y los anchos cambian). Con Noto Sans Math la fórmula más ancha del banco mide 234 px de los 350 que hay a 390 px;
    // con la fuente del sistema medía unos 254 px.
    const { formulas } = delBanco();
    await abrir(page, request, parrafos(formulas.map((f) => `$${f}$`)));
    const fuente = await cargarFuenteDeMate(page);
    expect(fuente.familia, "--fuente-math está definida en <html>").not.toBe("");
    expect(fuente.caras, "Noto Sans Math se descargó").toBeGreaterThan(0);
    expect(fuente.estados, "Noto Sans Math cargó").not.toContain("error");
    expect(fuente.estados.every((estado) => estado === "loaded")).toBe(true);

    const medidas = await page.evaluate(() => {
      // El ancho útil de la columna: su caja menos el margen lateral (--pad-x) de cada lado. A 390 px son 350.
      const columna = document.querySelector<HTMLElement>("#prueba");
      const util = columna ? columna.clientWidth - 2 * parseFloat(getComputedStyle(columna).paddingLeft) : 0;
      const filas = [...document.querySelectorAll<HTMLElement>("math")].map((m) => {
        const estilo = getComputedStyle(m);
        // La caja de la fórmula trae el relleno que da sitio a la tinta (contenido.css): no cuenta como ancho.
        const relleno = parseFloat(estilo.paddingLeft) + parseFloat(estilo.paddingRight);
        const parrafo = m.closest<HTMLElement>("p");
        return {
          fuente: parrafo?.dataset.fuente ?? "",
          ancho: Math.round(m.getBoundingClientRect().width - relleno),
          conScroll: m.scrollWidth > m.clientWidth + 1,
          tamano: parseFloat(estilo.fontSize),
          tamanoDelParrafo: parrafo ? parseFloat(getComputedStyle(parrafo).fontSize) : 0,
        };
      });
      return {
        util,
        total: filas.length,
        mayor: Math.max(...filas.map((f) => f.ancho)),
        pasan: filas.filter((f) => f.ancho > util),
        conScroll: filas.filter((f) => f.conScroll),
        crecen: filas.filter((f) => f.tamano > f.tamanoDelParrafo + 0.01),
      };
    });
    expect(medidas.total, "se dibujaron todas las fórmulas del banco").toBeGreaterThan(250);
    expect(medidas.pasan, `ninguna pasa de ${medidas.util} px (la mayor mide ${medidas.mayor})`).toEqual([]);
    expect(medidas.conScroll, "ninguna necesita scroll propio").toEqual([]);
    expect(medidas.crecen, "ninguna agranda el texto del párrafo").toEqual([]);
    expect(await desbordados(page)).toEqual([]);
  });

  test("una fórmula más ancha que la columna tiene scroll propio, se alcanza con el teclado y la página no se ensancha", async ({ page, request }) => {
    // 40 sumandos miden unos 1.500 px: más que la columna a 390 px y a 1280 px.
    const suma = Array.from({ length: 40 }, (_, i) => `a_{${i + 1}}`).join(" + ");
    await abrir(
      page,
      request,
      `<p id="corta">Corta: ${dibujar("$a + b$")} fin</p><p id="larga">Suma: ${dibujar(`$${suma}$`)} fin</p><p><button id="despues">Después</button></p>`,
    );

    const corta = page.locator("#corta math");
    const larga = page.locator("#larga math");
    const medir = (math: typeof larga) =>
      math.evaluate((m) => ({
        desborda: m.scrollWidth > m.clientWidth + 1,
        derecha: m.getBoundingClientRect().right,
        ventana: window.innerWidth,
        overflowX: getComputedStyle(m).overflowX,
      }));
    expect((await medir(corta)).desborda, "la fórmula que cabe no desborda").toBe(false);
    const antes = await medir(larga);
    expect(antes.desborda, "la larga sí desborda").toBe(true);
    expect(antes.overflowX).toBe("auto");
    expect(antes.derecha, "pero su caja cabe en la ventana").toBeLessThanOrEqual(antes.ventana);

    // Teclado: la corta no es una parada de Tab; la larga sí, con foco visible, y la flecha derecha la desplaza hasta el final
    // (Inicio y Fin del navegador son verticales y no sirven aquí).
    await page.keyboard.press("Tab");
    await expect(larga, "el primer Tab llega a la fórmula larga: la corta no estorba").toBeFocused();
    expect(await larga.evaluate((m) => getComputedStyle(m).outlineStyle)).not.toBe("none");
    expect(await larga.evaluate((m) => m.scrollLeft)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => larga.evaluate((m) => m.scrollLeft)).toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          await page.keyboard.press("ArrowRight");
          return larga.evaluate((m) => m.scrollWidth - m.clientWidth - m.scrollLeft);
        },
        { timeout: 30_000, intervals: [50] },
      )
      .toBeLessThanOrEqual(1);
    // Al final del scroll el último sumando está a la vista.
    const ultimo = await larga.evaluate((m) => {
      const hoja = m.lastElementChild?.getBoundingClientRect();
      const caja = m.getBoundingClientRect();
      return { dentro: hoja ? hoja.right <= caja.right + 1 && hoja.left >= caja.left : false, texto: m.lastElementChild?.textContent ?? "" };
    });
    expect(ultimo, "el último sumando (a con subíndice 40) queda a la vista").toEqual({ dentro: true, texto: "a40" });
    await page.keyboard.press("Tab");
    await expect(page.locator("#despues"), "el scroll no es una trampa de teclado").toBeFocused();

    // La página no se ensancha. html y body esconden el desborde: se anula esa regla para que se vea.
    await page.addStyleTag({ content: "html, body { overflow-x: visible }" });
    const pagina = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, ancho: document.documentElement.clientWidth }));
    expect(pagina.scroll, "sin scroll horizontal en la página").toBeLessThanOrEqual(pagina.ancho);
    // La caja de la fórmula se asoma 0,15 em por cada lado de su línea (el relleno que da sitio a la tinta, contenido.css): lo
    // único que `desbordados` puede marcar es el párrafo que la contiene, por esa franja y nada más.
    const sobresale = await page.locator("#larga").evaluate((p) => ({ exceso: p.scrollWidth - p.clientWidth, em: parseFloat(getComputedStyle(p).fontSize) }));
    expect(sobresale.exceso, "el párrafo de la larga solo se pasa por el relleno de la fórmula").toBeLessThanOrEqual(0.15 * sobresale.em + 1);
    const marcados = await desbordados(page);
    expect(marcados.filter((e) => !(e.elemento === "p" && e.texto.startsWith("Suma")))).toEqual([]);
  });

  test("una fórmula que cabe no desborda en un contenedor que se ajusta a su contenido", async ({ page, request }) => {
    // Con `max-inline-size: 100%` a secas, dentro de un contenedor que mide lo que mide su contenido (una celda, un ítem de flex,
    // un inline-block) la fórmula quedaría más estrecha que su contenido y con scroll de sobra: el tope suma el relleno.
    const formula = dibujar(String.raw`$\frac{a_n}{b_n} + \sqrt{x^2 + 1} = f(x)$`);
    await abrir(
      page,
      request,
      [
        `<div style="display:inline-block">${formula}</div>`,
        `<div style="display:flex"><div>${formula}</div></div>`,
        `<table><tbody><tr><td>${formula}</td></tr></tbody></table>`,
        `<div style="display:grid;grid-template-columns:max-content">${formula}</div>`,
      ].join(""),
    );
    const sobras = await page.locator("math").evaluateAll((formulas) => formulas.map((m) => m.scrollWidth - m.clientWidth));
    expect(sobras).toHaveLength(4);
    expect(sobras.filter((sobra) => sobra > 1), "px de contenido que no cabe en la fórmula").toEqual([]);
  });

  test("la regla de scroll no recorta la tinta ni mueve nada: las mismas fórmulas salen con los mismos píxeles", async ({ page, request }) => {
    // contenido.css le da scroll a la fórmula, y un overflow recorta a su caja, que es más ajustada que la tinta (la cursiva de la f,
    // la integral, un subíndice sin base). El relleno compensado con margen negativo lo evita. Cada fórmula se dibuja dos veces, una
    // con la regla y otra con la regla anulada, y se comparan los píxeles. Sin el relleno cambian, por ejemplo, la f y la ∫.
    const fuentes = [
      String.raw`f(x) = e^{x}`,
      String.raw`g(x)=|f(x-1)|-2`,
      String.raw`\int u^2\,du`,
      String.raw`2\pi\cdot\int_0^2 x\cdot x^2\,dx = 8\pi`,
      String.raw`\iint_S F\cdot n\,dS`,
      "_{i}",
      String.raw`\vec{F}_{i}`,
      String.raw`\sqrt[3]{x^2} + \frac{a_n}{b_n}`,
      String.raw`\left( \frac{f(x)}{g(x)} \right)^{2}`,
    ];
    const anulada = (marcado: string) => marcado.replace(/<math(?=[ >])/g, '<math style="max-inline-size:none;overflow:visible;padding:0;margin:0"');
    const parrafo = (marcado: string, id: string) =>
      // Alto fijo: con alturas fraccionarias (una fracción, una raíz) los párrafos de más abajo caen en medios píxeles y el
      // borde se pinta distinto aunque no haya nada distinto.
      `<p id="${id}" style="font-size:22px;margin:0;padding:14px 8px;block-size:90px;box-sizing:border-box;background:#fff;color:#000;inline-size:fit-content">Sea ${marcado} y más.</p>`;
    await abrir(
      page,
      request,
      fuentes
        .map((f, i) => {
          const marcado = dibujar(`$${f}$`);
          return parrafo(marcado, `con${i}`) + parrafo(anulada(marcado), `sin${i}`);
        })
        .join(""),
    );
    const distintas: string[] = [];
    for (const [i, fuente] of fuentes.entries()) {
      const con = await page.locator(`#con${i}`).screenshot();
      const sin = await page.locator(`#sin${i}`).screenshot();
      if (!con.equals(sin)) distintas.push(fuente);
    }
    expect(distintas, "fórmulas que cambian al darles scroll").toEqual([]);
  });

  test.describe("bloque de código (criterio 5)", () => {
    test("un bloque real del banco conserva la sangría, es literal y recibe el foco con Tab", async ({ page, request }) => {
      const { bloques } = delBanco();
      const ancho = (programa: string) => Math.max(...programa.split("\n").map((l) => l.length));
      const conSangria = bloques.filter((b) => /^ {4}\S/m.test(b.programa)).sort((x, y) => ancho(x.programa) - ancho(y.programa))[0];
      expect(conSangria, "el banco trae un bloque de código con sangría").toBeDefined();
      const programas = partirEnunciado(conSangria.enunciado)
        .filter((trozo) => trozo.codigo)
        .map((trozo) => trozo.texto);
      await abrir(page, request, `<div id="caso">${dibujar(conSangria.enunciado)}</div>`);

      const bloque = page.getByRole("region", { name: "Código" });
      await expect(bloque).toHaveCount(programas.length);
      const medidas = await bloque.evaluateAll((pres) =>
        pres.map((pre) => ({
          espacios: getComputedStyle(pre).whiteSpace,
          scrollInterno: pre.scrollWidth > pre.clientWidth,
          texto: pre.querySelector("code")?.textContent ?? "",
          tamano: parseFloat(getComputedStyle(pre).fontSize),
          dentroDeLaVentana: pre.getBoundingClientRect().right <= window.innerWidth,
          formulas: pre.querySelectorAll("math").length,
        })),
      );
      expect(medidas.map((m) => m.texto), "el código sale tal cual, con su sangría").toEqual(programas);
      expect(medidas.some((m) => /^ {4}\S/m.test(m.texto))).toBe(true);
      for (const m of medidas) {
        expect(m.espacios).toBe("pre");
        expect(m.scrollInterno, "un bloque que cabe no tiene scroll").toBe(false);
        expect(m.tamano).toBeGreaterThanOrEqual(14);
        expect(m.dentroDeLaVentana).toBe(true);
        expect(m.formulas).toBe(0);
      }

      // Aunque el bloque quepa, el teclado llega a él (así se prueba el tabindex).
      await page.keyboard.press("Tab");
      await expect(bloque.first()).toBeFocused();
      expect(await desbordados(page)).toEqual([]);
    });

    test("un bloque más ancho que la pantalla tiene scroll dentro, se alcanza con el teclado y la página no se ensancha", async ({ page, request }) => {
      const linea = (n: number) => `resultado_${n} = calcular($x$, \\frac{1}{2}, "<b>" + dato_numero_${n} * 2) # ${"un comentario muy largo ".repeat(5)}`;
      const programa = ["def calcular(a, b, c):", ...[1, 2, 3].map((n) => `    ${linea(n)}`), "    return resultado_3"].join("\n");
      await abrir(page, request, `<div id="caso">${dibujar(`Mira este programa\n\`\`\`\n${programa}\n\`\`\`\nFin`)}</div>`);

      const bloque = page.getByRole("region", { name: "Código" });
      await expect(bloque).toHaveCount(1);
      const medidas = await bloque.evaluate((pre) => ({
        desborda: pre.scrollWidth > pre.clientWidth,
        derecha: pre.getBoundingClientRect().right,
        ventana: window.innerWidth,
        formulas: pre.querySelectorAll("math").length,
        etiquetas: pre.querySelectorAll("b").length,
        texto: pre.querySelector("code")?.textContent ?? "",
      }));
      expect(medidas.desborda, "el bloque desborda a propósito").toBe(true);
      expect(medidas.derecha, "pero su caja cabe en la ventana").toBeLessThanOrEqual(medidas.ventana);
      expect(medidas.formulas).toBe(0);
      expect(medidas.etiquetas).toBe(0);
      expect(medidas.texto, "todo va tal cual").toBe(programa);

      // Teclado: Tab llega al bloque, que muestra el foco, y ArrowRight lo desplaza (con animación: se espera).
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press("Tab");
        if (await bloque.evaluate((pre) => document.activeElement === pre)) break;
      }
      await expect(bloque).toBeFocused();
      expect(await bloque.evaluate((pre) => getComputedStyle(pre).outlineStyle)).not.toBe("none");
      expect(await bloque.evaluate((pre) => pre.scrollLeft)).toBe(0);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => bloque.evaluate((pre) => pre.scrollLeft)).toBeGreaterThan(0);

      // La página no tiene scroll horizontal: html y body esconden el desborde, así que se anula esa regla para que se vea.
      await page.addStyleTag({ content: "html, body { overflow-x: visible }" });
      const pagina = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, ancho: document.documentElement.clientWidth }));
      expect(pagina.scroll, "sin scroll horizontal en la página").toBeLessThanOrEqual(pagina.ancho);
      expect(await desbordados(page)).toEqual([]);
    });

    test("un bloque ancho dentro de un grid o un flex tiene scroll propio y no ensancha a su contenedor", async ({ page, request }) => {
      // Un ítem de grid o de flex no baja de su ancho mínimo (min-content), y el de un bloque con `white-space: pre` es su línea
      // más larga: sin la regla de contenido.css (`inline-size: 0; min-inline-size: 100%`) el bloque medía 1.320 px dentro de un
      // grid y la página lo recortaba sin scroll.
      const programa = ["def f(a, b):", `    ${"resultado = calcular(a, b) + otra_funcion_muy_larga(a, b)  # comentario largo ".repeat(3)}`].join("\n");
      const bloque = dibujar(`Mira este programa\n\`\`\`\n${programa}\n\`\`\``);
      const casos: Record<string, string> = {
        "un grid": `<div style="display:grid">${bloque}</div>`,
        "un grid de una columna 1fr con un div en medio": `<div style="display:grid;grid-template-columns:1fr"><div>${bloque}</div></div>`,
        "un flex en columna con un div en medio": `<div style="display:flex;flex-direction:column"><div>${bloque}</div></div>`,
        // En fila, el ítem que envuelve el texto necesita ancho propio: `flex: 1` (README, sección de las fórmulas y el código).
        "un flex en fila, con un div que ocupa el ancho que sobra": `<div style="display:flex;gap:8px"><b style="min-inline-size:44px">A</b><div style="flex:1;min-inline-size:0">${bloque}</div></div>`,
      };
      await abrir(page, request, Object.entries(casos).map(([nombre, html]) => `<section data-caso="${nombre}">${html}</section>`).join(""));

      const medidas = await page.locator("section[data-caso]").evaluateAll((secciones) =>
        secciones.map((seccion) => {
          const pre = seccion.querySelector("pre");
          return {
            caso: seccion.getAttribute("data-caso"),
            desborda: pre ? pre.scrollWidth > pre.clientWidth : null,
            derecha: pre ? Math.round(pre.getBoundingClientRect().right) : null,
            ancho: pre ? pre.clientWidth : null,
            ventana: window.innerWidth,
          };
        }),
      );
      expect(medidas).toHaveLength(Object.keys(casos).length);
      for (const m of medidas) {
        expect(m.desborda, `${m.caso}: el bloque tiene scroll propio`).toBe(true);
        expect(m.derecha, `${m.caso}: su caja cabe en la ventana`).toBeLessThanOrEqual(m.ventana);
        expect(m.ancho, `${m.caso}: ni se ensancha ni se encoge a una rendija`).toBeGreaterThan(200);
      }
      expect(await desbordados(page)).toEqual([]);
    });
  });

  test("una opción que es solo una fórmula tiene nombre accesible (las opciones con fórmula del banco, como radios)", async ({ page, request, context }) => {
    const { opciones } = delBanco();
    const soloFormula = opciones.filter((texto) => {
      const trozos = partirMate(texto);
      return trozos.length === 1 && trozos[0].mate;
    });
    expect(opciones.length, "el banco trae opciones con fórmula").toBeGreaterThan(150);
    expect(soloFormula.length, "y muchas son solo una fórmula").toBeGreaterThan(100);
    await abrir(
      page,
      request,
      opciones.map((texto, i) => `<div role="radio" aria-checked="false" tabindex="0" data-opcion="${i}">${dibujar(texto)}</div>`).join(""),
    );

    const nombres = await nombresAccesibles(context, page, "[data-opcion]");
    expect(nombres).toHaveLength(opciones.length);
    const sinNombre = nombres.flatMap((n, i) => (n.rol === "radio" && n.nombre.trim() !== "" ? [] : [`${opciones[i]} → ${n.rol} «${n.nombre}»`]));
    expect(sinNombre, "todo radio tiene nombre").toEqual([]);
    // Lo que el navegador expone es la prosa más la lectura de cada fórmula. Chromium agrega un espacio tras una fórmula en
    // línea («x , y»): se compara lo que se dice, sin contar los espacios. Con la fórmula sin leer saldría «» o «La resistencia vale ohmios».
    const distintos = nombres.flatMap((n, i) => {
      const esperado = nombreEsperado(opciones[i]);
      return n.nombre.replace(/\s+/g, "") === esperado.replace(/\s+/g, "") ? [] : [`${opciones[i]} → «${n.nombre}», esperado «${esperado}»`];
    });
    expect(distintos).toEqual([]);
    // Ninguna letra sale como la itálica matemática que Chromium le pone a un <mi> (U+1D400 a U+1D7FF): ahí no hay nada que leer.
    expect(nombres.filter((n) => /[\u{1D400}-\u{1D7FF}]/u.test(n.nombre)).map((n) => n.nombre)).toEqual([]);
  });

  test("el nombre de un botón, una etiqueta o un título con una fórmula la incluye", async ({ page, request, context }) => {
    const formula = String.raw`$\frac{1}{R_{\text{eq}}}$`;
    const frase = String.raw`La resistencia vale $\frac{1}{R_{\text{eq}}}$ ohmios`;
    await abrir(
      page,
      request,
      [
        `<button data-caso="boton">${dibujar(formula)}</button>`,
        `<label data-caso="etiqueta"><input type="radio" name="a">${dibujar(formula)}</label>`,
        `<label data-caso="etiqueta con frase"><input type="radio" name="b">${dibujar(frase)}</label>`,
        `<h2 data-caso="titulo">${dibujar(frase)}</h2>`,
      ].join(""),
    );
    const casos = await nombresAccesibles(context, page, "button[data-caso], [data-caso] input, h2[data-caso]");
    expect(casos.map((c) => `${c.rol}: ${c.nombre}`)).toEqual([
      "button: 1 sobre R sub eq",
      "radio: 1 sobre R sub eq",
      "radio: La resistencia vale 1 sobre R sub eq ohmios",
      "heading: La resistencia vale 1 sobre R sub eq ohmios",
    ]);
  });

  test("el signo de un número y las barras no llevan el hueco de una resta (se mide contra lo que el navegador pone solo)", async ({ page, request }) => {
    // MathML da 0,22 a 0,28 em de hueco a cada lado de un operador infijo. Cada fórmula se compara con una que el navegador
    // resuelve sin ayuda (el signo o la barra en el borde de su fila) y sumando lo que cambia: el control no depende de este código.
    const fuentes = {
      igualDos: "x = 2",
      igualMenosDos: "x = -2",
      dos: "2",
      menosDos: "-2",
      unoAlN: "(1)^n",
      menosUnoAlN: "(-1)^n",
      uno: "1",
      menosUno: "-1",
      haciaInfinito: String.raw`x \to \infty`,
      haciaMenosInfinito: String.raw`x \to -\infty`,
      infinito: String.raw`\infty`,
      menosInfinito: String.raw`-\infty`,
      restaSinBarras: "g = f - 2",
      restaConBarras: "g = |f| - 2",
      f: "f",
      fEntreBarras: "|f|",
      productoSinBarras: String.raw`(x-2)\,x-2`,
      productoConBarras: String.raw`(x-2)\,|x-2|`,
      x2: "x-2",
      x2EntreBarras: "|x-2|",
    };
    await abrir(
      page,
      request,
      Object.entries(fuentes)
        .map(([clave, fuente]) => `<p data-clave="${clave}" style="font-size:20px;margin-block:6px">${dibujar(`$${fuente}$`)}</p>`)
        .join(""),
    );
    const ancho = await page.evaluate(() => {
      const medidas: Record<string, number> = {};
      for (const p of document.querySelectorAll<HTMLElement>("p[data-clave]")) {
        const m = p.querySelector("math");
        if (!m) continue;
        const estilo = getComputedStyle(m);
        medidas[p.dataset.clave ?? ""] = m.getBoundingClientRect().width - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
      }
      return medidas;
    });
    expect(Object.keys(ancho)).toHaveLength(Object.keys(fuentes).length);
    const suma = (a: number, b: number, c: number) => a + b - c;
    const pares: [string, number, number][] = [
      // El control: la fórmula sin signo, más lo que el signo añade cuando el navegador lo resuelve solo (en el borde de su fila).
      ["x = −2", ancho.igualMenosDos, suma(ancho.igualDos, ancho.menosDos, ancho.dos)],
      ["(−1)ⁿ", ancho.menosUnoAlN, suma(ancho.unoAlN, ancho.menosUno, ancho.uno)],
      ["x → −∞", ancho.haciaMenosInfinito, suma(ancho.haciaInfinito, ancho.menosInfinito, ancho.infinito)],
      ["g = |f| − 2", ancho.restaConBarras, suma(ancho.restaSinBarras, ancho.fEntreBarras, ancho.f)],
      ["(x−2) |x−2|", ancho.productoConBarras, suma(ancho.productoSinBarras, ancho.x2EntreBarras, ancho.x2)],
    ];
    for (const [que, medido, esperado] of pares) {
      expect(Math.abs(medido - esperado), `${que}: mide ${medido.toFixed(1)} px y debería medir ${esperado.toFixed(1)} px`).toBeLessThan(0.75);
    }
  });

  test("los espacios de borde de un \\text se ven: «x > 0 \\text{ y } x < 5» no sale pegado", async ({ page, request }) => {
    await abrir(
      page,
      request,
      `<p id="con" style="font-size:16px">${dibujar(String.raw`$x > 0 \text{ y } x < 5$`)}</p><p id="sin" style="font-size:16px">${dibujar(String.raw`$x > 0 \text{y} x < 5$`)}</p>`,
    );
    const ancho = (id: string) => page.locator(`#${id} mtext`).evaluate((el) => el.getBoundingClientRect().width);
    const [con, sin] = [await ancho("con"), await ancho("sin")];
    // Dos espacios duros miden unos 0,25 em cada uno: a 16 px, 8 px; el navegador recortaría los de borde y las dos medirían lo mismo.
    expect(con - sin, `con espacios ${con.toFixed(1)} px, sin ${sin.toFixed(1)} px`).toBeGreaterThan(5);
  });

  test("criterios 3 y 4: \\$ es un signo de pesos y lo que no se entiende se ve tal cual", async ({ page, request }) => {
    const casos = {
      pesos: String.raw`cuesta \$5 y $x$`,
      sinCerrar: "cuesta $5 sin cerrar",
      noEntendida: String.raw`$\foo$`,
      vacia: "$$",
      sinHojas: "${}$",
      enTexto: String.raw`$\text{cuesta \$5}$`,
    };
    await abrir(page, request, Object.entries(casos).map(([id, texto]) => `<p id="${id}">${dibujar(texto)}</p>`).join(""));

    const texto = (id: string) => page.locator(`#${id}`).evaluate((p) => p.textContent ?? "");
    const formulas = (id: string) => page.locator(`#${id} math`).count();
    expect(await texto("pesos")).toBe("cuesta $5 y x");
    expect(await formulas("pesos")).toBe(1);
    expect(await page.locator("#pesos").evaluate((p) => p.firstElementChild?.firstChild?.textContent)).toBe("cuesta $5 y ");
    for (const id of ["sinCerrar", "noEntendida", "vacia", "sinHojas"] as const) {
      expect(await texto(id), id).toBe(casos[id]);
      expect(await formulas(id), id).toBe(0);
    }
    expect(await texto("enTexto")).toBe("cuesta $5");
    expect(await formulas("enTexto")).toBe(1);
    expect(await page.locator("#enTexto mtext").count()).toBe(1);
  });

  test("tipografía: las fórmulas usan Noto Sans Math, la del repo y no una del sistema", async ({ page, request, context }) => {
    // Una h suelta (se dibuja con U+210E), una x, una π, un ∑ y un … (U+2026): cada una vive en un bloque distinto de Unicode.
    await abrir(page, request, `<p>${dibujar(String.raw`$h + x + \pi + \sum_1 + …$`)}</p>`);
    const fuente = await cargarFuenteDeMate(page);
    expect(fuente.familia, "--fuente-math está definida en <html>").not.toBe("");
    expect(fuente.estados.length > 0 && fuente.estados.every((estado) => estado === "loaded"), "Noto Sans Math cargó").toBe(true);
    const familia = await page.locator("math").evaluate((m) => getComputedStyle(m).fontFamily);
    expect(familia, "math pide primero la fuente del repo y deja detrás los respaldos").toMatch(new RegExp(`^"?${fuente.familia}"?, "?Cambria Math`));

    // Chromium dice con qué fuente dibujó cada elemento: una letra que salió con otra delata un glifo que a la fuente le falta.
    // isCustomFont distingue la fuente que bajó la página de una Noto Sans Math instalada en el sistema.
    const sesion = await context.newCDPSession(page);
    await sesion.send("DOM.enable");
    await sesion.send("CSS.enable");
    const { root } = await sesion.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await sesion.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "math mi, math mo" });
    expect(nodeIds.length).toBeGreaterThanOrEqual(8);
    const fuera: string[] = [];
    for (const nodeId of nodeIds) {
      const { fonts } = await sesion.send("CSS.getPlatformFontsForNode", { nodeId });
      for (const f of fonts) if (!f.isCustomFont || !/Noto Sans Math/i.test(f.familyName)) fuera.push(`${f.familyName}${f.isCustomFont ? "" : " (del sistema)"}`);
    }
    expect(fuera, "elementos dibujados con otra fuente").toEqual([]);
  });
});
