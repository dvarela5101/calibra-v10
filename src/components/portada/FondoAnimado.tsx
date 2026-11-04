import type { CSSProperties } from "react";
import { DIBUJOS, type NombreDeDibujo } from "./trazos-de-fondo";
import estilos from "./portada.module.css";

/**
 * HU-122 (D-88) y HU-125: la decoración de las dos landings, un cuaderno que se va llenando con trazos de todas las materias a
 * medida que se baja. Es SVG con una animación CSS ligada al scroll: no lleva JavaScript de cliente ni dependencias. Los trazos son
 * decorativos, así que un lector de pantalla no lee nada. Esta capa lleva los dibujos de los márgenes; los grandes van en cada
 * sección (`CurvaDeFondo`), en el espacio libre debajo de su título.
 */

/** Los márgenes, de arriba abajo y alternando de lado: `j` corre el dibujo a un lado del centro del margen. Las materias van mezcladas. */
const MARGEN: readonly { dibujo: NombreDeDibujo; j: number }[] = [
  { dibujo: "derivadaParcial", j: 0.2 },
  { dibujo: "matraz", j: -0.4 },
  { dibujo: "factorial", j: -0.3 },
  { dibujo: "atomo", j: 0.3 },
  { dibujo: "libro", j: 0.5 },
  { dibujo: "etiqueta", j: -0.2 },
  { dibujo: "adn", j: -0.5 },
  { dibujo: "ofertaPequena", j: 0.4 },
  { dibujo: "integral", j: 0.1 },
  { dibujo: "benceno", j: -0.5 },
  { dibujo: "fuerza", j: -0.3 },
  { dibujo: "arbol", j: 0.2 },
  { dibujo: "balanza", j: 0.4 },
  { dibujo: "sumatoria", j: -0.1 },
  { dibujo: "celula", j: -0.4 },
  { dibujo: "pesos", j: 0.5 },
  { dibujo: "pendulo", j: 0.1 },
  { dibujo: "comillas", j: -0.4 },
  { dibujo: "matriz", j: -0.2 },
  { dibujo: "tubo", j: 0.5 },
  { dibujo: "globo", j: 0.3 },
  { dibujo: "flujo", j: -0.3 },
  { dibujo: "energia", j: -0.1 },
  { dibujo: "nota", j: 0.4 },
  { dibujo: "campanaPequena", j: 0.2 },
  { dibujo: "hoja", j: -0.5 },
  { dibujo: "raiz", j: -0.3 },
  { dibujo: "columna", j: 0.3 },
  { dibujo: "circuito", j: 0.1 },
  { dibujo: "pregunta", j: -0.2 },
  { dibujo: "pi", j: -0.5 },
  { dibujo: "llaves", j: 0.2 },
  { dibujo: "venn", j: 0.4 },
  { dibujo: "agua", j: -0.4 },
  { dibujo: "brujula", j: -0.2 },
  { dibujo: "cuentaT", j: 0.3 },
];

/** La variable que usa la hoja de estilos para repartir el dibujo; TypeScript no conoce las propiedades personalizadas. */
const variables = (valores: Record<`--${string}`, number | string>, resto: CSSProperties = {}) => ({ ...valores, ...resto }) as CSSProperties;

export function FondoAnimado() {
  return (
    <div className={estilos.fondoAnimado} aria-hidden="true" data-fondo-animado="">
      {MARGEN.map(({ dibujo, j }, i) => (
        <Trazos
          key={dibujo}
          dibujo={dibujo}
          clase={`${estilos.trazoDeMargen} ${i % 2 === 0 ? estilos.margenIzquierdo : estilos.margenDerecho}`}
          estilo={variables({ "--j": j }, { insetBlockStart: `${(((i + 0.25) / MARGEN.length) * 100).toFixed(1)}%` })}
          marca={{ "data-simbolo": "" }}
        />
      ))}
    </div>
  );
}

/** Un dibujo grande, anclado a la sección que lo contiene. La sección lleva `estilos.conCurva`. */
export function CurvaDeFondo({ forma, clase }: { forma: NombreDeDibujo; clase: string }) {
  return <Trazos dibujo={forma} clase={`${estilos.curvaDeFondo} ${clase}`} marca={{ "data-curva": "" }} />;
}

function Trazos({ dibujo, clase, estilo, marca }: { dibujo: NombreDeDibujo; clase: string; estilo?: CSSProperties; marca: Record<string, string> }) {
  const { ancho, alto, trazos } = DIBUJOS[dibujo];
  return (
    <svg
      className={`${estilos.trazoDeFondo} ${clase}`}
      viewBox={`0 0 ${ancho} ${alto}`}
      style={variables({ "--ancho": ancho, "--n": trazos.length }, estilo)}
      aria-hidden="true"
      focusable="false"
      data-dibujo={dibujo}
      {...marca}
    >
      {trazos.map((d: string, i: number) => (
        <path key={`${i}-${d}`} pathLength={1} d={d} style={variables({ "--i": i })} />
      ))}
    </svg>
  );
}
