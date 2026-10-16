import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { elementosHijos, leerHtml, porClase, porEtiqueta, textoDe, type Nodo } from "../../../pruebas/arbol-html";
import {
  filaDeEjemplo,
  filaSinDiagnostico,
  filaSinRespuestasAutorizadas,
  habilidadesDeEjemplo,
} from "../../../pruebas/vista-del-monitor-ejemplo";
import { leerVistaDelMonitor, TEXTOS, type VistaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import { DiagnosticoDelMonitor } from "./DiagnosticoDelMonitor";

// HU-022: el marcado del diagnóstico para el monitor. Se lee el HTML (`renderToStaticMarkup`) como las pruebas del resultado de la
// persona. La vista sale del lector real, con una fila como la que devuelve la base.

const vistaDe = (fila: Record<string, unknown>): VistaDelMonitor => leerVistaDelMonitor([fila])!;
const pintar = (fila: Record<string, unknown> = filaDeEjemplo()) => renderToStaticMarkup(createElement(DiagnosticoDelMonitor, { vista: vistaDe(fila) }));
const arbolDe = (fila?: Record<string, unknown>) => leerHtml(pintar(fila));
const textoVisible = (html: string) => textoDe(leerHtml(html));

/** La sección cuyo título (h2) dice eso. */
function seccion(arbol: Nodo, titulo: string): Nodo {
  const encontrada = porEtiqueta(arbol, "section").find((s) => textoDe(porEtiqueta(s, "h2")[0]) === titulo);
  if (!encontrada) throw new Error(`No hay una sección «${titulo}».`);
  return encontrada;
}

/** Las tarjetas (li) de una lista, con su nivel escrito y su renglón de respuestas. */
const tarjetasDe = (lista: Nodo) => elementosHijos(lista).map((li) => textoDe(li));

describe("el orden de las secciones", () => {
  it("la nota de repetido, el resumen, las habilidades, los errores, los prerrequisitos y las preguntas", () => {
    const arbol = arbolDe(filaDeEjemplo({ repetido: true }));
    const titulos = porEtiqueta(arbol, "h2").map(textoDe);
    expect(titulos).toEqual(["Resumen del diagnóstico", "Habilidades", "Errores", "Prerrequisitos", "Preguntas"]);
    // La nota va antes del primer título.
    const html = pintar(filaDeEjemplo({ repetido: true }));
    expect(html.indexOf(TEXTOS.repetido)).toBeGreaterThan(-1);
    expect(html.indexOf(TEXTOS.repetido)).toBeLessThan(html.indexOf("Resumen del diagnóstico"));
  });

  it("cada sección está nombrada por su título", () => {
    const arbol = arbolDe();
    const secciones = porEtiqueta(arbol, "section");
    expect(secciones).toHaveLength(5);
    for (const s of secciones) {
      const titulo = porEtiqueta(s, "h2")[0];
      expect(s.atributos["aria-labelledby"]).toBe(titulo.atributos.id);
      expect(titulo.atributos.id).toBeTruthy();
    }
    const ids = porEtiqueta(arbol, "h2").map((h) => h.atributos.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resumen (criterio 3)", () => {
  const arbol = arbolDe();
  const resumen = textoDe(seccion(arbol, "Resumen del diagnóstico"));

  it("la Evaluación, la fecha y «5 de 8 correctas»: preguntas acertadas de las respondidas, no habilidades (M41)", () => {
    expect(resumen).toContain("Evaluación: Parcial 1");
    expect(resumen).toContain("5 de 8 correctas");
    // Las habilidades del ejemplo suman 9 aciertos de 12 respuestas: no se usan.
    expect(resumen).not.toContain("9 de 12");
  });

  it("la fecha es la del día en Bogotá: 23:30 del 4 de octubre, que ya es el 5 en UTC (M42)", () => {
    expect(resumen).toContain("4 de octubre de 2026");
    expect(resumen).toContain("11:30");
    expect(resumen).not.toContain("5 de octubre");
    const tiempo = porEtiqueta(arbol, "time")[0];
    expect(tiempo.atributos.datetime).toBe("2026-10-05T04:30:00.000Z");
  });

  it("la fecha lleva la hora de Bogotá con el «p. m.» unido por espacios duros", () => {
    expect(resumen).toMatch(/11:30\s+p\.\s+m\./);
    expect(pintar()).toContain("11:30 p. m.");
  });
});

describe("habilidades (criterios 1, 5 y 17)", () => {
  const arbol = arbolDe();
  const habilidades = seccion(arbol, "Habilidades");
  const listaDeMirar = elementosHijos(habilidades).find((hijo) => hijo.etiqueta === "ul")!;

  it("las que hay que mirar, por nivel y con el nivel escrito, y dentro de cada nivel el orden de la materia", () => {
    expect(tarjetasDe(listaDeMirar)).toEqual([
      "interpreta gráficas de posiciónNo lo domina2 respuestas · 0 aciertos",
      "lee un diagrama de fuerzasNo lo domina1 respuesta · 0 aciertos",
      "aplica la conservación de la energíaEn proceso2 respuestas · 1 acierto",
      "relaciona trabajo y energía cinéticaEn proceso1 respuesta · 1 acierto",
      "resuelve problemas con rozamientoSin medirNo se midió",
    ]);
  });

  it("el nivel va en tercera persona: «Lo domina», no «Lo dominas»", () => {
    const t = textoDe(habilidades);
    expect(t).toContain("No lo domina");
    expect(t).not.toContain("Lo dominas");
    expect(t).not.toContain("No lo dominas");
  });

  it("«Lo domina (N)» es un resumen plegable con el número de las que domina: 3 y no 8 ni 5 (M44, M59)", () => {
    const plegables = porEtiqueta(habilidades, "details");
    expect(plegables).toHaveLength(1);
    const resumen = porEtiqueta(plegables[0], "summary")[0];
    expect(textoDe(resumen)).toBe("Lo domina (3)");
    const adentro = elementosHijos(plegables[0]).find((hijo) => hijo.etiqueta === "ul")!;
    expect(tarjetasDe(adentro)).toEqual([
      "calcula la fuerza neta con $F = ma$Lo domina3 respuestas · 3 aciertos".replace("$F = ma$", textoDe(porEtiqueta(adentro, "math")[0])),
      "descompone vectoresLo domina1 respuesta · 1 acierto",
      "usa la segunda ley de NewtonLo domina2 respuestas · 2 aciertos",
    ]);
    // Cerrado por omisión: el atributo `open` no está.
    expect(plegables[0].atributos).not.toHaveProperty("open");
    // Las que hay que mirar no están dentro del plegable.
    expect(porEtiqueta(plegables[0], "li").length).toBe(3);
  });

  it("el resumen del plegable es un `summary` de la clase que le da 44 px de alto", () => {
    expect(porClase(habilidades, "resumenDelPlegable")).toHaveLength(1);
    expect(porClase(habilidades, "resumenDelPlegable")[0].etiqueta).toBe("summary");
  });

  it("sin habilidades que domine no hay plegable ni «Lo domina» (M44)", () => {
    const sinDominadas = habilidadesDeEjemplo().map((h) => (h.nivel === "lo_domina" ? { ...h, nivel: "en_proceso" } : h));
    const html = pintar(filaDeEjemplo({ habilidades: sinDominadas }));
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(textoVisible(html)).not.toContain("Lo domina");
  });

  it("si todas las domina, no queda lista de las que hay que mirar y todo va plegado con su número", () => {
    const todas = habilidadesDeEjemplo().map((h) => ({ ...h, nivel: "lo_domina", respuestas: 1, aciertos: 1 }));
    const arbolTodas = arbolDe(filaDeEjemplo({ habilidades: todas }));
    const h = seccion(arbolTodas, "Habilidades");
    expect(elementosHijos(h).filter((hijo) => hijo.etiqueta === "ul")).toHaveLength(0);
    expect(textoDe(porEtiqueta(h, "summary")[0])).toBe("Lo domina (8)");
  });

  it("«No se midió» solo en la que está sin medir y sin respuestas, y «1 respuesta» en singular (criterio 5)", () => {
    const t = textoDe(habilidades);
    expect(t.match(/No se midió/g)).toHaveLength(1);
    expect(t).toContain("1 respuesta · 1 acierto");
    expect(t).not.toContain("1 respuestas");
    expect(t).not.toContain("1 aciertos");
    const sinMedirConRespuestas = habilidadesDeEjemplo().map((h) => (h.nivel === "sin_medir" ? { ...h, respuestas: 1, aciertos: 0 } : h));
    expect(textoVisible(pintar(filaDeEjemplo({ habilidades: sinMedirConRespuestas })))).not.toContain("No se midió");
  });

  it("no explica por qué no se midió", () => {
    const t = textoVisible(pintar()).toLowerCase();
    for (const motivo of ["falta de material", "falta material", "tope", "sin preguntas sin ver"]) expect(t).not.toContain(motivo);
  });

  it("el nivel guardado es el que se muestra aunque las cifras lo contradigan (M40)", () => {
    const contradice = [{ descripcion: "rara", nivel: "no_lo_domina", respuestas: 3, aciertos: 3 }];
    const t = textoVisible(pintar(filaDeEjemplo({ habilidades: contradice })));
    expect(t).toContain("raraNo lo domina3 respuestas · 3 aciertos");
    expect(t).not.toContain("Lo domina");
  });

  it("18 habilidades: todas salen una vez, las que domina plegadas con su número", () => {
    const niveles = ["lo_domina", "en_proceso", "no_lo_domina", "sin_medir", "lo_domina", "no_lo_domina"];
    const dieciocho = Array.from({ length: 18 }, (_, i) => ({
      descripcion: `habilidad número ${i + 1}`,
      nivel: niveles[i % niveles.length],
      respuestas: niveles[i % niveles.length] === "sin_medir" ? 0 : 2,
      aciertos: niveles[i % niveles.length] === "lo_domina" ? 2 : niveles[i % niveles.length] === "sin_medir" ? 0 : 1,
    }));
    const a = arbolDe(filaDeEjemplo({ habilidades: dieciocho }));
    const h = seccion(a, "Habilidades");
    expect(porEtiqueta(h, "li")).toHaveLength(18);
    expect(textoDe(porEtiqueta(h, "summary")[0])).toBe("Lo domina (6)");
    expect(porEtiqueta(porEtiqueta(h, "details")[0], "li")).toHaveLength(6);
  });

  it("la fórmula de una descripción se dibuja como <math> (M46)", () => {
    expect(pintar()).toContain("<math");
    expect(pintar()).not.toContain("$F = ma$");
  });
});

describe("errores (criterio 2)", () => {
  const arbol = arbolDe();
  const errores = seccion(arbol, "Errores");
  const tarjetas = elementosHijos(elementosHijos(errores).find((hijo) => hijo.etiqueta === "ul")!);

  it("los confirmados primero y cada uno con su prefijo en texto (M15)", () => {
    const iniciales = tarjetas.map((t) => textoDe(porEtiqueta(t, "p")[0]).split(":")[0]);
    expect(iniciales).toEqual(["Error detectado", "Posible error", "Posible error", "Posible error"]);
  });

  it("los prefijos no están cambiados", () => {
    const t = textoDe(errores);
    expect(t).toContain("Error detectado: usas");
    expect(t).toContain("Posible error: confundes energía con potencia");
    expect(t).not.toContain("Posible error: usas");
    expect(t).not.toContain("Error detectado: confundes");
  });

  it("«Lo eligió N veces», con «1 vez» en singular", () => {
    expect(tarjetas.map((t) => textoDe(t).match(/Lo eligió \d+ (?:vez|veces)/)?.[0])).toEqual(["Lo eligió 2 veces", "Lo eligió 1 vez", "Lo eligió 1 vez", "Lo eligió 1 vez"]);
    expect(textoDe(errores)).not.toContain("1 veces");
  });

  it("«Habilidad: …» también si la habilidad no es de la Evaluación, y ninguno cuando solo había la clave (M16, M17)", () => {
    const habilidad = tarjetas.map((t) => /Habilidad: (.*?)(?:Revisa|La fricción|$)/.exec(textoDe(t))?.[1]);
    expect(habilidad).toEqual(["interpreta gráficas de posición", "aplica la conservación de la energía", "calcula el trabajo de la fricción", undefined]);
    expect(textoDe(errores).match(/Habilidad:/g)).toHaveLength(3);
  });

  it("el detalle sale cuando la opción elegida trae texto propio y no sale cuando no lo trae", () => {
    const t = tarjetas.map(textoDe);
    expect(t[0]).toContain("Revisa qué magnitud va arriba.");
    expect(t[1]).not.toMatch(/Revisa|fricción también/);
    expect(t[2]).toContain("La fricción también hace trabajo.");
    expect(t[2]).toContain("Piensa en el sentido del movimiento.");
    // Ningún párrafo vacío por un error sin detalle.
    expect(pintar()).not.toMatch(/<p[^>]*><\/p>/);
  });

  it("una fórmula en el título sale como <math> y no como texto (M46)", () => {
    const html = pintar();
    expect(html).toContain('<math aria-label="1 sobre 2">');
    expect(html).not.toContain(String.raw`$\frac`);
  });

  it("sin errores dice «No se detectaron errores concretos.», no la frase de la persona", () => {
    const t = textoDe(seccion(arbolDe(filaDeEjemplo({ errores: [] })), "Errores"));
    expect(t).toBe("ErroresNo se detectaron errores concretos.");
    expect(t).not.toContain("No detectamos");
    expect(textoVisible(pintar(filaDeEjemplo({ errores: [] })))).not.toContain("Error detectado");
  });
});

describe("prerrequisitos (criterio 2)", () => {
  it("una lista sin repetir, con la materia entre paréntesis solo cuando es de otra", () => {
    const prerrequisitos = seccion(arbolDe(), "Prerrequisitos");
    const items = elementosHijos(porEtiqueta(prerrequisitos, "ul")[0]).map(textoDe);
    expect(items).toEqual(["despeja una incógnita", "deriva polinomios (Cálculo Diferencial)"]);
    expect(textoDe(prerrequisitos)).not.toContain("Conviene repasar antes");
  });

  it("la fórmula de un prerrequisito se dibuja como <math> (M46)", () => {
    const html = pintar(filaDeEjemplo({ prerrequisitos: [{ materia: "Cálculo Diferencial", descripcion: String.raw`deriva $x^2$` }] }));
    expect(html).toContain('<math aria-label="x al cuadrado">');
    expect(html).not.toContain("$x^2$");
    expect(textoDe(seccion(leerHtml(html), "Prerrequisitos"))).toContain("(Cálculo Diferencial)");
  });

  it("sin prerrequisitos no hay sección ni título", () => {
    const html = pintar(filaDeEjemplo({ prerrequisitos: [] }));
    expect(html).not.toContain("Prerrequisitos");
    expect(porEtiqueta(leerHtml(html), "h2").map(textoDe)).toEqual(["Resumen del diagnóstico", "Habilidades", "Errores", "Preguntas"]);
  });
});

describe("la nota de repetido (criterio 15)", () => {
  it("sale con un diagnóstico repetido, sin ninguna región de estado", () => {
    const html = pintar(filaDeEjemplo({ repetido: true }));
    expect(textoVisible(html)).toContain("Lo tomó otra vez; puede incluir preguntas que ya había visto");
    const nota = porEtiqueta(leerHtml(html), "p").find((p) => textoDe(p) === TEXTOS.repetido)!;
    expect(nota).toBeDefined();
    expect(nota.atributos).not.toHaveProperty("role");
  });

  it("no sale con uno que no lo es, ni con el texto viejo ni con una pista de repetido (M45)", () => {
    const t = textoVisible(pintar(filaDeEjemplo({ repetido: false }))).toLowerCase();
    expect(t).not.toContain("otra vez");
    expect(t).not.toContain("repetid");
    expect(t).not.toContain("ya había visto");
  });

  it("tampoco sale con un Lead del texto viejo si el diagnóstico no es repetido", () => {
    expect(textoVisible(pintar(filaSinRespuestasAutorizadas()))).not.toContain("otra vez");
    expect(textoVisible(pintar(filaSinRespuestasAutorizadas({ repetido: true })))).toContain("Lo tomó otra vez");
  });
});

describe("sin diagnóstico (criterio 6)", () => {
  const html = pintar(filaSinDiagnostico());

  it("dice el mensaje de la HU y nada más, en una región de estado", () => {
    expect(html).toMatch(/^<p role="status" class="[^"]*">No hay diagnóstico de esta materia ligado a esta monitoría\.<\/p>$/);
    expect(textoVisible(html)).toBe(TEXTOS.sinDiagnostico);
  });

  it("no pinta títulos, resumen, habilidades ni preguntas (M52)", () => {
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("<section");
    expect(html).not.toContain("Resumen");
    expect(html).not.toContain("Habilidades");
  });

  it("no es un error: no hay alerta", () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe("las preguntas en el detalle (criterio 14)", () => {
  it("con la autorización nueva: la sección «Preguntas» con las ocho, sin región de estado", () => {
    const html = pintar();
    const arbol = leerHtml(html);
    const preguntas = seccion(arbol, "Preguntas");
    expect(porEtiqueta(preguntas, "h3")).toHaveLength(8);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain(TEXTOS.noAutorizo);
  });

  it("con el texto viejo: el resto de la vista, el mensaje de «no autorizó» y ningún enunciado, opción ni solución (M20)", () => {
    const html = pintar(filaSinRespuestasAutorizadas());
    const arbol = leerHtml(html);
    expect(porEtiqueta(arbol, "h2").map(textoDe)).toEqual(["Resumen del diagnóstico", "Habilidades", "Errores", "Prerrequisitos", "Preguntas"]);
    expect(textoDe(seccion(arbol, "Preguntas"))).toBe(`Preguntas${TEXTOS.noAutorizo}`);
    for (const ausente of ["Enunciado de la pregunta", "Opción A", "Solución de la pregunta", "Acertó", "Falló", "Eligió", "Correcta"]) {
      expect(html, ausente).not.toContain(ausente);
    }
    // Y lo demás sigue ahí.
    expect(textoVisible(html)).toContain("5 de 8 correctas");
    expect(textoVisible(html)).toContain("Error detectado: usas");
  });

  it("una sola región de estado en toda la pantalla, en cada caso (hecho 11)", () => {
    const cuenta = (fila: Record<string, unknown>) => pintar(fila).match(/role="status"/g)?.length ?? 0;
    expect(cuenta(filaDeEjemplo())).toBe(0);
    expect(cuenta(filaDeEjemplo({ repetido: true }))).toBe(0);
    expect(cuenta(filaSinRespuestasAutorizadas())).toBe(1);
    expect(cuenta(filaSinDiagnostico())).toBe(1);
    expect(pintar().match(/role="alert"/g)).toBeNull();
  });
});

describe("lo que nunca sale (criterio 13)", () => {
  it("nada de lo que el lector descarta aparece en el marcado", () => {
    const fila = filaDeEjemplo({
      correo: "camila@centinela.example",
      numero_telefono: "3009998877",
      token_recuperacion: "token-secreto-0022",
      semilla: 4242,
    });
    const html = pintar(fila);
    for (const secreto of ["camila@centinela.example", "3009998877", "token-secreto-0022", "4242", "habilidad-secreta", "misc-secreta"]) {
      expect(html, secreto).not.toContain(secreto);
    }
  });

  it("el texto hostil de la base sale escapado en todos los lugares donde hay texto del banco", () => {
    const hostil = "<img src=x onerror=alert(1)>";
    const html = pintar(
      filaDeEjemplo({
        habilidades: [{ descripcion: hostil, nivel: "no_lo_domina", respuestas: 1, aciertos: 0 }],
        errores: [{ titulo: hostil, estado: "confirmada", veces: 1, descripcionDeLaHabilidad: hostil, detalles: [hostil] }],
        prerrequisitos: [{ materia: hostil, descripcion: hostil }],
        nombre_evaluacion: hostil,
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
