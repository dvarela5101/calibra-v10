import { join } from "node:path";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { dibujarTexto } from "@/components/contenido/dibujar";
import { leerBanco, partirCercas } from "../../../scripts/contenido/banco.mts";
import { tramosMate } from "../../../scripts/contenido/matematica.mts";
import { partirEnunciado } from "./enunciado";
import { intentarAnalizar, partirMate } from "./mate";

// HU-083: el banco real (contenido/) pasa por el dibujo. `npm run contenido:validar` (revisarMate) solo mira las llaves, los
// comandos y los $: no ve que el dibujo rechaza `$50%$`, `$\frac12$` o `$x^$`, y el visitante vería esos textos con los signos de
// pesos. Esta prueba es la que lo atrapa, y reemplaza a window.__calibraMateErrores del prototipo. Corre en `npm test` y en CI.

const RAIZ_CONTENIDO = join(__dirname, "../../../contenido");

interface TextoDelBanco {
  /** Dónde está, para el mensaje de fallo. */
  donde: string;
  texto: string;
}

/** Todo texto que ve una persona: enunciados, opciones, textos de error propios, soluciones y descripciones. */
function textosDelBanco(): TextoDelBanco[] {
  const { banco, errores } = leerBanco(RAIZ_CONTENIDO);
  expect(errores, "el banco debe leerse sin errores").toEqual([]);
  const textos: TextoDelBanco[] = [];
  for (const materia of banco.materias) {
    for (const tema of materia.temas) {
      const en = (clave: string) => `${materia.carpeta}/${tema.clave}.md ${clave}`;
      for (const h of tema.habilidades) textos.push({ donde: en(`habilidad ${h.clave}`), texto: h.descripcion });
      for (const m of tema.misconcepciones) textos.push({ donde: en(`misconcepción ${m.clave}`), texto: m.descripcion });
      for (const p of tema.preguntas) {
        textos.push({ donde: en(`${p.clave} enunciado`), texto: p.enunciado });
        for (const o of p.opciones) {
          textos.push({ donde: en(`${p.clave} opción ${o.letra}`), texto: o.texto });
          if (o.error) textos.push({ donde: en(`${p.clave} error de ${o.letra}`), texto: o.error });
        }
        if (p.solucion) textos.push({ donde: en(`${p.clave} solución`), texto: p.solucion });
      }
    }
  }
  return textos;
}

/** El texto de cada `<pre><code>` del árbol de elementos, sin serializar. */
function programasDe(nodo: ReactNode): string[] {
  if (Array.isArray(nodo)) return nodo.flatMap(programasDe);
  if (!isValidElement<{ children?: ReactNode }>(nodo)) return [];
  if (nodo.type === "pre") {
    const code = nodo.props.children;
    const contenido = isValidElement<{ children?: ReactNode }>(code) ? code.props.children : undefined;
    return [typeof contenido === "string" ? contenido : "(estructura inesperada)"];
  }
  return programasDe(nodo.props.children);
}

const sinEscapeDeDolar = (texto: string) => texto.replace(/\\([\s\S])/g, (par, c: string) => (c === "$" ? "$" : par));

describe("el banco real pasa por el dibujo", () => {
  let textos: TextoDelBanco[] = [];
  beforeAll(() => {
    textos = textosDelBanco();
  });

  it("hay fórmulas y bloques de código que probar (un banco vacío no pasa en verde)", () => {
    let formulas = 0;
    let bloques = 0;
    for (const { texto } of textos) {
      for (const trozo of partirEnunciado(texto)) {
        if (trozo.codigo) bloques += 1;
        else formulas += partirMate(trozo.texto).filter((t) => t.mate).length;
      }
    }
    expect(textos.length).toBeGreaterThan(0);
    expect(formulas).toBeGreaterThan(0);
    expect(bloques).toBeGreaterThan(0);
  });

  it("(a) corta el texto en los mismos puntos que el convertidor", () => {
    const fallos: string[] = [];
    for (const { donde, texto } of textos) {
      const { tramos, abierto } = tramosMate(texto);
      const esperado = tramos
        .filter((tramo) => tramo.mate || tramo.texto !== "")
        .map((tramo) => ({ mate: tramo.mate, texto: tramo.mate ? tramo.texto : sinEscapeDeDolar(tramo.texto) }));
      const trozos = partirMate(texto);
      const real = trozos.map(({ mate, texto: t }) => ({ mate, texto: t }));
      if (JSON.stringify(real) !== JSON.stringify(esperado) || trozos.some((t) => t.abierto) !== abierto) fallos.push(donde);
    }
    expect(fallos).toEqual([]);
  });

  it("(b) cada fórmula se entiende y ningún $ queda sin cerrar", () => {
    const fallos: string[] = [];
    for (const { donde, texto } of textos) {
      for (const trozo of partirEnunciado(texto)) {
        if (trozo.codigo) continue;
        for (const parte of partirMate(trozo.texto)) {
          if (!parte.mate) continue;
          if (parte.abierto) {
            fallos.push(`${donde}: $ sin cerrar: ${parte.texto.slice(0, 60)}`);
            continue;
          }
          const resultado = intentarAnalizar(parte.texto);
          if (!resultado.ok) fallos.push(`${donde}: $${parte.texto}$ no se entiende (${resultado.motivo})`);
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  it("(c) los bloques de código son los mismos que ve el convertidor", () => {
    const fallos: string[] = [];
    for (const { donde, texto } of textos) {
      const esperado = partirCercas(texto)
        .filter((parte) => parte.codigo)
        .map((parte) => parte.texto.replace(/^\n+/, "").replace(/\s+$/, ""));
      const real = partirEnunciado(texto)
        .filter((trozo) => trozo.codigo)
        .map((trozo) => trozo.texto);
      if (JSON.stringify(real) !== JSON.stringify(esperado)) fallos.push(donde);
    }
    expect(fallos).toEqual([]);
  });

  it("(d) el dibujo no lanza, no deja barras ni signos de pesos a la vista y el código sale literal", () => {
    const fallos: string[] = [];
    for (const { donde, texto } of textos) {
      let dibujo: ReactNode;
      let marcado: string;
      try {
        dibujo = dibujarTexto(texto);
        marcado = renderToStaticMarkup(dibujo);
      } catch (error) {
        fallos.push(`${donde}: lanzó ${String(error)}`);
        continue;
      }
      // Dentro de un <pre> todo es literal (un "\n" de Python, un `$`, unas llaves): solo se mira lo de afuera.
      const fuera = marcado.replace(/<pre[\s\S]*?<\/pre>/g, "");
      if (fuera.includes("\\")) fallos.push(`${donde}: queda una barra a la vista`);
      // Un $ a la vista solo es válido si el texto trae un \$ (hoy no ocurre).
      if (fuera.includes("$") && !texto.includes("\\$")) fallos.push(`${donde}: queda un $ a la vista`);
      const programas = partirCercas(texto)
        .filter((parte) => parte.codigo)
        .map((parte) => parte.texto.replace(/^\n+/, "").replace(/\s+$/, ""));
      if (JSON.stringify(programasDe(dibujo)) !== JSON.stringify(programas)) fallos.push(`${donde}: el código no sale tal cual`);
    }
    expect(fallos).toEqual([]);
  });
});
