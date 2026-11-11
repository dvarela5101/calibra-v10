# Identidades trigonométricas

Simplificación de expresiones trigonométricas y cálculo de valores exactos con las identidades recíprocas, de cociente, pitagóricas, de suma y resta y de ángulo doble. Cae en el Parcial 4 (semana 16).

## Habilidades
kc: identidades-basicas · Simplificar expresiones y demostrar identidades con las identidades recíprocas, de cociente, pitagóricas, de suma y resta y de ángulo doble · prerrequisitos: angulo-referencia, sumar-racionales

## Errores
mc: reciproca-mal-asignada · identidades-basicas · confundes de qué función es recíproca cada una: tomas sec x como 1/sen x o como cos x, o csc x como 1/cos x
mc: tangente-como-cos-entre-sen · identidades-basicas · tomas tan x como cos x / sen x, al revés del cociente correcto sen x / cos x
mc: pitagorica-despeje-signo-cambiado · identidades-basicas · al despejar una identidad pitagórica te equivocas de signo: tomas 1 − sen²x como −cos²x, o cos²x como sen²x − 1
mc: suma-angulos-distribuye-funcion · identidades-basicas · distribuyes la función sobre la suma de ángulos: tomas sen(a ± b) como sen a ± sen b, o cos(a ± b) como cos a ± cos b
mc: doble-angulo-multiplica-por-dos · identidades-basicas · tomas sen 2x como 2 sen x y cos 2x como 2 cos x, como si duplicar el ángulo duplicara el valor
mc: suma-resta-signo-equivocado · identidades-basicas · en la fórmula de suma o resta de ángulos pones el signo contrario al que corresponde, por ejemplo sen(a − b) con un + o cos(a + b) con un +

## Preguntas

### P141 · dificultad 1 · kc: identidades-basicas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al simplificar sen x · sec x, con x donde la expresión está definida, se obtiene:

- A) 1 · [reciproca-mal-asignada] tomas sec x como 1/sen x y el producto sen x·(1/sen x) queda en 1
- B) sen x · cos x · [reciproca-mal-asignada] tomas sec x como cos x y no como su recíproco 1/cos x
- C) tan x · CORRECTA
- D) cot x · [tangente-como-cos-entre-sen] llegas a sen x / cos x pero crees que ese cociente es cot x, porque tomas tan x como cos x / sen x

solución: por definición, la secante es el recíproco del coseno. Al sustituirla en el producto queda el cociente sen x / cos x, que es tan x.

### P142 · dificultad 2 · kc: identidades-basicas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál de estas expresiones es idéntica a csc x − sen x en todos los x donde ambas están definidas?

- A) cos x · cot x · CORRECTA
- B) cos x · tan x · [tangente-como-cos-entre-sen] llegas a cos²x / sen x = cos x·(cos x / sen x) pero tomas cos x / sen x como tan x
- C) −cos x · cot x · [pitagorica-despeje-signo-cambiado] tomas 1 − sen²x como −cos²x en vez de cos²x
- D) sec x − sen x · [reciproca-mal-asignada] tomas csc x como 1/cos x y por eso lo cambias por sec x

solución: csc x − sen x = 1/sen x − sen x = (1 − sen²x)/sen x. Por la identidad pitagórica, 1 − sen²x = cos²x, así que queda cos²x / sen x = cos x · (cos x / sen x) = cos x · cot x. Con x = π/6: csc − sen = 2 − 1/2 = 3/2 y cos x · cot x = (√3/2)(√3) = 3/2.

### P143 · dificultad 2 · kc: identidades-basicas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El valor exacto de sen 15° es:

- A) $\frac{\sqrt6+\sqrt2}{4}$ · [suma-resta-signo-equivocado] escribes 15° = 45° − 30° pero usas sen(a − b) = sen a cos b + cos a sen b, con + en lugar de −
- B) 1/4 · [doble-angulo-multiplica-por-dos] tomas sen 30° = 2 sen 15° y despejas sen 15° = sen 30° / 2
- C) $\frac{\sqrt2-1}{2}$ · [suma-angulos-distribuye-funcion] tomas sen(45° − 30°) como sen 45° − sen 30°
- D) $\frac{\sqrt6-\sqrt2}{4}$ · CORRECTA

solución: 15° = 45° − 30°. Entonces sen 15° = sen 45° cos 30° − cos 45° sen 30° = (√2/2)(√3/2) − (√2/2)(1/2) = (√6 − √2)/4. Numéricamente da cerca de 0,2588, que coincide con sen 15°.

### P144 · dificultad 2 · kc: identidades-basicas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Si x es un ángulo agudo con sen x = 3/5, el valor de cos 2x es:

- A) 1 · [suma-resta-signo-equivocado] escribes cos 2x = cos(x + x) con un + entre los productos: cos²x + sen²x = 16/25 + 9/25 = 1
- B) 7/25 · CORRECTA
- C) 8/5 · [doble-angulo-multiplica-por-dos] tomas cos 2x como 2 cos x = 2·4/5
- D) −1 · [pitagorica-despeje-signo-cambiado] despejas cos²x = sen²x − 1 = −16/25 y calculas cos²x − sen²x = −16/25 − 9/25 = −1

solución: de sen x = 3/5 se tiene cos²x = 16/25, y por ser agudo cos x = 4/5. Con la fórmula del ángulo doble, cos 2x resulta 16/25 − 9/25 = 7/25. Otra vía da el mismo valor: 1 − 2·(9/25) = 7/25.

### P145 · dificultad 3 · kc: identidades-basicas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al simplificar $\frac{\sen\left(x+\frac{\pi}{2}\right)}{\csc x}$, con x donde la expresión está definida, se obtiene:

- A) sen²x + sen x · [suma-angulos-distribuye-funcion] tomas sen(x + π/2) como sen x + sen(π/2) = sen x + 1 y lo multiplicas por sen x
- B) −sen x · cos x · [suma-resta-signo-equivocado] usas sen(a + b) = sen a cos b − cos a sen b, con − en lugar de +, y el numerador queda −cos x
- C) sen x · cos x · CORRECTA
- D) cos²x · [reciproca-mal-asignada] tomas csc x como 1/cos x, así que dividir entre csc x equivale a multiplicar por cos x

solución: en el numerador, la fórmula de la suma da cos x, porque cos(π/2) = 0 y sen(π/2) = 1. Dividir entre csc x es multiplicar por su recíproco sen x, así que el resultado es cos x · sen x. Prueba con x = π/6: sen(2π/3) / csc(π/6) = (√3/2)/2 = √3/4, y sen x cos x = (1/2)(√3/2) = √3/4.
