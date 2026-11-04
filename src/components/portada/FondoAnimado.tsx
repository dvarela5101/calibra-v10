import type { ReactNode } from "react";
import estilos from "./portada.module.css";

/**
 * HU-122 (D-88): la decoración de las dos landings, un papel cuadriculado que se está usando, en el azul de la marca y tenue. Es SVG
 * con animaciones CSS: no lleva JavaScript de cliente ni dependencias. Los trazos son decorativos y no texto, así que un lector de
 * pantalla no lee nada. Esta capa lleva los símbolos, que flotan muy lento en los márgenes de la página; las curvas se dibujan una
 * vez al cargar y van en cada sección (`CurvaDeFondo`), en el espacio libre debajo de su título.
 */
export function FondoAnimado() {
  return (
    <div className={estilos.fondoAnimado} aria-hidden="true" data-fondo-animado="">
      <Simbolo clase={estilos.simboloIntegral} caja="0 0 40 80">
        <path d="M30 8C24 2 18 6 18 18C19 34 21 46 21 62C21 74 15 78 9 72" />
      </Simbolo>
      <Simbolo clase={estilos.simboloSuma} caja="0 0 48 56">
        <path d="M41 9C30 7 18 7 7 8C14 17 20 22 27 28C20 34 14 40 6 48C18 50 30 49 42 47" />
      </Simbolo>
      <Simbolo clase={estilos.simboloPi} caja="0 0 56 48">
        <path d="M6 14C20 9 36 11 50 8M20 12C20 24 18 34 12 42M36 11C36 24 37 34 46 41" />
      </Simbolo>
      <Simbolo clase={estilos.simboloRaiz} caja="0 0 72 56">
        <path d="M4 32L12 27C16 34 19 42 22 50C27 34 31 20 37 7C48 6 58 7 68 6" />
      </Simbolo>
      <Simbolo clase={estilos.simboloDelta} caja="0 0 56 52">
        <path d="M28 6C22 20 14 34 6 46C20 45 36 45 50 46C42 32 35 18 28 6Z" />
      </Simbolo>
      <Simbolo clase={estilos.simboloInfinito} caja="0 0 72 40">
        <path d="M36 20C28 8 12 4 7 15C3 27 18 35 36 20C46 8 62 3 66 15C69 28 50 34 36 20Z" />
      </Simbolo>
    </div>
  );
}

const FORMAS = {
  /** Una onda seno. */
  seno: {
    caja: "0 0 560 120",
    trazos: ["M4 62C44 8 76 4 114 60S186 116 226 60 298 6 338 62 410 116 450 60 522 8 556 58"],
  },
  /** Una parábola con su tangente. */
  parabola: {
    caja: "0 0 300 260",
    trazos: ["M22 232C100 235 200 233 290 230M48 252C50 170 47 90 50 12", "M78 24C104 142 136 202 170 203S236 142 262 24", "M92 232C140 196 196 158 268 112"],
  },
  /** El área bajo una curva, con los rectángulos de la suma de Riemann. */
  area: {
    caja: "0 0 320 240",
    trazos: ["M20 214C100 217 210 212 306 213M38 232C40 160 37 80 40 12", "M46 188C96 170 120 60 176 54S258 110 298 150", "M70 214V164H110V94H150V62H190V58H230V88H270V214"],
  },
  /** Una exponencial con sus ejes. */
  exponencial: {
    caja: "0 0 260 280",
    trazos: ["M14 244C90 246 170 243 246 245M60 266C62 180 58 90 61 14", "M18 232C110 226 170 190 208 22"],
  },
  /** El círculo unitario con un ángulo. */
  circulo: {
    caja: "0 0 280 280",
    trazos: ["M10 141C90 143 190 139 270 140M141 270C143 190 139 90 140 10", "M140 40C196 39 240 84 240 140S196 241 140 240 40 196 40 140 84 41 140 40Z", "M140 140L212 70V140M170 140C170 130 166 122 161 118"],
  },
} as const;

/** Una curva decorativa, anclada a la sección que la contiene. La sección lleva `estilos.conCurva`. */
export function CurvaDeFondo({ forma, clase }: { forma: keyof typeof FORMAS; clase: string }) {
  const { caja, trazos } = FORMAS[forma];
  return (
    <svg className={`${estilos.trazoDeFondo} ${estilos.curvaDeFondo} ${clase}`} viewBox={caja} aria-hidden="true" focusable="false" data-curva="">
      {trazos.map((d) => (
        <path key={d} pathLength={1} d={d} />
      ))}
    </svg>
  );
}

function Simbolo({ clase, caja, children }: { clase: string; caja: string; children: ReactNode }) {
  return (
    <svg className={`${estilos.trazoDeFondo} ${estilos.simboloDeFondo} ${clase}`} viewBox={caja} focusable="false" data-simbolo="">
      {children}
    </svg>
  );
}
