# Probabilidad condicional y Bayes

Sesión 3 del programa. Walpole pp. 63-81.
Errores que vale la pena cazar: invertir el condicionamiento, asumir independencia, y olvidar que condicionar reduce el espacio muestral.

## Habilidades
kc: condicional · Probabilidad condicional y Bayes

## Errores
mc: condicional-e1 · condicional · tomas la probabilidad condicional como si ya fuera la conjunta, e ignoras que solo el 60% presentó
mc: condicional-e2 · condicional · sumas las dos probabilidades cuando la regla del producto pide multiplicarlas
mc: condicional-e3 · condicional · divides una entre otra, que es lo que se hace para despejar una condicional, no para calcular una conjunta
mc: condicional-e4 · condicional · confundes independencia con exclusión mutua: les exiges que no puedan ocurrir juntos
mc: condicional-e5 · condicional · no reconoces que P(A∩B) sale de P(A) + P(B) − P(A∪B)
mc: condicional-e6 · condicional · comparas las dos condicionales entre sí en vez de comparar P(A|B) con P(A)

## Preguntas

### P2 · dificultad 2 · kc: condicional · revisada · origen: humano · revisó: prototipo
En un curso, el 60% de los estudiantes presentó el parcial 1, y de los que lo presentaron, el 40% aprobó. Si eliges un estudiante al azar del curso completo, ¿cuál es la probabilidad de que haya presentado y aprobado?

- A) 0,24 · CORRECTA
- B) 0,40 · [condicional-e1]
- C) 1,00 · [condicional-e2]
- D) 0,67 · [condicional-e3]

### P3 · dificultad 3 · kc: condicional · revisada · origen: humano · revisó: prototipo
En un experimento con dos eventos A y B, se sabe que P(A) = 0,6, P(B) = 0,5 y P(A∪B) = 0,8. ¿Son A y B independientes?

- A) Sí, porque P(A∩B) = 0,3 y P(A)·P(B) = 0,3 · CORRECTA
- B) No, porque P(A∩B) = 0,3 no es cero · [condicional-e4]
- C) No se puede determinar con la información dada · [condicional-e5]
- D) No, porque P(A|B) = 0,6 y P(B|A) = 0,5 son distintas · [condicional-e6]
