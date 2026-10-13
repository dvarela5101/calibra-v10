import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLAVES_INTERNAS_DE_EJEMPLO, FILA_DE_EJEMPLO, GUARDADO_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { proyectarResultado, type ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { ErroresDetectados, NivelEscrito, RepasarAntes, ResultadoDelDiagnostico } from "./ResultadoDelDiagnostico";

// HU-009: el marcado del resultado. Se lee el HTML (`renderToStaticMarkup`) como las pruebas de PieDePagina.

const RESULTADO = proyectarResultado(FILA_DE_EJEMPLO);

const pintar = (resultado: ResultadoParaMostrar = RESULTADO, props: { acciones?: "completas" | "ninguna"; nivelDeTitulos?: 2 | 3; ranura?: ReactNode } = {}) =>
  renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado, ...props }));

/** El texto visible: sin etiquetas, sin comentarios de React y con los espacios normalizados. */
const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** El resultado con el JSON guardado cambiado. */
const con = (cambios: Partial<typeof GUARDADO_DE_EJEMPLO>, fila = {}) =>
  proyectarResultado({ ...FILA_DE_EJEMPLO, ...fila, resultado: { ...GUARDADO_DE_EJEMPLO, ...cambios } });

describe("encabezado (criterio 10)", () => {
  const html = pintar();
  const t = texto(html);

  it("la materia, la Evaluación, la fecha en hora de Bogotá, cuántas respondió y el puntaje global", () => {
    expect(t).toContain("Física II · Parcial 1");
    // 03:30 UTC del día 5 es el día 4 en Bogotá.
    expect(t).toContain("Fecha: 4 de octubre de 2026");
    expect(html).toContain('<time dateTime="2026-10-05T03:30:00.000Z">4 de octubre de 2026</time>');
    expect(t).toContain("Respondiste 8 preguntas");
    expect(t).toContain("Puntaje global: 63 %");
  });

  it("con una sola pregunta, «Respondiste 1 pregunta»", () => {
    expect(texto(pintar(con({ habilidades: [], errores: [], prerrequisitos: [] }, { respondidas: 1, aciertos: 1 })))).toContain("Respondiste 1 pregunta");
  });

  it("el puntaje sale de aciertos y respondidas, no de la suma por habilidad", () => {
    // Las habilidades suman 5 aciertos de 7 respuestas, pero se acertaron 4 de 8 preguntas: 50 %.
    expect(texto(pintar(proyectarResultado({ ...FILA_DE_EJEMPLO, aciertos: 4 })))).toContain("Puntaje global: 50 %");
  });
});

describe("habilidades (criterio 10)", () => {
  const html = pintar();
  const t = texto(html);

  it("están todas, en el orden guardado, con su descripción", () => {
    // Sin las fórmulas `$…$`: en el marcado salen dibujadas, no como texto.
    const posiciones = RESULTADO.habilidades.map((h) => html.indexOf(h.descripcion.replace(/\$[^$]*\$/g, "")));
    expect(posiciones.every((p) => p > 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it("el nivel va escrito, los cuatro", () => {
    for (const etiqueta of ["Lo dominas", "En proceso", "No lo dominas", "Sin medir"]) expect(t, etiqueta).toContain(etiqueta);
  });

  it("«Acertaste A de R» solo en las que tienen al menos una respuesta contada", () => {
    expect(t).toContain("Acertaste 3 de 3");
    expect(t).toContain("Acertaste 1 de 2");
    expect(t).toContain("Acertaste 0 de 2");
    expect(html.match(/Acertaste/g)).toHaveLength(3);
  });

  it("«No medimos esta habilidad en esta prueba.» solo en la que está sin medir, y sin decir el motivo", () => {
    expect(html.match(/No medimos esta habilidad en esta prueba\./g)).toHaveLength(1);
    expect(t.toLowerCase()).not.toContain("falta");
    expect(t.toLowerCase()).not.toContain("material");
    expect(t.toLowerCase()).not.toContain("tope");
  });

  it("una habilidad «no la domina» sin respuestas no muestra cifras", () => {
    const sola = con({ habilidades: [{ habilidad: "x", descripcion: "lee un diagrama", nivel: "no_lo_domina", respuestas: 0, aciertos: 0 }] });
    expect(texto(pintar(sola))).not.toContain("Acertaste");
    expect(texto(pintar(sola))).not.toContain("No medimos");
  });

  it("la fórmula de una descripción se dibuja como <math>", () => {
    expect(html).toContain("<math");
    expect(html).not.toContain("$F = ma$");
  });
});

describe("errores (criterio 11)", () => {
  const html = pintar();
  const t = texto(html);

  it("«Error detectado:» si está confirmado y «Posible error:» si está en sospecha, con la descripción tal cual", () => {
    expect(t).toContain("Error detectado: inviertes la relación");
    expect(t).toContain("Posible error: confundes energía con potencia");
    expect(t).toContain("Posible error: ignoras la fricción");
  });

  it("los confirmados van primero aunque lleguen después (M13)", () => {
    const confirmado = t.indexOf("Error detectado:");
    expect(confirmado).toBeGreaterThan(-1);
    expect(confirmado).toBeLessThan(t.indexOf("Posible error:"));
    expect(t.indexOf("Posible error: confundes")).toBeLessThan(t.indexOf("Posible error: ignoras"));
  });

  it("los prefijos no están intercambiados (M14)", () => {
    expect(t).not.toContain("Posible error: inviertes");
    expect(t).not.toContain("Error detectado: confundes");
    expect(t).not.toContain("Error detectado: ignoras");
  });

  it("«Habilidad: …» solo si la habilidad es una del resultado", () => {
    expect(t).toContain("Habilidad: aplica la conservación de la energía");
    expect(t).toContain("Habilidad: interpreta gráficas de posición");
    expect(t).not.toContain("trabajo de la fricción");
    expect(html.match(/Habilidad:/g)).toHaveLength(2);
  });

  it("cada detalle va en su renglón, y un error sin detalle no deja uno vacío", () => {
    expect(t).toContain("Revisa qué magnitud va arriba en");
    expect(html).toMatch(/<p class="[^"]*">\s*<span class="texto-banco">La fricción también hace trabajo\.<\/span><\/p>/);
    expect(html).toMatch(/<p class="[^"]*">\s*<span class="texto-banco">Piensa en el sentido del movimiento\.<\/span><\/p>/);
    // Ningún párrafo vacío.
    expect(html).not.toMatch(/<p[^>]*><\/p>/);
  });

  it("una fórmula en el título sale como <math> y no como texto (M19)", () => {
    expect(html).toContain('<math aria-label="1 sobre 2">');
    expect(html).not.toContain("$\\frac");
  });

  it("sin errores dice «No detectamos errores concretos en esta prueba.»", () => {
    const sin = texto(pintar(con({ errores: [] })));
    expect(sin).toContain("No detectamos errores concretos en esta prueba.");
    expect(sin).not.toContain("Error detectado");
    expect(sin).not.toContain("Posible error");
  });

  it("ErroresDetectados por sí sola es una sección con su título", () => {
    const aislado = renderToStaticMarkup(createElement(ErroresDetectados, { errores: RESULTADO.errores, idBase: "x" }));
    expect(aislado).toMatch(/^<section aria-labelledby="errores-x" class="[^"]*"><h2 id="errores-x"/);
  });
});

describe("prerrequisitos (criterio 12)", () => {
  it("una sola lista «Conviene repasar antes», con la materia entre paréntesis cuando es otra", () => {
    const html = pintar();
    const t = texto(html);
    expect(t).toContain("Conviene repasar antes");
    expect(t).toContain("despeja una incógnita");
    expect(t).toContain("deriva polinomios (Cálculo Diferencial)");
    expect(t).not.toContain("despeja una incógnita (");
    // Una sola lista, no una por habilidad.
    const seccion = html.slice(html.indexOf('aria-labelledby="repasar-'));
    expect(seccion.match(/<ul /g)).toHaveLength(1);
    expect(seccion.match(/<li /g)).toHaveLength(2);
  });

  it("sin prerrequisitos no hay encabezado ni lista", () => {
    const html = pintar(con({ prerrequisitos: [] }));
    expect(html).not.toContain("Conviene repasar antes");
    expect(html).not.toContain("repasar-");
  });

  it("RepasarAntes sin prerrequisitos no dibuja nada", () => {
    expect(renderToStaticMarkup(createElement(RepasarAntes, { prerrequisitos: [], idBase: "x" }))).toBe("");
  });

  it("el nombre de la materia es texto, no un texto del banco", () => {
    const conMateria = con({ prerrequisitos: [{ materia: "Cálculo <b>Diferencial</b>", habilidad: "x", descripcion: "deriva" }] });
    expect(pintar(conMateria)).toContain("(Cálculo &lt;b&gt;Diferencial&lt;/b&gt;)");
  });
});

describe("todo texto del banco pasa por TextoDelBanco (HU-083)", () => {
  // La fixture lleva una fórmula `$…$` en cada sitio donde el resultado dibuja un texto del banco. Si uno de esos sitios pasa a
  // texto plano, la persona ve el `$…$` crudo: el banco real ya trae el caso (`contenido/calculo-integral/sustitucion.md`, el
  // texto de error de una opción, que sale como detalle). Los sitios se miran uno por uno: con solo contar `<math` en todo el
  // resultado, una fórmula que sí se dibuja taparía a la que no.
  const html = pintar();
  const iErrores = html.indexOf('aria-labelledby="errores-');
  const iRepasar = html.indexOf('aria-labelledby="repasar-');
  const secciones = {
    habilidades: html.slice(html.indexOf('aria-labelledby="habilidades-'), iErrores),
    errores: html.slice(iErrores, iRepasar),
    repasar: html.slice(iRepasar),
  };
  // El primer párrafo de la sección cuyo texto, sin etiquetas, contiene `contiene` ("" si no hay ninguno).
  const parrafo = (seccion: string, contiene: string) =>
    (seccion.match(/<p [^>]*>.*?<\/p>/g) ?? []).find((p) => texto(p).includes(contiene)) ?? "";

  it("la fixture trae una fórmula en cada sitio, y las secciones se separan bien", () => {
    expect(iErrores).toBeGreaterThan(0);
    expect(iRepasar).toBeGreaterThan(iErrores);
    expect(secciones.habilidades).toContain("calcula la fuerza neta");
    expect(secciones.errores).toContain("Posible error:");
    expect(secciones.repasar).toContain("Conviene repasar antes");
    const guardado = GUARDADO_DE_EJEMPLO;
    expect(guardado.habilidades[2].descripcion).toContain("$");
    expect(guardado.errores[1].descripcionHabilidad).toBe(guardado.habilidades[2].descripcion);
    expect(guardado.errores[1].detalles[0]).toContain("$");
    expect(guardado.prerrequisitos[0].descripcion).toContain("$");
  });

  it("la descripción de la habilidad de un error sale como <math> (M52)", () => {
    const linea = parrafo(secciones.errores, "Habilidad: interpreta gráficas de posición");
    expect(linea).toContain("<math");
    expect(linea).not.toContain("$");
  });

  it("el detalle de un error sale como <math> (M53)", () => {
    const linea = parrafo(secciones.errores, "Revisa qué magnitud va arriba");
    expect(linea).toContain("<math");
    expect(linea).not.toContain("$");
  });

  it("un prerrequisito sale como <math> (M54)", () => {
    const linea = parrafo(secciones.repasar, "despeja una incógnita");
    expect(linea).toContain("<math");
    expect(linea).not.toContain("$");
  });

  it("la descripción de una habilidad y el título de un error siguen saliendo como <math>", () => {
    expect(parrafo(secciones.habilidades, "interpreta gráficas de posición")).toContain("<math");
    expect(parrafo(secciones.habilidades, "calcula la fuerza neta")).toContain("<math");
    expect(parrafo(secciones.errores, "inviertes la relación")).toContain("<math");
  });

  it("ningún `$` crudo en todo el resultado", () => {
    expect(html).not.toContain("$");
  });
});

describe("después del resultado (criterio 14)", () => {
  it("«Ver monitores de {materia}» lleva a la lista de esa materia y «Tomar otro diagnóstico» al selector", () => {
    const html = pintar();
    const enlaces = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, nombre]) => [nombre, href]);
    expect(enlaces).toEqual([
      ["Ver monitores de Física II", "/monitores?materia=FISI-1018"],
      ["Tomar otro diagnóstico", "/diagnostico"],
    ]);
  });

  it("el código de la materia va escapado en la dirección", () => {
    const rara = proyectarResultado({ ...FILA_DE_EJEMPLO, codigo_materia: "A&B C" });
    expect(pintar(rara)).toContain("/monitores?materia=A%26B+C");
  });

  it("con acciones=ninguna (el mensaje de D-51) no hay enlaces (M22)", () => {
    const html = pintar(RESULTADO, { acciones: "ninguna" });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Ver monitores");
    expect(html).not.toContain("Tomar otro diagnóstico");
  });

  it("la ranura va debajo de todo, en un contenedor propio", () => {
    const html = pintar(RESULTADO, { ranura: createElement("form", { id: "formulario-de-contacto" }, "Déjanos tus datos") });
    expect(html).toContain('<form id="formulario-de-contacto">Déjanos tus datos</form>');
    expect(html.indexOf("formulario-de-contacto")).toBeGreaterThan(html.indexOf("Tomar otro diagnóstico"));
  });

  it("sin ranura no sobra un contenedor vacío (M21)", () => {
    const sin = pintar(RESULTADO);
    expect(pintar(RESULTADO, { ranura: null })).toBe(sin);
    expect(pintar(RESULTADO, { ranura: undefined })).toBe(sin);
    expect(pintar(RESULTADO, { ranura: false })).toBe(sin);
    // El último elemento del resultado es el de las acciones.
    expect(sin.endsWith("</a></div></div>")).toBe(true);
  });
});

describe("niveles de los títulos", () => {
  it("por defecto las secciones son h2", () => {
    const html = pintar();
    expect(html.match(/<h2 /g)).toHaveLength(3);
    expect(html).not.toContain("<h3");
  });

  it("debajo de un h2 (el mensaje de D-51) son h3", () => {
    const html = pintar(RESULTADO, { nivelDeTitulos: 3 });
    expect(html.match(/<h3 /g)).toHaveLength(3);
    expect(html).not.toContain("<h2");
  });

  it("cada sección está nombrada por su título", () => {
    const html = pintar();
    for (const id of [`habilidades-${RESULTADO.idDiagnostico}`, `errores-${RESULTADO.idDiagnostico}`, `repasar-${RESULTADO.idDiagnostico}`]) {
      expect(html).toContain(`aria-labelledby="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("lo que el resultado no dice", () => {
  const html = pintar();

  it("nada de repetido ni de otra vez (D-53 b)", () => {
    const t = texto(html).toLowerCase();
    expect(t).not.toContain("repetid");
    expect(t).not.toContain("otra vez");
  });

  it("no repasa las preguntas una por una ni muestra la letra elegida", () => {
    const t = texto(html);
    expect(t).not.toContain("Pregunta 1");
    expect(t).not.toContain("elegiste");
  });

  it("ninguna clave interna sale en el marcado", () => {
    for (const clave of CLAVES_INTERNAS_DE_EJEMPLO) expect(html, clave).not.toContain(clave);
  });
});

describe("NivelEscrito", () => {
  it.each([
    ["lo_domina", "Lo dominas"],
    ["en_proceso", "En proceso"],
    ["no_lo_domina", "No lo dominas"],
    ["sin_medir", "Sin medir"],
  ] as const)("%s se escribe «%s», no solo se pinta", (nivel, etiqueta) => {
    expect(texto(renderToStaticMarkup(createElement(NivelEscrito, { nivel })))).toBe(etiqueta);
  });
});
