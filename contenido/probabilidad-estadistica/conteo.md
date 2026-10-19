# Técnicas de conteo

Sesión 2 del programa. Walpole pp. 35-62.
Errores que vale la pena cazar: confundir permutación con combinación, contar con repetición cuando no la hay, y multiplicar en vez de contar subconjuntos.

## Habilidades
kc: conteo · Técnicas de conteo

## Errores
mc: conteo-e1 · conteo · usas permutación y cuentas como si el orden de los tres importara
mc: conteo-e2 · conteo · cuentas con repetición, como si un mismo monitor pudiera ocupar dos puestos
mc: conteo-e3 · conteo · multiplicas 10 por 3 en vez de contar cuántos subconjuntos de 3 hay

## Preguntas

### P1 · dificultad 2 · kc: conteo · revisada · origen: humano · revisó: prototipo
De un grupo de 10 monitores hay que escoger 3 para un comité. ¿De cuántas formas distintas se puede armar el comité?

- A) 120 · CORRECTA
- B) 720 · [conteo-e1]
- C) 1000 · [conteo-e2]
- D) 30 · [conteo-e3]

### P13 · dificultad 1 · kc: conteo · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
En una reunión hay 6 amigos y cada pareja de amigos se da la mano exactamente una vez. ¿Cuántos apretones de mano hay en total?

- A) 12 · [conteo-e3] multiplicas 6 por 2 en vez de contar cuántas parejas distintas se pueden formar entre 6 personas
- B) 15 · CORRECTA
- C) 30 · [conteo-e1] cuentas el apretón de A con B y el de B con A como si fueran distintos, o sea, como si el orden importara
- D) 36 · [conteo-e2] cuentas que cada uno da la mano a los 6, incluido él mismo, como si una persona pudiera ocupar los dos lugares de un apretón

solución: un apretón de manos involucra a dos personas y no importa quién da la mano primero: el de A con B es el mismo que el de B con A. Entonces se cuentan los subconjuntos de 2 personas entre las 6, que es una combinación: C(6, 2) = 6!/(2!·4!) = (6·5)/2 = 15. Otra forma de verlo: cada una de las 6 personas da la mano a las otras 5, lo que suma 6·5 = 30 apretones contados, pero así cada uno queda contado dos veces (una desde cada extremo) y 30/2 = 15. Las otras opciones salen de contar con orden (30), de contar con orden y además dejar que una persona se dé la mano a sí misma (36) y de multiplicar 6 por 2 (12).

### P14 · dificultad 3 · kc: conteo · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Se va a formar un comité de 3 personas escogidas entre 4 profesores y 5 estudiantes. El comité debe tener al menos un profesor. ¿Cuántos comités distintos se pueden formar?

- A) 74 · CORRECTA
- B) 112 · [conteo-e3] eliges primero a un profesor (4 formas) y lo completas con cualquier pareja de las otras 8 personas, multiplicando en vez de contar comités distintos: el comité con más de un profesor queda contado varias veces
- C) 444 · [conteo-e1] cuentas listas ordenadas, 9·8·7 − 5·4·3, como si el orden de los tres integrantes importara
- D) 604 · [conteo-e2] cuentas con repetición, 9³ − 5³, como si una misma persona pudiera ocupar dos lugares del comité

solución: un comité es un subconjunto, así que el orden no importa. Por complemento: los comités de 3 personas entre las 9 son C(9, 3) = 84, y los que no tienen ningún profesor, formados solo por estudiantes, son C(5, 3) = 10. Entonces hay 84 − 10 = 74. Por casos: 1 profesor y 2 estudiantes, 4·C(5, 2) = 4·10 = 40; 2 profesores y 1 estudiante, C(4, 2)·5 = 6·5 = 30; 3 profesores, C(4, 3) = 4. La suma es 40 + 30 + 4 = 74. El 112 sale de elegir un profesor (4 formas) y completar con cualquier pareja de las otras 8 personas (C(8, 2) = 28): 4·28 = 112 cuenta dos veces los comités con 2 profesores y tres veces el de 3 profesores (40 + 2·30 + 3·4 = 112). El 444 sale de contar con orden y el 604, de contar con orden y además con repetición.
