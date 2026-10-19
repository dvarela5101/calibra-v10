# Green, Stokes y Gauss

8.1 a 8.4. Errores a cazar: aplicar Green a una curva que no es cerrada, equivocar la orientación de la frontera, y usar Gauss donde corresponde Stokes.

## Habilidades
kc: teoremas · Green, Stokes y Gauss

## Errores
mc: teoremas-e1 · teoremas · aplicas Green a una curva que no es cerrada
mc: teoremas-e2 · teoremas · equivocas la orientación de la frontera
mc: teoremas-e3 · teoremas · confundes las condiciones de aplicabilidad
mc: teoremas-e4 · teoremas · usas Gauss donde corresponde Stokes
mc: teoremas-e5 · teoremas · confundes las condiciones de Stokes
mc: teoremas-e6 · teoremas · usas Stokes donde corresponde Gauss
mc: teoremas-e7 · teoremas · aplicas teorema incorrecto para superficies cerradas
mc: teoremas-e8 · teoremas · confundes campo conservativo con divergencia nula

## Preguntas

### P10 · dificultad 2 · kc: teoremas · revisada · origen: humano · revisó: prototipo
El teorema de Green permite calcular $\int_C P\,dx + Q\,dy$ como una integral doble sobre la región D cuando:

- A) C es una curva cerrada simple que encierra D · CORRECTA
- B) C es cualquier curva (no necesariamente cerrada) · [teoremas-e1]
- C) C es cerrada con orientación horaria · [teoremas-e2]
- D) P y Q son constantes · [teoremas-e3]

### P11 · dificultad 2 · kc: teoremas · revisada · origen: humano · revisó: prototipo
Para aplicar el teorema de Stokes a $\int_C F\cdot dr$ donde C es la frontera de una superficie S:

- A) C debe recorrerse según la regla de la mano derecha respecto a la normal de S · CORRECTA
- B) C debe recorrerse en sentido horario · [teoremas-e2]
- C) S debe ser una superficie cerrada · [teoremas-e4]
- D) F debe ser conservativo · [teoremas-e5]

### P12 · dificultad 2 · kc: teoremas · revisada · origen: humano · revisó: prototipo
El teorema de Gauss (divergencia) relaciona $\iint_S F\cdot n\,dS$ con:

- A) $∭_V \mathrm{div}\,F\,dV$ donde S encierra V · CORRECTA
- B) $\iint_S \mathrm{rot}\,F\cdot n\,dS$ · [teoremas-e6]
- C) $\int_C F\cdot dr$ donde C es la frontera de S · [teoremas-e7]
- D) 0 si F es conservativo · [teoremas-e8]

### P16 · dificultad 1 · kc: teoremas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea C la circunferencia x² + y² = 1 recorrida en sentido antihorario. Por el teorema de Green, $\oint_C (3x-y)\,dx + (2x+4y)\,dy$ vale:

- A) −3π · [teoremas-e2] recorres la frontera en sentido horario, así que el signo del resultado cambia
- B) 0 · [teoremas-e3] crees que toda integral sobre una curva cerrada vale 0, sin comprobar si ∂Q/∂x = ∂P/∂y
- C) 7π · [teoremas-e4] integras la divergencia ∂P/∂x + ∂Q/∂y = 3 + 4, que es la forma de flujo (Gauss en el plano), en lugar de ∂Q/∂x − ∂P/∂y
- D) 3π · CORRECTA

solución: con P = 3x − y y Q = 2x + 4y, el teorema de Green da $\oint_C P\,dx + Q\,dy = \iint_D \left(\frac{\partial Q}{\partial x} - \frac{\partial P}{\partial y}\right)dA$, donde D es el disco x² + y² ≤ 1 y C es su frontera, cerrada y en sentido antihorario.
Aquí ∂Q/∂x = 2 y ∂P/∂y = −1, así que el integrando vale 2 − (−1) = 3 y la integral es 3 por el área del disco, es decir, 3π. El término 3x de P no cambia el resultado, porque no depende de y.
Comprobación directa con x = cos t, y = sen t: el integrando queda sen²t + 2cos²t + sen t cos t y su integral de 0 a 2π es π + 2π + 0 = 3π.
Las otras opciones salen de errores concretos: −3π es el resultado con la orientación horaria; 0 solo valdría si ∂Q/∂x = ∂P/∂y, y aquí la diferencia es 3; 7π sale de integrar ∂P/∂x + ∂Q/∂y = 3 + 4 sobre el disco.
