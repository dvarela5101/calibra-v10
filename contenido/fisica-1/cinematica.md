# Cinemática

Talleres 1 a 3. Errores a cazar: confundir velocidad media con instantánea, tratar la caída libre como velocidad constante, y separar mal las componentes en el tiro parabólico.

## Habilidades
kc: cinematica · Cinemática

## Errores
mc: cinematica-e1 · cinematica · confundes velocidad instantánea con velocidad final
mc: cinematica-e2 · cinematica · calculas la velocidad media en lugar de la instantánea
mc: cinematica-e3 · cinematica · aplicas mal la proporción lineal de la aceleración constante
mc: cinematica-e4 · cinematica · tratas la caída libre como si tuviera velocidad constante
mc: cinematica-e5 · cinematica · duplicas incorrectamente el valor por no usar la fórmula correcta
mc: cinematica-e6 · cinematica · usas solo el primer segundo de caída
mc: cinematica-e7 · cinematica · usas el seno en lugar del coseno para la componente horizontal
mc: cinematica-e8 · cinematica · olvidas descomponer el vector velocidad
mc: cinematica-e9 · cinematica · intercambias las componentes x e y en el cálculo

## Preguntas

### P1 · dificultad 2 · kc: cinematica · revisada · origen: humano · revisó: prototipo
Un auto acelera uniformemente desde el reposo hasta 20 m/s en 4 segundos. ¿Cuál es su velocidad en t = 2 s?

- A) 10 m/s · CORRECTA
- B) 20 m/s · [cinematica-e1]
- C) 5 m/s · [cinematica-e2]
- D) 15 m/s · [cinematica-e3]

### P2 · dificultad 2 · kc: cinematica · revisada · origen: humano · revisó: prototipo
Un objeto se suelta desde el reposo y cae libremente. Después de 3 segundos, ¿qué distancia ha recorrido? (g = 10 m/s²)

- A) 45 m · CORRECTA
- B) 30 m · [cinematica-e4]
- C) 90 m · [cinematica-e5]
- D) 15 m · [cinematica-e6]

### P3 · dificultad 2 · kc: cinematica · revisada · origen: humano · revisó: prototipo
Un proyectil se lanza con velocidad inicial de 50 m/s a 37° sobre la horizontal. ¿Cuál es la componente horizontal de la velocidad inicial? (sen 37° = 0.6, cos 37° = 0.8)

- A) 40 m/s · CORRECTA
- B) 30 m/s · [cinematica-e7]
- C) 50 m/s · [cinematica-e8]
- D) 32 m/s · [cinematica-e9]

### P13 · dificultad 1 · kc: cinematica · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Desde un puente se lanza una piedra verticalmente hacia abajo con una velocidad inicial de 4 m/s. Sin tener en cuenta la resistencia del aire, ¿cuál es su velocidad instantánea 3 s después de ser lanzada? (g = 10 m/s²)

- A) 14 m/s · [cinematica-e6] usas solo el primer segundo de caída, 4 + 10×1 = 14 m/s, en lugar de los 3 s que pasaron
- B) 34 m/s · CORRECTA
- C) 4 m/s · [cinematica-e4] tratas la caída libre como si la velocidad se mantuviera constante en 4 m/s
- D) 30 m/s · [cinematica-e3] tomas la velocidad como proporcional al tiempo, v = g·t = 10×3 = 30 m/s, y dejas por fuera los 4 m/s con que se lanzó la piedra; esa proporción solo vale cuando parte del reposo

solución: tomando el sentido hacia abajo como positivo, la gravedad cambia la velocidad 10 m/s cada segundo, así que v = v₀ + g·t = 4 + 10×3 = 34 m/s hacia abajo. Los 30 m/s salen de v = g·t, que olvida la velocidad inicial (solo sirve si la piedra parte del reposo); los 14 m/s salen de contar solo el primer segundo, 4 + 10×1; y los 4 m/s suponen que la velocidad no cambia.
