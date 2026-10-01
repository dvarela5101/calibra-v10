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

### P21 · dificultad 2 · kc: sust-reconocer, sust-dx · borrador · origen: ia (desconocido)
$\int 2x\cdot e^{x^2}\,dx$ es:

- A) $e^{x^2} + C$ · CORRECTA
- B) $x^2 e^{x^2} + C$ · [no-ve-derivada-interna] no reconoces que 2x es la derivada de x² e integras los factores por separado
- C) $\frac{e^{x^2}}{2x} + C$ · [ignora-cadena] divides por la derivada de la función interna como si fuera una constante
- D) $2e^{x^2} + C$ · [olvida-constante-du]

### P22 · dificultad 3 · kc: sust-reconocer, sust-dx · borrador · origen: ia (desconocido)
¿Cómo se resuelve $\int \frac{x}{x^2 + 1}\,dx$?

- A) Con u = x² + 1, y da $\frac{1}{2}\ln(x^2 + 1) + C$ · CORRECTA
- B) Con u = x, porque es el numerador · [no-ve-derivada-interna] eliges u por la forma y no por la derivada de la función interna
- C) Directo: es arctan(x) + C · [metodo-equivocado] aplicas la fórmula de $\int \frac{1}{x^2 + 1}\,dx$, que no corresponde a esta forma
- D) Con u = x² + 1, y da $\ln(x^2 + 1) + C$ · [olvida-constante-du] olvidas el 1/2 al pasar de dx a du

### P23 · dificultad 2 · kc: sust-dx · borrador · origen: ia (desconocido)
En $\int x\sqrt{x^2 + 4}\,dx$, con u = x² + 4, la integral en u queda:

- A) $\frac{1}{2}\int \sqrt{u}\,du$ · CORRECTA
- B) $\int \sqrt{u}\,du$ · [olvida-constante-du] olvidas el 1/2 al despejar x dx
- C) $\int x\sqrt{u}\,du$ · [deja-x-mezclada]
- D) $\int \sqrt{u}\,dx$ · [dx-sin-convertir]

### P24 · dificultad 2 · kc: sust-dx · borrador · origen: ia (desconocido)
Con u = ln(x), ¿en qué se convierte $\int \frac{(\ln(x))^2}{x}\,dx$?

- A) $\int u^2\,du$ · CORRECTA
- B) $\int \frac{u^2}{x}\,du$ · [deja-x-mezclada]
- C) $\int u^2\,dx$ · [dx-sin-convertir]
- D) $\frac{1}{2}\int u^2\,du$ · [olvida-constante-du] agregas una constante que no aparece al pasar de dx a du

### P25 · dificultad 2 · kc: sust-limites · borrador · origen: ia (desconocido)
Para $\int_0^2 2x\cdot(x^2 + 1)^3\,dx$ con u = x² + 1, la integral en u es:

- A) $\int_1^5 u^3\,du$ · CORRECTA
- B) $\int_0^2 u^3\,du$ · [limites-sin-cambiar] usas los límites en x después de cambiar a u
- C) $\int_1^3 u^3\,du$ · [limite-mal-calculado] calculas el límite nuevo con otra expresión que no es u
- D) Regresar a $\frac{(x^2 + 1)^4}{4}$ y evaluar entre 1 y 5 · [limites-dos-veces] cambias los límites y además regresas a x

### P26 · dificultad 3 · kc: sust-limites · borrador · origen: ia (desconocido)
En $\int_0^{\pi/2} \sen^2 x \cos x\,dx$ usaste u = sen(x) y llegaste a u³/3. ¿Cómo terminas?

- A) Evalúo u³/3 entre u = 0 y u = 1, y da 1/3 · CORRECTA
- B) Evalúo u³/3 entre u = 0 y u = π/2, y da π³/24 · [limites-sin-cambiar] usas los límites en x después de cambiar a u
- C) Regreso a sen³(x)/3 y evalúo entre 0 y 1 · [limites-dos-veces] cambias los límites y además regresas a x
- D) Evalúo u³/3 entre u = 1 y u = 0, y da −1/3 · [limite-mal-calculado] asignas al revés los límites nuevos
