// Ejemplos de fórmulas para las pruebas del dibujo (HU-083). Los importan Vitest (src/lib/contenido/mate.test.ts) y la e2e
// (e2e/texto-del-banco.spec.ts). Cada ejemplo es lo que va ENTRE los $, sin ellos.
//
// Un comando nuevo en COMANDOS_MATE (scripts/contenido/matematica.mts) sin su ejemplo aquí hace fallar la prueba. De los 67
// comandos, el banco de hoy usa 24: los otros 43 nunca se han dibujado con datos reales, y esta tabla es lo único que los
// ejercita.

/** Un ejemplo mínimo y válido por comando, que contiene ese comando. La clave del espacio fino es la coma. */
export const EJEMPLO_POR_COMANDO: Readonly<Record<string, string>> = {
  // estructura
  frac: String.raw`\frac{a}{b}`,
  sqrt: String.raw`\sqrt{x}`,
  int: String.raw`\int_0^1 x`,
  iint: String.raw`\iint_D f`,
  oint: String.raw`\oint_C f`,
  sum: String.raw`\sum_{n=1}^{\infty} a_n`,
  prod: String.raw`\prod_{k=1}^{n} k`,
  lim: String.raw`\lim_{x \to 0} f(x)`,
  left: String.raw`\left( x \right)`,
  right: String.raw`\left[ x \right]`,
  text: String.raw`a \text{si} b`,
  vec: String.raw`\vec{v}`,
  bar: String.raw`\bar{x}`,
  hat: String.raw`\hat{x}`,
  mathrm: String.raw`\mathrm{d}x`,
  // funciones
  sen: String.raw`\sen x`,
  sin: String.raw`\sin x`,
  cos: String.raw`\cos x`,
  tan: String.raw`\tan x`,
  sec: String.raw`\sec x`,
  csc: String.raw`\csc x`,
  cot: String.raw`\cot x`,
  ln: String.raw`\ln x`,
  log: String.raw`\log x`,
  exp: String.raw`\exp x`,
  // griegas
  alpha: String.raw`\alpha`,
  beta: String.raw`\beta`,
  gamma: String.raw`\gamma`,
  delta: String.raw`\delta`,
  epsilon: String.raw`\epsilon`,
  varepsilon: String.raw`\varepsilon`,
  theta: String.raw`\theta`,
  lambda: String.raw`\lambda`,
  mu: String.raw`\mu`,
  nu: String.raw`\nu`,
  pi: String.raw`\pi`,
  rho: String.raw`\rho`,
  sigma: String.raw`\sigma`,
  tau: String.raw`\tau`,
  phi: String.raw`\phi`,
  varphi: String.raw`\varphi`,
  omega: String.raw`\omega`,
  Delta: String.raw`\Delta x`,
  Sigma: String.raw`\Sigma`,
  Omega: String.raw`\Omega`,
  Gamma: String.raw`\Gamma`,
  Phi: String.raw`\Phi`,
  // símbolos
  le: String.raw`a \le b`,
  leq: String.raw`a \leq b`,
  ge: String.raw`a \ge b`,
  geq: String.raw`a \geq b`,
  ne: String.raw`a \ne b`,
  neq: String.raw`a \neq b`,
  approx: String.raw`a \approx b`,
  pm: String.raw`a \pm b`,
  mp: String.raw`a \mp b`,
  to: String.raw`x \to 0`,
  rightarrow: String.raw`x \rightarrow 0`,
  infty: String.raw`\infty`,
  cdot: String.raw`a \cdot b`,
  times: String.raw`a \times b`,
  div: String.raw`a \div b`,
  partial: String.raw`\partial x`,
  nabla: String.raw`\nabla f`,
  // espacios
  ",": String.raw`a\,b`,
  ";": String.raw`a\;b`,
  quad: String.raw`a\quad b`,
};

/** Fórmulas con varios niveles, donde el navegador encoge más el texto (subíndices, fracciones y raíces dentro de otras). */
export const FORMULAS_ANIDADAS: readonly string[] = [
  String.raw`x_{i_j}`,
  String.raw`x_{a_{b_{c_d}}}`,
  String.raw`\frac{\frac{1}{2}}{3}`,
  String.raw`\frac{1}{1 + \frac{1}{1 + \frac{1}{x}}}`,
  String.raw`\sqrt[3]{x^{2}}`,
  String.raw`\sqrt{\frac{a_n}{b_n}}`,
  String.raw`a_{n+1}^{2}`,
  String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}`,
  String.raw`\int_{a_1}^{b^2} \frac{f(x)}{g_{k}(x)}\,dx`,
  String.raw`\lim_{x_0 \to \infty} \frac{\sen^2 x}{x_0^{2}}`,
  String.raw`\left( \frac{a_i}{b_i} \right)^{2}`,
  String.raw`e^{-\frac{x^{2}}{2}}`,
];
