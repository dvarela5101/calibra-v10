# Reglas de derivación

Derivadas de potencias, sumas, productos y cocientes, derivadas de funciones trascendentes, regla de la cadena, derivación implícita y derivación logarítmica. Es del Parcial 2 (semanas 6 y 7 del programa). De Precálculo hacen falta el álgebra, la trigonometría, los exponentes y los logaritmos. Solo hay errores catalogados de regla-cadena y de la derivada del seno; falta el resto.

## Habilidades
kc: reglas-derivacion · Derivar potencias, sumas, productos y cocientes con las reglas de derivación
kc: derivadas-trascendentes · Derivar funciones trigonométricas, exponenciales, logarítmicas y trigonométricas inversas · prerrequisitos: reglas-derivacion
kc: regla-cadena · Derivar una composición de funciones con la regla de la cadena · prerrequisitos: reglas-derivacion, dominio-composicion
kc: derivacion-implicita · Hallar dy/dx de una curva dada de forma implícita · prerrequisitos: regla-cadena
kc: derivacion-logaritmica · Derivar funciones de la forma f(x)^g(x) o con muchos factores usando logaritmos · prerrequisitos: regla-cadena, derivadas-trascendentes

## Errores
mc: seno-no-cambia-a-coseno · derivadas-trascendentes · al derivar sen u dejas sen u y solo multiplicas por la derivada del interior, sin pasarlo a cos u
mc: omite-derivada-interior · regla-cadena · derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro
mc: interior-sin-derivar · regla-cadena · multiplicas por la expresión de adentro, o por parte de ella, en vez de multiplicar por su derivada
mc: interior-derivado-queda-adentro · regla-cadena · derivas la expresión de adentro pero la dejas dentro de la función de afuera en lugar de multiplicar por ella

## Preguntas

### P4 · dificultad 2 · kc: regla-cadena · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Deriva: f(x) = (3x² + 1)⁵

- A) f'(x) = 5(3x² + 1)⁴ · 6x = 30x(3x² + 1)⁴ · CORRECTA
- B) f'(x) = 5(3x² + 1)⁴ · [omite-derivada-interior]
- C) f'(x) = 15x²(3x² + 1)⁴ · [interior-sin-derivar]
- D) f'(x) = 5(6x)⁴ · [interior-derivado-queda-adentro]

### P6 · dificultad 2 · kc: regla-cadena, derivadas-trascendentes · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Deriva: g(x) = sen(x³)

- A) g'(x) = 3x² cos(x³) · CORRECTA
- B) g'(x) = cos(x³) · [omite-derivada-interior]
- C) g'(x) = 3x² sen(x³) · [seno-no-cambia-a-coseno]
- D) g'(x) = cos(3x²) · [interior-derivado-queda-adentro]
