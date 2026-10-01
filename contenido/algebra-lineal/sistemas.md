# Sistemas lineales y Gauss-Jordan

Errores que vale la pena cazar: parar en forma escalón cuando se pedía escalón reducida, leer un sistema con infinitas soluciones como inconsistente, y perder soluciones al no marcar las variables libres.

## Habilidades
kc: sistemas · Sistemas lineales y Gauss-Jordan

## Errores
mc: sistemas-e1 · sistemas · detienes en forma escalón sin reducir completamente
mc: sistemas-e2 · sistemas · confundes un sistema consistente dependiente con uno inconsistente
mc: sistemas-e3 · sistemas · olvidas identificar la variable libre y pierdes soluciones
mc: sistemas-e4 · sistemas · te detienes en forma escalón sin reducir
mc: sistemas-e5 · sistemas · eliminas una columna pivote válida incorrectamente
mc: sistemas-e6 · sistemas · crees que matrices con filas de ceros no pueden reducirse
mc: sistemas-e7 · sistemas · no reconoces que z es variable libre
mc: sistemas-e8 · sistemas · confundes una fila de ceros con inconsistencia
mc: sistemas-e9 · sistemas · cuentas mal las variables libres

## Preguntas

### P4 · dificultad 2 · kc: sistemas · revisada · origen: humano · revisó: prototipo
Resuelve el sistema usando Gauss-Jordan: x + y = 2, 2x + 2y = 4.

- A) Infinitas soluciones: x = 2 - t, y = t · CORRECTA
- B) x = 1, y = 1 · [sistemas-e1]
- C) Sin solución · [sistemas-e2]
- D) x = 2, y = 0 · [sistemas-e3]

### P5 · dificultad 2 · kc: sistemas · revisada · origen: humano · revisó: prototipo
Reduce a forma escalón reducida la matriz: [[1, 2, 3], [0, 0, 1], [0, 0, 0]].

- A) [[1, 2, 0], [0, 0, 1], [0, 0, 0]] · CORRECTA
- B) [[1, 2, 3], [0, 0, 1], [0, 0, 0]] · [sistemas-e4]
- C) [[1, 0, 0], [0, 0, 1], [0, 0, 0]] · [sistemas-e5]
- D) No tiene forma escalón reducida · [sistemas-e6]

### P6 · dificultad 2 · kc: sistemas · revisada · origen: humano · revisó: prototipo
¿Cuántas soluciones tiene el sistema representado por [[1, 0, 2], [0, 1, -1], [0, 0, 0]]?

- A) Infinitas soluciones (x = 2 - 2t, y = -1 + t, z = t) · CORRECTA
- B) Única solución: x = 2, y = -1, z = 0 · [sistemas-e7]
- C) Sin solución · [sistemas-e8]
- D) Dos soluciones · [sistemas-e9]
