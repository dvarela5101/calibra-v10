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

solución: ∫ desde 1 hasta ∞ de 1/xᵖ converge exactamente cuando p > 1. 1/x³ tiene p = 3 > 1 y converge: lim cuando b → ∞ de (1/2 − 1/(2b²)) = 1/2. 1/x tiene p = 1 y diverge, porque ln(b) tiende a ∞. 1/√x tiene p = 1/2 < 1 y también diverge. Un intervalo infinito puede dar un valor finito, como muestra 1/x³.

### P28 · dificultad 3 · kc: impropia-p, impropia-limite · borrador · origen: ia (desconocido)
$\int_1^{\infty} \frac{1}{x^{3/2}}\,dx$:

- A) Converge a 2 · CORRECTA
- B) Diverge, igual que 1/x · [confunde-p1] la confundes con 1/x, que sí diverge
- C) Converge a 2/3 · [limite-mal-evaluado] integras o evalúas mal la antiderivada en los límites
- D) Diverge, porque hace falta p ≥ 2 · [condicion-p-mal] exiges una condición más fuerte que p > 1

solución: es una integral p con p = 3/2 > 1, así que converge. Como límite: ∫ de 1 a b de x^(−3/2) dx = [−2x^(−1/2)] de 1 a b = 2 − 2/√b, que tiende a 2 cuando b → ∞. La comparación con 1/x no sirve (p = 1 es el único caso de la frontera que diverge), y no hace falta p ≥ 2. El 2/3 sale de equivocar la antiderivada: dividir entre 3/2 en vez de entre −1/2.

### P29 · dificultad 2 · kc: impropia-limite · borrador · origen: ia (desconocido)
¿Cómo se trabaja correctamente $\int_0^{\infty} e^{-x}\,dx$?

- A) Como $\lim_{b\to\infty} \int_0^b e^{-x}\,dx$ · CORRECTA
- B) Evaluando $-e^{-x}$ directamente en x = ∞ y en x = 0 · [infinito-como-numero] reemplazas ∞ como si fuera un número
- C) Vale 0, porque $e^{-x}$ tiende a 0 · [integrando-vs-integral] confundes que el integrando tienda a 0 con el valor de la integral
- D) Como $\lim_{b\to\infty} e^{-b}$ · [limite-mal-evaluado] evalúas solo un extremo de la antiderivada

solución: una integral con límite infinito se define como un límite: ∫ desde 0 hasta ∞ de e^(−x) dx = lim cuando b → ∞ de ∫ de 0 a b de e^(−x) dx = lim (1 − e^(−b)) = 1. ∞ no se reemplaza como un número en −e^(−x). Que e^(−x) tienda a 0 dice algo del integrando, no de la integral, que vale 1. Y lim e^(−b) es solo uno de los dos extremos de la antiderivada: falta el término de x = 0.

### P30 · dificultad 3 · kc: impropia-limite · borrador · origen: ia (desconocido)
Un estudiante dice que $\int_1^{\infty} \frac{1}{x}\,dx$ converge "porque 1/x tiende a 0". ¿Qué está mal?

- A) Que el integrando tienda a 0 no basta: ln(b) tiende a ∞ cuando b → ∞ · CORRECTA
- B) Nada, y la integral vale 0 · [integrando-vs-integral] confundes que el integrando tienda a 0 con que la integral converja
- C) Nada: vale ln(∞) − ln(1), que es un número · [infinito-como-numero] reemplazas ∞ como si fuera un número
- D) Converge a 1, porque solo cuenta el límite inferior · [limite-mal-evaluado]

solución: ∫ de 1 a b de dx/x = ln(b), que tiende a ∞ cuando b → ∞, así que la integral diverge. Que el integrando tienda a 0 es necesario para que converja, pero no suficiente: 1/x² también tiende a 0 y su integral sí converge. No vale 0, ln(∞) no es un número, y el límite superior no se puede ignorar.

### P31 · dificultad 2 · kc: impropia-discontinuidad, impropia-limite · borrador · origen: ia (desconocido)
¿Es impropia $\int_0^1 \frac{1}{\sqrt{x}}\,dx$?

- A) Sí, porque 1/√x no está definida en x = 0 · CORRECTA
- B) No, porque los límites de integración son finitos · [solo-limites-infinitos] crees que solo es impropia si tiene límites infinitos
- C) Sí, y diverge porque 1/√x crece sin límite cerca de 0 · [integrando-vs-integral] confundes que el integrando crezca sin límite con que la integral diverja
- D) No, porque x = 0 es un extremo y los extremos no cuentan · [ignora-discontinuidad] no revisas si el integrando se indefine en un extremo

solución: aunque los límites son finitos, 1/√x no está definida en x = 0 y crece sin límite cerca de ese extremo, así que la integral es impropia y se calcula como límite: lim cuando a → 0⁺ de ∫ de a a 1 de x^(−1/2) dx = lim (2 − 2√a) = 2. Converge: que el integrando crezca sin límite no obliga a la integral a diverger. Decir que no es impropia ignora que el integrando se indefine en un extremo, y los extremos sí cuentan.

### P32 · dificultad 3 · kc: impropia-discontinuidad, impropia-limite · borrador · origen: ia (desconocido)
Un estudiante calcula $\int_{-1}^1 \frac{1}{x^2}\,dx$ como $\left[-\frac{1}{x}\right]$ entre −1 y 1, y obtiene −2. ¿Qué pasa?

- A) No vale: 1/x² se indefine en x = 0, hay que partir la integral y resulta divergente · CORRECTA
- B) Está bien: los límites son finitos, así que no es impropia · [solo-limites-infinitos] crees que solo es impropia si tiene límites infinitos
- C) Está bien el método, pero el resultado es 2 · [ignora-discontinuidad] no revisas si el integrando se indefine dentro del intervalo
- D) Hay que partirla en 0, y cada mitad vale 1, así que da 2 · [limite-mal-evaluado] evalúas mal los límites de cada mitad

solución: 1/x² no está definida en x = 0, que está dentro de [−1, 1], así que la integral es impropia y hay que partirla en 0. La mitad derecha es lim cuando a → 0⁺ de ∫ de a a 1 de dx/x² = lim (1/a − 1) = ∞, así que diverge, y con ella toda la integral. El −2 sale de aplicar la regla de Barrow sobre una discontinuidad; además, un integrando positivo no puede dar una integral negativa. Ninguna de las dos mitades vale 1: las dos divergen.

### P54 · dificultad 2 · kc: impropia-discontinuidad, impropia-limite · borrador · origen: ia (sonnet-5.5) · ⚠ revisar
¿Qué se concluye de la integral $\int_{-2}^{3} \frac{1}{x}\,dx$?

- A) Vale $\ln\frac{3}{2}$ · [ignora-discontinuidad] aplicas directamente ln|x| entre −2 y 3 sin notar que x = 0 está dentro del intervalo
- B) Es una integral definida común, no impropia, porque sus dos límites son finitos · [solo-limites-infinitos]
- C) Vale 0, porque un tramo da −∞, el otro da +∞ y se cancelan · [infinito-como-numero] tratas ∞ como si fuera un número que se puede restar de sí mismo
- D) Diverge: 1/x tiene una asíntota vertical en x = 0, dentro del intervalo, y al partir la integral en 0 el tramo de 0 a 3 ya diverge · CORRECTA

solución: El integrando $\frac{1}{x}$ tiene una asíntota vertical en $x=0$, que cae dentro de $[-2,3]$, así que la integral es impropia aunque los límites sean finitos y hay que partirla: $\int_{-2}^{0}\frac{dx}{x}+\int_{0}^{3}\frac{dx}{x}$. Para el segundo tramo, $\lim_{t\to 0^+}\left(\ln 3-\ln t\right)=+\infty$; para el primero, $\lim_{t\to 0^-}\left(\ln|t|-\ln 2\right)=-\infty$. Basta que uno de los dos tramos diverja para que la integral completa diverja (aquí divergen los dos), y no se puede "compensar" un infinito con otro. El valor $\ln\frac{3}{2}$ es lo que da ignorar la discontinuidad (coincide con el llamado valor principal, que no es el valor de la integral impropia). La opción A sale de calcular $\ln|3|-\ln|-2|=\ln\frac{3}{2}$ ignorando la discontinuidad. La opción B cree que solo hay integrales impropias cuando algún límite es infinito. La opción C trata $-\infty+\infty$ como 0.
