# Optimización y razones de cambio

Errores a cazar: derivar antes de escribir la restricción, y no verificar que el resultado tenga sentido físico.

## Habilidades
kc: optimizacion · Optimización y razones de cambio

## Errores
mc: optimizacion-e1 · optimizacion · derivas A = x·y sin usar primero la restricción 2x + 2y = 100
mc: optimizacion-e2 · optimizacion · propones dimensiones arbitrarias sin optimizar
mc: optimizacion-e3 · optimizacion · obtienes un resultado matemático que no tiene sentido físico como terreno
mc: optimizacion-e4 · optimizacion · derivas el volumen pero olvidas aplicar correctamente la regla de la cadena con respecto al tiempo
mc: optimizacion-e5 · optimizacion · confundes la tasa de cambio del volumen con la del radio
mc: optimizacion-e6 · optimizacion · calculas un valor que no verificas si tiene sentido físico para la situación
mc: optimizacion-e7 · optimizacion · asumes que ambos extremos se mueven a la misma velocidad
mc: optimizacion-e8 · optimizacion · calculas la magnitud pero olvidas que el extremo superior baja (signo negativo)
mc: optimizacion-e9 · optimizacion · derivas la ecuación x² + y² = 100 antes de sustituir correctamente x = 8 cuando y = 6

## Preguntas

### P10 · dificultad 2 · kc: optimizacion · revisada · origen: humano · revisó: prototipo
Quieres cercar un terreno rectangular con 100 m de cerca. ¿Qué dimensiones maximizan el área?

- A) 25 m × 25 m (cuadrado) · CORRECTA
- B) 50 m × 50 m · [optimizacion-e1]
- C) 30 m × 20 m · [optimizacion-e2]
- D) 100 m × 0 m · [optimizacion-e3]

### P11 · dificultad 2 · kc: optimizacion · revisada · origen: humano · revisó: prototipo
Un globo esférico se infla a razón de 10 cm³/s. ¿A qué velocidad crece el radio cuando r = 5 cm? ($V = \frac{4}{3}\pi r^3$)

- A) $\frac{dr}{dt} = \frac{10}{4\pi\cdot 25} = \frac{1}{10\pi}$ cm/s · CORRECTA
- B) $\frac{dr}{dt} = \frac{10}{r^2}$ · [optimizacion-e4]
- C) $\frac{dr}{dt} = 10$ cm/s · [optimizacion-e5]
- D) $\frac{dr}{dt} = 2$ cm/s · [optimizacion-e6]

### P12 · dificultad 2 · kc: optimizacion · revisada · origen: humano · revisó: prototipo
Una escalera de 10 m resbala por una pared. Si el extremo inferior se aleja a 2 m/s, ¿a qué velocidad baja el extremo superior cuando está a 6 m del suelo?

- A) $\frac{dy}{dt} = -\frac{3}{2}$ m/s · CORRECTA
- B) $\frac{dy}{dt} = -2$ m/s · [optimizacion-e7]
- C) $\frac{dy}{dt} = 2$ m/s · [optimizacion-e8]
- D) $\frac{dy}{dt} = -\frac{8}{3}$ m/s · [optimizacion-e9]
