# Sustitución

## Habilidades
kc: sust-reconocer · Reconocer la derivada de la función interna para elegir u
kc: sust-dx · Reescribir dx en términos de du, con sus constantes
kc: sust-limites · Cambiar los límites de integración al sustituir

## Errores
mc: no-ve-derivada-interna · sust-reconocer · no reconoces cuándo un factor es la derivada de la función interna
mc: metodo-equivocado · sust-reconocer · aplicas un método o fórmula que no corresponde a la forma de la integral
mc: ignora-cadena · sust-reconocer · integras con la tabla ignorando la regla de la cadena
mc: olvida-constante-du · sust-dx · ajustas mal la constante al pasar de dx a du
mc: deja-x-mezclada · sust-dx · dejas x y u mezcladas en la misma integral
mc: dx-sin-convertir · sust-dx · cambias el integrando a u pero dejas dx sin convertir
mc: limites-sin-cambiar · sust-limites · usas los límites en x después de cambiar a la variable u
mc: limite-mal-calculado · sust-limites · calculas o asignas mal los límites nuevos en u
mc: limites-dos-veces · sust-limites · cambias los límites y además regresas a x, mezclando los dos caminos

## Preguntas

### P2 · dificultad 2 · kc: sust-reconocer · revisada · origen: humano · revisó: prototipo
En ∫ 2x·cos(x²) dx, ¿qué método aplicas?

- A) Integración por partes · [no-ve-derivada-interna] no reconoces que 2x es la derivada de x²
- B) Sustitución con u = x² · CORRECTA
- C) Fracciones parciales · [metodo-equivocado] aplicas un método que no corresponde a esta forma
- D) Integral directa de tabla · [ignora-cadena] ignoras la regla de la cadena

### P21 · dificultad 2 · kc: sust-reconocer, sust-dx · revisada · origen: ia (desconocido) · revisó: Juzou04
$\int 2x\cdot e^{x^2}\,dx$ es:

- A) $e^{x^2} + C$ · CORRECTA
- B) $x^2 e^{x^2} + C$ · [no-ve-derivada-interna] no reconoces que 2x es la derivada de x² e integras los factores por separado
- C) $\frac{e^{x^2}}{2x} + C$ · [ignora-cadena] divides por la derivada de la función interna como si fuera una constante
- D) $2e^{x^2} + C$ · [olvida-constante-du]

solución: el factor 2x es la derivada de la función interna x². Con u = x², du = 2x dx y la integral queda ∫ eᵘ du = eᵘ + C = e^(x²) + C. Comprobación: la derivada de e^(x²) es 2x·e^(x²). x²·e^(x²) sale de integrar los factores por separado; e^(x²)/(2x) divide entre 2x como si fuera constante; y 2e^(x²) deja un 2 de más, porque 2x dx ya es exactamente du.

### P22 · dificultad 3 · kc: sust-reconocer, sust-dx · revisada · origen: ia (desconocido) · revisó: Juzou04
¿Cómo se resuelve $\int \frac{x}{x^2 + 1}\,dx$?

- A) Con u = x² + 1, y da $\frac{1}{2}\ln(x^2 + 1) + C$ · CORRECTA
- B) Con u = x, porque es el numerador · [no-ve-derivada-interna] eliges u por la forma y no por la derivada de la función interna
- C) Directo: es arctan(x) + C · [metodo-equivocado] aplicas la fórmula de $\int \frac{1}{x^2 + 1}\,dx$, que no corresponde a esta forma
- D) Con u = x² + 1, y da $\ln(x^2 + 1) + C$ · [olvida-constante-du] olvidas el 1/2 al pasar de dx a du

solución: el numerador x es, salvo una constante, la derivada del denominador. Con u = x² + 1, du = 2x dx, así que x dx = du/2 y la integral queda (1/2)·∫ du/u = (1/2)·ln(x² + 1) + C (no hace falta valor absoluto porque x² + 1 > 0). Comprobación: la derivada es (1/2)·2x/(x² + 1) = x/(x² + 1). ln(x² + 1) + C olvida el 1/2; arctan(x) es la integral de 1/(x² + 1), que es otra forma; y u = x no simplifica nada.

### P23 · dificultad 2 · kc: sust-dx · revisada · origen: ia (desconocido) · revisó: Juzou04
En $\int x\sqrt{x^2 + 4}\,dx$, con u = x² + 4, la integral en u queda:

- A) $\frac{1}{2}\int \sqrt{u}\,du$ · CORRECTA
- B) $\int \sqrt{u}\,du$ · [olvida-constante-du] olvidas el 1/2 al despejar x dx
- C) $\int x\sqrt{u}\,du$ · [deja-x-mezclada]
- D) $\int \sqrt{u}\,dx$ · [dx-sin-convertir]

solución: con u = x² + 4, du = 2x dx, así que x dx = du/2. El factor x y el dx se cambian juntos por du/2 y queda (1/2)·∫ √u du. Sin el 1/2 se ajusta mal la constante; ∫ x√u du deja la x mezclada con u; y ∫ √u dx cambia el integrando pero deja dx sin convertir.

### P24 · dificultad 2 · kc: sust-dx · revisada · origen: ia (desconocido) · revisó: Juzou04
Con u = ln(x), ¿en qué se convierte $\int \frac{(\ln(x))^2}{x}\,dx$?

- A) $\int u^2\,du$ · CORRECTA
- B) $\int \frac{u^2}{x}\,du$ · [deja-x-mezclada]
- C) $\int u^2\,dx$ · [dx-sin-convertir]
- D) $\frac{1}{2}\int u^2\,du$ · [olvida-constante-du] agregas una constante que no aparece al pasar de dx a du

solución: con u = ln(x), du = dx/x, así que el factor 1/x y el dx forman juntos du, sin ninguna constante: ∫ (ln(x))²/x dx = ∫ u² du = u³/3 + C = (ln(x))³/3 + C. La opción con u²/x deja la x mezclada con u, la de u² dx deja dx sin convertir, y la de (1/2)·∫ u² du agrega una constante que aquí no aparece.

### P25 · dificultad 2 · kc: sust-limites · revisada · origen: ia (desconocido) · revisó: Juzou04
Para $\int_0^2 2x\cdot(x^2 + 1)^3\,dx$ con u = x² + 1, la integral en u es:

- A) $\int_1^5 u^3\,du$ · CORRECTA
- B) $\int_0^2 u^3\,du$ · [limites-sin-cambiar] usas los límites en x después de cambiar a u
- C) $\int_1^3 u^3\,du$ · [limite-mal-calculado] calculas el límite nuevo con otra expresión que no es u
- D) Regresar a $\frac{(x^2 + 1)^4}{4}$ y evaluar entre 1 y 5 · [limites-dos-veces] cambias los límites y además regresas a x

solución: con u = x² + 1, du = 2x dx, y los límites se cambian con la misma fórmula: x = 0 da u = 0² + 1 = 1 y x = 2 da u = 2² + 1 = 5. La integral es ∫ de 1 a 5 de u³ du, que vale (5⁴ − 1⁴)/4 = 156. Con límites de 0 a 2 se dejan los de x; con 1 a 3 el límite superior se calculó como 2 + 1 en vez de 2² + 1; y regresar a (x² + 1)⁴/4 está bien solo si se evalúa entre x = 0 y x = 2, no entre los límites en u.

### P26 · dificultad 3 · kc: sust-limites · revisada · origen: ia (desconocido) · revisó: Juzou04
En $\int_0^{\pi/2} \sen^2 x \cos x\,dx$ usaste u = sen(x) y llegaste a u³/3. ¿Cómo terminas?

- A) Evalúo u³/3 entre u = 0 y u = 1, y da 1/3 · CORRECTA
- B) Evalúo u³/3 entre u = 0 y u = π/2, y da π³/24 · [limites-sin-cambiar] usas los límites en x después de cambiar a u
- C) Regreso a sen³(x)/3 y evalúo entre 0 y 1 · [limites-dos-veces] cambias los límites y además regresas a x
- D) Evalúo u³/3 entre u = 1 y u = 0, y da −1/3 · [limite-mal-calculado] asignas al revés los límites nuevos

solución: con u = sen(x), los límites nuevos son u = sen(0) = 0 y u = sen(π/2) = 1, así que se evalúa u³/3 entre 0 y 1: 1/3 − 0 = 1/3. Evaluar entre 0 y π/2 usa los límites de x con la variable u. Regresar a sen³(x)/3 obliga a evaluar entre x = 0 y x = π/2, no entre 0 y 1, que son los límites en u. Y evaluar de u = 1 a u = 0 invierte el orden de los límites y cambia el signo.

### P53 · dificultad 2 · kc: sust-limites, sust-dx · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Calcula $\int_0^1 x^2\,(x^3+1)^3\,dx$.

- A) $\frac{1}{12}$ · [limites-sin-cambiar] haces u = x³ + 1 pero dejas los límites 0 y 1 en la integral en u
- B) $\frac{5}{4}$ · CORRECTA
- C) $\frac{4}{3}$ · [limite-mal-calculado] al cambiar el límite inferior tomas u = 0 olvidando sumar 1
- D) $\frac{15}{4}$ · [olvida-constante-du] reemplazas x² dx por du sin dividir entre 3

solución: Con $u=x^3+1$ se tiene $du=3x^2\,dx$, es decir, $x^2\,dx=\frac{1}{3}\,du$. Los límites cambian: si $x=0$ entonces $u=1$; si $x=1$ entonces $u=2$. La integral queda $\frac{1}{3}\int_1^2 u^3\,du=\frac{1}{3}\left[\frac{u^4}{4}\right]_1^2=\frac{1}{12}(16-1)=\frac{5}{4}$. La opción A conserva los límites 0 y 1 en u: $\frac{1}{3}\int_0^1 u^3\,du=\frac{1}{12}$. La opción C usa u(0)=0 (olvida el +1) y u(1)=2: $\frac{1}{3}\int_0^2 u^3\,du=\frac{16}{12}=\frac{4}{3}$. La opción D cambia bien los límites pero omite el factor $\frac{1}{3}$: $\int_1^2 u^3\,du=\frac{15}{4}$.
