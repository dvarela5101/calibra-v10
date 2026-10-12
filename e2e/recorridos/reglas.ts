import { expect, type Page } from "@playwright/test";

// HU-048: las reglas del producto (CLAUDE.md) sobre cada pantalla que abre un recorrido. Las mismas que mide cada
// spec por HU (`e2e/finalizar.spec.ts`), en un solo lugar: los recorridos no copian otra función `medir`.

/** Sin scroll horizontal, ningún texto bajo 14 px, áreas táctiles de 44 px o más, sin degradados y todo control con nombre. */
export async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  const ancho = page.viewportSize()?.width ?? 0;
  const en = `${donde} (${ancho} px)`;
  // Se mide la página asentada: tras una navegación del lado del cliente, con la máquina cargada, el CSS de la ruta
  // puede llegar unos instantes después que el HTML, y un botón sin su estilo mide los 13,3 px de Chrome.
  await expect(async () => {
    const medidas = await medir(page);
    expect(medidas.sinScrollHorizontal, `${en}: sin scroll horizontal`).toBe(true);
    expect(medidas.textosChicos, `${en}: ningún texto por debajo de 14 px`).toEqual([]);
    expect(medidas.degradados, `${en}: sin degradados`).toBe(0);
    expect(medidas.tactilesChicos, `${en}: áreas táctiles de 44 px o más`).toEqual([]);
    expect(medidas.controlesSinNombre, `${en}: todo control tiene nombre`).toEqual([]);
  }).toPass({ timeout: 10_000, intervals: [250, 500, 1_000] });
}

/** Texto, áreas táctiles (enlaces, botones, campos y el resumen de un details), degradados y nombres. */
async function medir(page: Page) {
  return page.evaluate(() => {
    // checkVisibility: lo de un <details> cerrado conserva su caja en Chrome, pero no se ve.
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0 && el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, summary, textarea, input:not([type=hidden])")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera. De una casilla cuenta su etiqueta, que también la marca.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      textosChicos: conTexto
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 14)
        .map((el) => `${el.tagName.toLowerCase()} ${getComputedStyle(el).fontSize}: ${(el.textContent ?? "").trim().slice(0, 40)}`),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: controles
        .filter((el) => {
          const etiquetas = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || etiquetas);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
