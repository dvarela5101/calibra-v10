// Revisión ligera de la matemática del banco (HU-005): fórmulas entre $…$ con un subconjunto de TeX.
//
// Portado tal cual de contenido/convertir.js del prototipo (COMANDOS_MATE, tramosMate y revisarMate,
// líneas 61-160) para que el banco migrado pase exactamente las mismas reglas que pasaba allá. Solo se
// cambió la redacción de los mensajes (con tildes) y la forma de detectar caracteres de control.
//
// El texto sigue siendo texto plano: quien dibuje las preguntas (HU-009) convierte cada $…$ en MathML.
// Aquí solo se atrapan errores de tipeo antes de que lleguen a un estudiante. \$ es un signo de pesos
// literal y no abre ni cierra nada.

// Los comandos que entiende el dibujo de fórmulas del prototipo (matematica() en index.html). Si el
// componente que dibuje las fórmulas en v10 acepta uno nuevo, hay que agregarlo aquí también.
export const COMANDOS_MATE: readonly string[] = [
  "frac", "sqrt", "int", "iint", "oint", "sum", "prod", "lim",
  "sen", "sin", "cos", "tan", "sec", "csc", "cot", "ln", "log", "exp",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "theta", "lambda",
  "mu", "nu", "pi", "rho", "sigma", "tau", "phi", "varphi", "omega",
  "Delta", "Sigma", "Omega", "Gamma", "Phi",
  "le", "leq", "ge", "geq", "ne", "neq", "approx", "pm", "mp",
  "to", "rightarrow", "infty", "cdot", "times", "div", "partial", "nabla",
  "left", "right", "text", "vec", "bar", "hat", "mathrm",
  // espacios
  ",", ";", "quad",
];

export interface TramoMate {
  /** El tramo está entre $…$. */
  mate: boolean;
  texto: string;
  /** Posición del tramo en el texto original. */
  desde: number;
}

/** Parte el texto en tramos normales y de matemática, respetando \$. `abierto`: quedó un $ sin cerrar. */
export function tramosMate(texto: string): { tramos: TramoMate[]; abierto: boolean } {
  const tramos: TramoMate[] = [];
  let enMate = false;
  let desde = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === "\\") {
      i += 1;
      continue;
    }
    if (texto[i] === "$") {
      tramos.push({ mate: enMate, texto: texto.slice(desde, i), desde });
      enMate = !enMate;
      desde = i + 1;
    }
  }
  tramos.push({ mate: enMate, texto: texto.slice(desde), desde });
  return { tramos, abierto: enMate };
}

// Un tabulador o salto dentro de una fórmula casi siempre es un "\t" o "\n" que se comió la barra (por
// ejemplo "\text" escrito desde un script). Se compara el código en vez de usar una regex con caracteres
// de control, que eslint (no-control-regex) no deja escribir.
const esControl = (c: string) => c.charCodeAt(0) < 0x20;

/** Revisa un campo que ve el estudiante. Devuelve los problemas como frases para poner detrás del campo. */
export function revisarMate(texto: string): string[] {
  const problemas: string[] = [];
  const t = tramosMate(texto);
  if (t.abierto) {
    problemas.push('tiene un "$" sin cerrar (el número de "$" es impar; para un signo de pesos literal escribe \\$)');
    return problemas;
  }
  for (const tramo of t.tramos) {
    const s = tramo.texto;
    const reCmd = /\\([a-zA-Z]+|[^a-zA-Z]|$)/g;
    let m: RegExpExecArray | null;
    if (!tramo.mate) {
      while ((m = reCmd.exec(s)) !== null) {
        if (m[1] === "$") continue;
        problemas.push(`tiene "\\${m[1]}" fuera de $...$. Seguramente falta un "$"`);
      }
      continue;
    }
    if (!s.trim()) {
      problemas.push('tiene un "$$" vacío');
      continue;
    }
    if ([...s].some(esControl)) {
      const visible = [...s].map((c) => (esControl(c) ? "?" : c)).join("");
      problemas.push(`tiene un carácter de control (tabulador o salto) dentro de "$${visible}$"`);
      continue;
    }
    const cita = `"$${s}$"`;
    let profLR = 0;
    while ((m = reCmd.exec(s)) !== null) {
      const cmd = m[1];
      if (cmd === "$") continue;
      if (!COMANDOS_MATE.includes(cmd)) {
        problemas.push(`usa "\\${cmd}" en ${cita}, que no está soportado. Mira la lista en contenido/README.md`);
      }
      if (cmd === "left") profLR += 1;
      if (cmd === "right") {
        profLR -= 1;
        if (profLR < 0) {
          problemas.push(`tiene un \\right sin su \\left en ${cita}`);
          profLR = 0;
        }
      }
    }
    if (profLR > 0) problemas.push(`tiene un \\left sin su \\right en ${cita}`);
    // Llaves: se ignoran las escapadas (\{ \}), que de todos modos se reportan arriba.
    const sinEscapes = s.replace(/\\[^a-zA-Z]/g, "");
    let prof = 0;
    let malas = false;
    for (const c of sinEscapes) {
      if (c === "{") prof += 1;
      if (c === "}") {
        prof -= 1;
        if (prof < 0) {
          malas = true;
          prof = 0;
        }
      }
    }
    if (malas || prof !== 0) problemas.push(`tiene las llaves { } desbalanceadas en ${cita}`);
  }
  return problemas;
}
