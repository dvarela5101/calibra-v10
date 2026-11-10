# Funciones y gráficas

Evaluación de funciones (incluido el cociente de diferencias), dominio con raíces y denominadores, y gráficas con traslaciones, reflexiones, estiramientos y funciones definidas a trozos. Cae en el Parcial 3 (semana 12).

## Habilidades
kc: evaluar-dominio · Evaluar una función, incluido el cociente de diferencias, y hallar su dominio · prerrequisitos: desigualdades-no-lineales
kc: graficas-transformaciones · Leer una gráfica y aplicar traslaciones, reflexiones y estiramientos a la gráfica de una función, incluidas las definidas a trozos · prerrequisitos: evaluar-dominio

## Errores
mc: f-de-suma-es-suma-de-f · evaluar-dominio · crees que f(a + b) es f(a) + f(b) y evalúas cada sumando por separado
mc: evalua-binomio-sin-doble-producto · evaluar-dominio · al evaluar en una suma o resta elevas al cuadrado cada término y te olvidas del doble producto
mc: sustituye-sin-parentesis · evaluar-dominio · al sustituir una expresión en la fórmula no la encierras en paréntesis, y el signo menos o el coeficiente solo afectan a una parte
mc: dominio-ignora-ceros-del-denominador · evaluar-dominio · en una fracción con raíz solo exiges que el radicando sea no negativo y no excluyes los valores que anulan el denominador
mc: radicando-estrictamente-positivo · evaluar-dominio · exiges que el radicando sea estrictamente positivo y excluyes el extremo donde vale 0, aunque la raíz de 0 está definida
mc: cociente-de-diferencias-divide-un-solo-termino · evaluar-dominio · al dividir entre h el numerador del cociente de diferencias divides solo uno de sus términos
mc: desigualdad-del-radicando-mal-resuelta · evaluar-dominio · al resolver la desigualdad del radicando eliges el lado o el intervalo equivocado (no inviertes el sentido al dividir entre un negativo, o tomas el intervalo entre las raíces)
mc: traslacion-con-sentido-invertido · graficas-transformaciones · tomas el sentido del desplazamiento al revés: f(x + a) hacia la derecha o f(x) − c hacia arriba
mc: reflexion-en-el-eje-equivocado · graficas-transformaciones · confundes −f(x), que refleja en el eje x, con f(−x), que refleja en el eje y
mc: factor-horizontal-sin-invertir · graficas-transformaciones · en f(x/k) o f(kx) usas el factor k tal cual en la coordenada x, sin invertirlo
mc: orden-de-transformaciones-alterado · graficas-transformaciones · aplicas el desplazamiento vertical antes del estiramiento, cuando la fórmula manda estirar primero y desplazar después
mc: trozos-tramo-equivocado · graficas-transformaciones · en una función a trozos evalúas con la fórmula del tramo que no corresponde, sobre todo en el valor donde cambia de tramo
mc: traslacion-horizontal-confundida-con-vertical · graficas-transformaciones · tomas una traslación horizontal como vertical (o al revés): f(x − a) como f(x) − a, o f(x) − c como f(x − c)
mc: transformacion-en-la-coordenada-equivocada · graficas-transformaciones · aplicas una transformación a la coordenada que no es: el desplazamiento vertical a x o el desplazamiento horizontal a y

## Preguntas

### P86 · dificultad 1 · kc: evaluar-dominio · borrador · origen: ia (sonnet-5.5)
Si f(x) = 2x² − x, ¿cuál es la expresión de f(x − 1)?

- A) 2x² − x − 1 · [f-de-suma-es-suma-de-f] tomas f(x − 1) como f(x) − f(1) y restas f(1) = 1 a la fórmula original
- B) 2x² − x + 3 · [evalua-binomio-sin-doble-producto] desarrollas (x − 1)² como x² + 1, sin el término −2x
- C) 2x² − 5x + 3 · CORRECTA
- D) 2x² − 5x + 1 · [sustituye-sin-parentesis] escribes −x − 1 en lugar de −(x − 1) y el signo menos solo afecta a la x

solución: cada x de la fórmula se reemplaza por el paréntesis (x − 1), lo que da f(x − 1) = 2(x − 1)² − (x − 1). El cuadrado (x − 1)² se desarrolla como 1 − 2x + x², así que el primer término vale 2 − 4x + 2x²; al restar el paréntesis se añade −x + 1, y el total ordenado es 2x² − 5x + 3.

### P87 · dificultad 2 · kc: evaluar-dominio · borrador · origen: ia (sonnet-5.5)
Para f(x) = 2x² − 5, el cociente de diferencias $\frac{f(x+h) - f(x)}{h}$, con h ≠ 0, es igual a:

- A) 4x + 2h · CORRECTA
- B) 2h · [evalua-binomio-sin-doble-producto] tomas (x + h)² como x² + h² y el numerador queda 2h²
- C) 4x + 2h² · [cociente-de-diferencias-divide-un-solo-termino] divides entre h solo el término 4xh del numerador 4xh + 2h² y dejas el otro sin dividir
- D) $2h - \frac{5}{h}$ · [f-de-suma-es-suma-de-f] tomas f(x + h) como f(x) + f(h), así que el cociente es f(h)/h

solución: f(x + h) = 2(x + h)² − 5 = 2x² + 4xh + 2h² − 5. Al restar f(x) = 2x² − 5 queda 4xh + 2h². Dividiendo todo el numerador entre h: (4xh + 2h²)/h = 4x + 2h.

### P88 · dificultad 2 · kc: evaluar-dominio · borrador · origen: ia (sonnet-5.5)
El dominio de $f(x) = \frac{\sqrt{8 - 2x}}{x + 1}$ es:

- A) (−∞, 4] · [dominio-ignora-ceros-del-denominador] solo exiges 8 − 2x ≥ 0 y no sacas x = −1, que anula el denominador
- B) (−∞, −1) ∪ (−1, 4) · [radicando-estrictamente-positivo] pides 8 − 2x > 0 y excluyes x = 4, donde la raíz vale 0 y sí está definida
- C) [4, ∞) · [desigualdad-del-radicando-mal-resuelta] de −2x ≥ −8 concluyes x ≥ 4, sin invertir el sentido al dividir entre −2
- D) (−∞, −1) ∪ (−1, 4] · CORRECTA

solución: la raíz exige 8 − 2x ≥ 0, es decir −2x ≥ −8, y al dividir entre −2 se invierte el sentido: x ≤ 4. El denominador exige x + 1 ≠ 0, es decir x ≠ −1. El dominio es x ≤ 4 con x ≠ −1: (−∞, −1) ∪ (−1, 4]. El extremo 4 sí entra porque √0 = 0 está definida.

### P89 · dificultad 2 · kc: evaluar-dominio · borrador · origen: ia (sonnet-5.5)
Para f(x) = x² − x, simplifica $\frac{f(x+h) - f(x)}{h}$, con h ≠ 0.

- A) 2x + h + 1 · [sustituye-sin-parentesis] escribes f(x + h) con −x + h en lugar de −(x + h) y el signo menos solo afecta a la x
- B) 2x + h − 1 · CORRECTA
- C) h − 1 · [evalua-binomio-sin-doble-producto] tomas (x + h)² como x² + h² y se te pierde el término 2xh
- D) 2x + h² − h · [cociente-de-diferencias-divide-un-solo-termino] divides entre h solo el término 2xh del numerador y dejas h² − h sin dividir

solución: f(x + h) = (x + h)² − (x + h) = x² + 2xh + h² − x − h. Al restar f(x) = x² − x queda 2xh + h² − h. Dividiendo cada término entre h: 2x + h − 1.

### P90 · dificultad 3 · kc: evaluar-dominio · borrador · origen: ia (sonnet-5.5)
El dominio de $f(x) = \frac{\sqrt{x^2 - x - 6}}{x - 4}$ es:

- A) (−∞, −2] ∪ [3, ∞) · [dominio-ignora-ceros-del-denominador] resuelves bien el radicando pero no sacas x = 4, que anula el denominador
- B) [−2, 3] · [desigualdad-del-radicando-mal-resuelta] tomas el intervalo entre las raíces −2 y 3, cuando x² − x − 6 ≥ 0 se cumple fuera de ellas
- C) (−∞, −2] ∪ [3, 4) ∪ (4, ∞) · CORRECTA
- D) (−∞, −2) ∪ (3, 4) ∪ (4, ∞) · [radicando-estrictamente-positivo] pides x² − x − 6 > 0 y excluyes x = −2 y x = 3, donde la raíz vale 0 y sí está definida

solución: el radicando se factoriza como x² − x − 6 = (x − 3)(x + 2). El producto es ≥ 0 cuando x ≤ −2 o x ≥ 3 (los extremos entran porque √0 está definida). El denominador exige x ≠ 4, y 4 está dentro de [3, ∞), así que se saca de ahí: (−∞, −2] ∪ [3, 4) ∪ (4, ∞).

### P91 · dificultad 1 · kc: graficas-transformaciones · borrador · origen: ia (sonnet-5.5)
El punto (4, −2) está en la gráfica de f. ¿Qué punto está en la gráfica de y = −f(x − 3)?

- A) (1, 2) · [traslacion-con-sentido-invertido] tomas f(x − 3) como un desplazamiento de 3 unidades a la izquierda
- B) (7, 2) · CORRECTA
- C) (−7, −2) · [reflexion-en-el-eje-equivocado] reflejas el punto respecto al eje y, cuando el signo menos delante de f refleja respecto al eje x
- D) (−4, −5) · [transformacion-en-la-coordenada-equivocada] aplicas la reflexión a la coordenada x y el desplazamiento de 3 a la coordenada y

solución: f(x − 3) desplaza la gráfica 3 unidades a la derecha: (4, −2) pasa a (7, −2). El signo menos delante de f multiplica la coordenada y por −1 (reflexión respecto al eje x): (7, −2) pasa a (7, 2). Comprobación: x = 7 da y = −f(7 − 3) = −f(4) = −(−2) = 2.

### P92 · dificultad 2 · kc: graficas-transformaciones · borrador · origen: ia (sonnet-5.5)
El punto (6, 2) está en la gráfica de f. ¿Qué punto está en la gráfica de y = f(−x) − 3?

- A) (6, −5) · [reflexion-en-el-eje-equivocado] tomas f(−x) como −f(x) y reflejas respecto al eje x
- B) (−6, 5) · [traslacion-con-sentido-invertido] tomas el −3 como un desplazamiento de 3 unidades hacia arriba
- C) (−9, 2) · [transformacion-en-la-coordenada-equivocada] restas 3 a la coordenada x en lugar de restarlo a la y
- D) (−6, −1) · CORRECTA

solución: f(−x) refleja la gráfica respecto al eje y: (6, 2) pasa a (−6, 2). El −3 fuera de f desplaza 3 unidades hacia abajo: (−6, 2) pasa a (−6, −1). Comprobación: x = −6 da y = f(6) − 3 = 2 − 3 = −1.

### P93 · dificultad 2 · kc: graficas-transformaciones · borrador · origen: ia (sonnet-5.5)
El punto (6, 2) está en la gráfica de f. ¿Qué punto está en la gráfica de y = 2f(x/2) − 1?

- A) (12, 3) · CORRECTA
- B) (3, 3) · [factor-horizontal-sin-invertir] en f(x/2) divides la coordenada x entre 2, cuando la gráfica se estira al doble en horizontal
- C) (12, 2) · [orden-de-transformaciones-alterado] restas 1 antes de multiplicar por 2 y calculas 2·(2 − 1)
- D) (11, 4) · [traslacion-horizontal-confundida-con-vertical] tomas el −1 como un desplazamiento horizontal y lo aplicas a la coordenada x

solución: en f(x/2) la entrada es la mitad de x, así que se necesita x = 12 para que x/2 = 6, y la coordenada x se duplica: 12. La coordenada y se calcula con 2f(6) − 1 = 2·2 − 1 = 3, con la multiplicación antes de la resta. El punto es (12, 3).

### P94 · dificultad 2 · kc: graficas-transformaciones · borrador · origen: ia (sonnet-5.5)
Sea f(x) = x + 3 si x < 1, y f(x) = 2x + 5 si x ≥ 1. Si g(x) = f(x − 2), ¿cuánto vale g(3)?

- A) 4 · [trozos-tramo-equivocado] evalúas f(1) con la fórmula x + 3, que solo vale para x < 1
- B) 15 · [traslacion-con-sentido-invertido] tomas f(x − 2) como f(x + 2) y evalúas f(5)
- C) 7 · CORRECTA
- D) 9 · [traslacion-horizontal-confundida-con-vertical] tomas f(x − 2) como f(x) − 2 y calculas f(3) − 2

solución: g(3) = f(3 − 2) = f(1). Como 1 ≥ 1, se usa el segundo tramo: f(1) = 2·1 + 5 = 7.

### P95 · dificultad 3 · kc: graficas-transformaciones · borrador · origen: ia (sonnet-5.5)
Sea h(x) = x² − 1 si x ≤ 2, y h(x) = 6 − x si x > 2. Si g(x) = 2h(x/2) − 1, ¿cuánto vale g(4)?

- A) −5 · [factor-horizontal-sin-invertir] cambias x/2 por 2x y evalúas h(8) en el segundo tramo
- B) 5 · CORRECTA
- C) 4 · [orden-de-transformaciones-alterado] restas 1 antes de multiplicar por 2 y calculas 2·(h(2) − 1)
- D) 7 · [trozos-tramo-equivocado] evalúas h(2) con la fórmula 6 − x, que solo vale para x > 2

solución: g(4) = 2h(4/2) − 1 = 2h(2) − 1. Como 2 ≤ 2, se usa el primer tramo: h(2) = 2² − 1 = 3. Entonces g(4) = 2·3 − 1 = 5.
