# Integrales impropias

## Habilidades
kc: impropia-p · Decidir la convergencia de ∫ 1/xᵖ en intervalos infinitos
kc: impropia-limite · Plantear y evaluar la integral impropia como un límite
kc: impropia-discontinuidad · Detectar discontinuidades del integrando en el intervalo

## Errores
mc: confunde-p1 · impropia-p · confundes 1/xᵖ con p > 1 con el caso 1/x, que diverge
mc: condicion-p-mal · impropia-p · usas mal la condición de convergencia p > 1
mc: no-reconoce-convergente · impropia-p · crees que una integral sobre un intervalo infinito no puede dar un número finito
mc: limite-mal-evaluado · impropia-limite · evalúas mal la antiderivada en los límites
mc: infinito-como-numero · impropia-limite · reemplazas ∞ como si fuera un número en vez de tomar un límite
mc: integrando-vs-integral · impropia-limite · confundes lo que hace el integrando con lo que hace la integral
mc: solo-limites-infinitos · impropia-discontinuidad · crees que una integral solo es impropia si tiene límites infinitos
mc: ignora-discontinuidad · impropia-discontinuidad · no revisas si el integrando se indefine en un extremo o dentro del intervalo

## Preguntas

### P3 · dificultad 3 · kc: impropia-p, impropia-limite · revisada · origen: humano · revisó: prototipo
∫ desde 1 hasta ∞ de (1/x²) dx:

- A) Converge a 1 · CORRECTA
- B) Diverge · [confunde-p1] la confundes con 1/x, que sí diverge
- C) Converge a 0 · [limite-mal-evaluado] evalúas mal el límite superior
- D) No se puede determinar · [no-reconoce-convergente] no reconoces una impropia convergente

### P27 · dificultad 2 · kc: impropia-p · borrador · origen: ia (desconocido)
¿Cuál de estas integrales desde 1 hasta ∞ converge?

- A) $\int \frac{1}{x^3}\,dx$ · CORRECTA
- B) $\int \frac{1}{x}\,dx$ · [confunde-p1] crees que 1/x se comporta como las potencias con p > 1
- C) $\int \frac{1}{\sqrt{x}}\,dx$ · [condicion-p-mal] inviertes la condición y crees que converge con p < 1
- D) Ninguna, porque el intervalo es infinito · [no-reconoce-convergente] crees que un intervalo infinito siempre da un resultado infinito

### P28 · dificultad 3 · kc: impropia-p, impropia-limite · borrador · origen: ia (desconocido)
$\int_1^{\infty} \frac{1}{x^{3/2}}\,dx$:

- A) Converge a 2 · CORRECTA
- B) Diverge, igual que 1/x · [confunde-p1] la confundes con 1/x, que sí diverge
- C) Converge a 2/3 · [limite-mal-evaluado] integras o evalúas mal la antiderivada en los límites
- D) Diverge, porque hace falta p ≥ 2 · [condicion-p-mal] exiges una condición más fuerte que p > 1

### P29 · dificultad 2 · kc: impropia-limite · borrador · origen: ia (desconocido)
¿Cómo se trabaja correctamente $\int_0^{\infty} e^{-x}\,dx$?

- A) Como $\lim_{b\to\infty} \int_0^b e^{-x}\,dx$ · CORRECTA
- B) Evaluando $-e^{-x}$ directamente en x = ∞ y en x = 0 · [infinito-como-numero] reemplazas ∞ como si fuera un número
- C) Vale 0, porque $e^{-x}$ tiende a 0 · [integrando-vs-integral] confundes que el integrando tienda a 0 con el valor de la integral
- D) Como $\lim_{b\to\infty} e^{-b}$ · [limite-mal-evaluado] evalúas solo un extremo de la antiderivada

### P30 · dificultad 3 · kc: impropia-limite · borrador · origen: ia (desconocido)
Un estudiante dice que $\int_1^{\infty} \frac{1}{x}\,dx$ converge "porque 1/x tiende a 0". ¿Qué está mal?

- A) Que el integrando tienda a 0 no basta: ln(b) tiende a ∞ cuando b → ∞ · CORRECTA
- B) Nada, y la integral vale 0 · [integrando-vs-integral] confundes que el integrando tienda a 0 con que la integral converja
- C) Nada: vale ln(∞) − ln(1), que es un número · [infinito-como-numero] reemplazas ∞ como si fuera un número
- D) Converge a 1, porque solo cuenta el límite inferior · [limite-mal-evaluado]

### P31 · dificultad 2 · kc: impropia-discontinuidad, impropia-limite · borrador · origen: ia (desconocido)
¿Es impropia $\int_0^1 \frac{1}{\sqrt{x}}\,dx$?

- A) Sí, porque 1/√x no está definida en x = 0 · CORRECTA
- B) No, porque los límites de integración son finitos · [solo-limites-infinitos] crees que solo es impropia si tiene límites infinitos
- C) Sí, y diverge porque 1/√x crece sin límite cerca de 0 · [integrando-vs-integral] confundes que el integrando crezca sin límite con que la integral diverja
- D) No, porque x = 0 es un extremo y los extremos no cuentan · [ignora-discontinuidad] no revisas si el integrando se indefine en un extremo

### P32 · dificultad 3 · kc: impropia-discontinuidad, impropia-limite · borrador · origen: ia (desconocido)
Un estudiante calcula $\int_{-1}^1 \frac{1}{x^2}\,dx$ como $\left[-\frac{1}{x}\right]$ entre −1 y 1, y obtiene −2. ¿Qué pasa?

- A) No vale: 1/x² se indefine en x = 0, hay que partir la integral y resulta divergente · CORRECTA
- B) Está bien: los límites son finitos, así que no es impropia · [solo-limites-infinitos] crees que solo es impropia si tiene límites infinitos
- C) Está bien el método, pero el resultado es 2 · [ignora-discontinuidad] no revisas si el integrando se indefine dentro del intervalo
- D) Hay que partirla en 0, y cada mitad vale 1, así que da 2 · [limite-mal-evaluado] evalúas mal los límites de cada mitad
