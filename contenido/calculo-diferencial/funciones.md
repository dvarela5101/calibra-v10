# Funciones y sus gráficas

Dominio de una función y de una composición, y cómo cambia una gráfica con traslaciones, reflexiones, escalas y valor absoluto. Es el primer tema del Parcial 1 (semana 1 del programa). De Precálculo hacen falta la factorización, las expresiones racionales, las desigualdades y el valor absoluto. Las gráficas se preguntan con palabras, por ejemplo qué transformaciones llevan f a g.

## Habilidades
kc: dominio-composicion · Hallar el dominio de una función con cocientes, raíces y logaritmos, y el de una composición
kc: transformaciones-graficas · Describir qué traslaciones, reflexiones, escalas y valor absoluto llevan la gráfica de f a la de otra función

## Errores
mc: orden-composicion-invertido · dominio-composicion · compones las funciones al revés: aplicas primero la de afuera y después la de adentro
mc: olvida-restriccion-interna · dominio-composicion · hallas el dominio de la composición solo con la fórmula final y olvidas las restricciones que impone la función de adentro
mc: log-argumento-no-negativo · dominio-composicion · permites que el argumento de un logaritmo sea 0 o negativo en vez de exigirlo estrictamente positivo
mc: omite-restriccion-raiz · dominio-composicion · no exiges que lo de adentro de una raíz de índice par sea mayor o igual que 0
mc: omite-denominador-cero · dominio-composicion · al reunir las condiciones del dominio olvidas excluir los valores que anulan el denominador
mc: desigualdad-cuadratica-un-intervalo · dominio-composicion · resuelves una desigualdad cuadrática y te quedas con un solo intervalo, sin ver que la solución son dos intervalos separados
mc: signo-traslacion-invertido · transformaciones-graficas · lees f(x − a) como un corrimiento de a unidades hacia la izquierda, o f(x + a) hacia la derecha
mc: escala-horizontal-invertida · transformaciones-graficas · crees que f(2x) estira la gráfica al doble de ancho, cuando la comprime a la mitad
mc: reflexion-eje-equivocado · transformaciones-graficas · confundes −f(x) con f(−x) y reflejas la gráfica respecto del eje que no es
mc: abs-fuera-por-dentro · transformaciones-graficas · confundes |f(x)| con f(|x|): reflejas la parte negativa cuando se pide la simetría respecto del eje y, o al revés
mc: orden-transformaciones-mal · transformaciones-graficas · aplicas las transformaciones en un orden que no corresponde a la expresión, por ejemplo trasladas antes de escalar cuando la fórmula pide lo contrario
mc: desplazamiento-sin-factorizar · transformaciones-graficas · en f(2x − 6) trasladas 6 unidades en vez de 3, porque no factorizas el coeficiente de x antes de leer el corrimiento

## Preguntas

### P13 · dificultad 1 · kc: dominio-composicion · borrador · origen: ia (sonnet-5.5)
Sea $f(x)=\sqrt{x-3}+\frac{1}{x-6}+\ln(10-x)$. ¿Cuál de los siguientes valores de x pertenece al dominio de f?

- A) x = 1 · [omite-restriccion-raiz] aceptas x = 1 aunque lo de adentro de la raíz vale −2
- B) x = 6 · [omite-denominador-cero] aceptas x = 6 aunque ahí el denominador vale 0
- C) x = 8 · CORRECTA
- D) x = 10 · [log-argumento-no-negativo] aceptas x = 10 aunque ahí el argumento del logaritmo vale 0

solución: cada término pone su propia condición: $\sqrt{x-3}$ pide x ≥ 3, $\frac{1}{x-6}$ pide x ≠ 6 y $\ln(10-x)$ pide 10 − x > 0, es decir x < 10. El dominio es [3, 6) ∪ (6, 10). Con x = 1 lo de adentro de la raíz vale −2, con x = 6 el denominador vale 0 y con x = 10 el logaritmo queda en ln 0, que no existe. Con x = 8 las tres condiciones se cumplen: $\sqrt{5}$, $\frac{1}{2}$ y ln 2 están definidos.

### P14 · dificultad 2 · kc: dominio-composicion · borrador · origen: ia (sonnet-5.5)
Sean $f(x)=e^{x}$ y $g(x)=\ln(x-3)$. ¿Cuál es el dominio de la composición f∘g, definida por (f∘g)(x) = f(g(x))?

- A) (−∞, ∞) · [olvida-restriccion-interna] simplificas la composición a x − 3 y tomas todos los reales, sin exigir que ln(x − 3) esté definido
- B) (3, ∞) · CORRECTA
- C) [3, ∞) · [log-argumento-no-negativo] aceptas x = 3 aunque ahí ln(x − 3) es ln 0
- D) (ln 3, ∞) · [orden-composicion-invertido] calculas el dominio de ln(eˣ − 3), que es el de la composición en el otro orden

solución: para evaluar $f(g(x))=e^{\ln(x-3)}$ primero hay que evaluar g, y g exige x − 3 > 0, es decir x > 3. La función f(x) = eˣ está definida para todo real y no agrega condiciones. Aunque $e^{\ln(x-3)}$ se simplifica a x − 3, el dominio no es el de esa fórmula final: es (3, ∞). El valor x = 3 queda fuera porque ln 0 no existe. La opción (ln 3, ∞) sale de la composición en el otro orden, $g(f(x))=\ln(e^{x}-3)$, que exige $e^{x}>3$.

### P15 · dificultad 2 · kc: dominio-composicion · borrador · origen: ia (sonnet-5.5)
Sea $g(x)=\sqrt{x^2-4}$ y sea $f(x)=x^2$. ¿Cuál es el dominio de la composición f∘g, definida por (f∘g)(x) = f(g(x))?

- A) [2, ∞) · [desigualdad-cuadratica-un-intervalo] de x² − 4 ≥ 0 te quedas con x ≥ 2 y pierdes el intervalo x ≤ −2
- B) (−∞, ∞) · [olvida-restriccion-interna] te fijas solo en la fórmula final x² − 4, que existe para todo x, y olvidas que g exige x² − 4 ≥ 0
- C) (−∞, −√2] ∪ [√2, ∞) · [orden-composicion-invertido] calculas el dominio de √(x⁴ − 4), que es el de la composición en el otro orden
- D) (−∞, −2] ∪ [2, ∞) · CORRECTA

solución: para evaluar $f(g(x))=(\sqrt{x^2-4})^2$ primero hay que evaluar g, que exige x² − 4 ≥ 0, es decir (x − 2)(x + 2) ≥ 0. Eso se cumple si x ≤ −2 o si x ≥ 2: son dos intervalos separados. La función f(x) = x² no agrega condiciones. Aunque la fórmula final x² − 4 existe para todo x, la composición no está definida en (−2, 2). El dominio es (−∞, −2] ∪ [2, ∞). El conjunto (−∞, −√2] ∪ [√2, ∞) es el dominio de la composición en el otro orden, $g(f(x))=\sqrt{x^4-4}$.

### P16 · dificultad 3 · kc: dominio-composicion · borrador · origen: ia (sonnet-5.5)
Sean $f(x)=\frac{\sqrt{x}}{x-5}$ y $g(x)=x^2-4x$. ¿Cuál es el dominio de la composición f∘g, definida por (f∘g)(x) = f(g(x))?

- A) (−∞, −1) ∪ (−1, 0] ∪ [4, 5) ∪ (5, ∞) · CORRECTA
- B) (−∞, 0] ∪ [4, ∞) · [omite-denominador-cero] pides x² − 4x ≥ 0 y no excluyes los valores donde g(x) = 5
- C) [4, 5) ∪ (5, ∞) · [desigualdad-cuadratica-un-intervalo] de x(x − 4) ≥ 0 te quedas con x ≥ 4 y pierdes el intervalo x ≤ 0
- D) (−∞, −1) ∪ (−1, 5) ∪ (5, ∞) · [omite-restriccion-raiz] excluyes los valores donde g(x) = 5 pero no exiges que lo de adentro de la raíz sea mayor o igual que 0

solución: (f∘g)(x) = f(g(x)) = $\frac{\sqrt{g(x)}}{g(x)-5}$, con g(x) = x² − 4x. Hay dos condiciones. Primera: lo de adentro de la raíz debe ser no negativo, x² − 4x ≥ 0, es decir x(x − 4) ≥ 0, que se cumple si x ≤ 0 o si x ≥ 4 (dos intervalos separados). Segunda: el denominador no puede ser 0, es decir g(x) ≠ 5: x² − 4x − 5 = (x − 5)(x + 1) ≠ 0, así que x ≠ 5 y x ≠ −1. Los dos valores excluidos caen dentro de los intervalos de la primera condición, así que hay que sacarlos: (−∞, −1) ∪ (−1, 0] ∪ [4, 5) ∪ (5, ∞).

### P17 · dificultad 1 · kc: transformaciones-graficas · borrador · origen: ia (sonnet-5.5)
El punto (3, 4) está en la gráfica de f. ¿Cuál de los siguientes puntos debe estar en la gráfica de $g(x)=-f(x+2)+1$?

- A) (1, −3) · CORRECTA
- B) (5, −3) · [signo-traslacion-invertido] lees f(x + 2) como un corrimiento de 2 unidades hacia la derecha
- C) (−5, 5) · [reflexion-eje-equivocado] lees −f(x + 2) como f(−(x + 2)) y reflejas respecto del eje y en vez del eje x
- D) (1, −5) · [orden-transformaciones-mal] reflejas después de subir 1: calculas −(4 + 1) en vez de −4 + 1

solución: como (3, 4) está en la gráfica de f, f(3) = 4. Para que el argumento de f valga 3 se necesita x + 2 = 3, es decir x = 1. Entonces g(1) = −f(3) + 1 = −4 + 1 = −3 y el punto es (1, −3). La gráfica de f se corre 2 unidades a la izquierda, se refleja respecto del eje x y luego sube 1 unidad. Como la reflexión va antes de la suma, el signo menos solo afecta a f: −f(3) + 1, no −(f(3) + 1).

### P18 · dificultad 2 · kc: transformaciones-graficas · borrador · origen: ia (sonnet-5.5)
El punto (4, 3) está en la gráfica de f. ¿Cuál de los siguientes puntos debe estar en la gráfica de $g(x)=-f(2x-6)$?

- A) (1, 3) · [reflexion-eje-equivocado] lees −f(2x − 6) como f(−(2x − 6)) y reflejas respecto del eje y en vez del eje x
- B) (8, −3) · [desplazamiento-sin-factorizar] trasladas 6 unidades en vez de 3, porque no factorizas 2x − 6 = 2(x − 3)
- C) (5, −3) · CORRECTA
- D) (11, −3) · [escala-horizontal-invertida] crees que el factor 2 estira la gráfica al doble de ancho, así que multiplicas la abscisa por 2 en vez de dividirla

solución: como (4, 3) está en la gráfica de f, f(4) = 3. Se necesita 2x − 6 = 4, de donde x = 5, y entonces g(5) = −f(4) = −3. El punto es (5, −3). Factorizando, g(x) = −f(2(x − 3)): la gráfica de f se comprime horizontalmente a la mitad, se corre 3 unidades a la derecha (no 6) y se refleja respecto del eje x.

### P19 · dificultad 2 · kc: transformaciones-graficas · borrador · origen: ia (sonnet-5.5)
El punto (2, −5) está en la gráfica de f. ¿Cuál de los siguientes puntos debe estar en la gráfica de $g(x)=|f(x-1)|-2$?

- A) (1, 3) · [signo-traslacion-invertido] lees f(x − 1) como un corrimiento de 1 unidad hacia la izquierda
- B) (3, 3) · CORRECTA
- C) (3, −7) · [abs-fuera-por-dentro] pones el valor absoluto en la variable, como f(|x − 1|), y no en el valor de f, así que la y sigue negativa
- D) (3, 7) · [orden-transformaciones-mal] restas 2 antes de tomar el valor absoluto: calculas |−5 − 2| = 7 en vez de |−5| − 2 = 3

solución: como (2, −5) está en la gráfica de f, f(2) = −5. Se necesita x − 1 = 2, de donde x = 3. Entonces g(3) = |f(2)| − 2 = |−5| − 2 = 5 − 2 = 3, y el punto es (3, 3). La gráfica de f se corre 1 unidad a la derecha, la parte que queda bajo el eje x se refleja hacia arriba y después toda la gráfica baja 2 unidades. El valor absoluto va antes de restar 2: |f(2)| − 2 = 3, no |f(2) − 2| = 7. Tampoco es f(|x − 1|) − 2, que deja la y en −7.

### P20 · dificultad 3 · kc: transformaciones-graficas · borrador · origen: ia (sonnet-5.5)
La gráfica de $g(x)=|f(2x-6)|$ se obtiene de la de f con tres transformaciones aplicadas una tras otra, en el orden en que aparecen. ¿Cuál es la secuencia correcta?

- A) Comprimir horizontalmente a la mitad, trasladar 6 unidades a la derecha y reflejar hacia arriba la parte que queda bajo el eje x · [desplazamiento-sin-factorizar] trasladas 6 unidades en vez de 3, porque no factorizas 2x − 6 = 2(x − 3)
- B) Estirar horizontalmente al doble, trasladar 3 unidades a la derecha y reflejar hacia arriba la parte que queda bajo el eje x · [escala-horizontal-invertida] crees que el factor 2 estira la gráfica al doble de ancho, cuando la comprime a la mitad
- C) Comprimir horizontalmente a la mitad, trasladar 3 unidades a la derecha y reemplazar lo que queda a la izquierda del eje y por el reflejo de lo que queda a la derecha · [abs-fuera-por-dentro] confundes |f(x)| con f(|x|): haces la gráfica simétrica respecto del eje y en vez de reflejar hacia arriba lo que queda bajo el eje x
- D) Comprimir horizontalmente a la mitad, trasladar 3 unidades a la derecha y reflejar hacia arriba la parte que queda bajo el eje x · CORRECTA

solución: se factoriza el argumento: 2x − 6 = 2(x − 3). Con f(2x) la gráfica de f se comprime horizontalmente a la mitad. En f(2x), cambiar x por x − 3 da f(2(x − 3)) = f(2x − 6) y traslada 3 unidades a la derecha, no 6. Por último, el valor absoluto exterior refleja hacia arriba lo que queda bajo el eje x. Estirar al doble correspondería a f(x/2). La descripción con simetría respecto del eje y corresponde a h(|x|), con h(x) = f(2x − 6), no a |h(x)|: con h(|x|) la parte izquierda se reemplaza por el reflejo de la derecha respecto del eje y, y con |h(x)| la parte negativa se refleja respecto del eje x.
