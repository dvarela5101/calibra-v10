# Dinámica rotacional

Talleres 10 a 12. Errores a cazar: usar el momento de inercia del eje equivocado y olvidar el teorema de ejes paralelos.

## Habilidades
kc: rotacional · Dinámica rotacional

## Errores
mc: rotacional-e1 · rotacional · usas el momento de inercia para rotación en un extremo en lugar del centro
mc: rotacional-e2 · rotacional · olvidas el factor geométrico del momento de inercia
mc: rotacional-e3 · rotacional · confundes la fórmula con la de un disco
mc: rotacional-e4 · rotacional · olvidas aplicar el teorema de ejes paralelos
mc: rotacional-e5 · rotacional · usas incorrectamente la distancia entre ejes
mc: rotacional-e6 · rotacional · sumas mal los términos del teorema de ejes paralelos
mc: rotacional-e7 · rotacional · inviertes la relación entre torque y momento de inercia
mc: rotacional-e8 · rotacional · usas el radio en lugar del momento de inercia en la ecuación
mc: rotacional-e9 · rotacional · confundes aceleración angular con velocidad angular

## Preguntas

### P10 · dificultad 2 · kc: rotacional · revisada · origen: humano · revisó: prototipo
Una varilla delgada de masa M y longitud L gira alrededor de su centro. ¿Cuál es su momento de inercia?

- A) $\frac{ML^2}{12}$ · CORRECTA
- B) $\frac{ML^2}{3}$ · [rotacional-e1]
- C) $ML^2$ · [rotacional-e2]
- D) $\frac{ML^2}{2}$ · [rotacional-e3]

### P11 · dificultad 2 · kc: rotacional · revisada · origen: humano · revisó: prototipo
Una esfera sólida de radio R y masa M gira alrededor de un eje tangente a su superficie. Si $I_{\text{centro}} = \frac{2}{5}MR^2$, ¿cuál es el momento de inercia respecto al eje tangente?

- A) $\frac{7}{5}MR^2$ · CORRECTA
- B) $\frac{2}{5}MR^2$ · [rotacional-e4]
- C) $MR^2$ · [rotacional-e5]
- D) $\frac{3}{5}MR^2$ · [rotacional-e6]

### P12 · dificultad 2 · kc: rotacional · revisada · origen: humano · revisó: prototipo
Un disco de radio 0.5 m tiene momento de inercia I = 2 kg·m². Si se le aplica un torque de 10 N·m, ¿cuál es su aceleración angular?

- A) 5 rad/s² · CORRECTA
- B) 20 rad/s² · [rotacional-e7]
- C) 4 rad/s² · [rotacional-e8]
- D) 2.5 rad/s² · [rotacional-e9]

### P16 · dificultad 3 · kc: rotacional · borrador · origen: ia (sonnet-5.5)
Una varilla delgada y uniforme de 5 kg y 1.5 m de largo gira en un plano horizontal alrededor de un eje vertical fijo que la atraviesa a 0.25 m de su centro. Sobre ese eje actúa un torque neto constante de 15 N·m. Si se desprecia la fricción en el eje, ¿cuál es la aceleración angular inicial de la varilla?

- A) 12 rad/s² · CORRECTA
- B) 4 rad/s² · [rotacional-e1] usas el momento de inercia de un eje en el extremo, $\frac{ML^2}{3} = 3.75$ kg·m², aunque el eje no está en el extremo
- C) 16 rad/s² · [rotacional-e4] olvidas aplicar el teorema de ejes paralelos y usas solo el momento de inercia respecto al centro, $\frac{ML^2}{12} = 0.9375$ kg·m²
- D) 48 rad/s² · [rotacional-e6] usas solo uno de los dos términos del teorema de ejes paralelos: tomas $Md^2 = 0.3125$ kg·m² y dejas por fuera $I_{\text{cm}}$

solución: la segunda ley de la rotación es τ = I·α, así que primero hace falta el momento de inercia respecto al eje dado. Respecto al centro, $I_{\text{cm}} = \frac{1}{12}ML^2 = \frac{1}{12}(5)(1.5)^2 = 0.9375$ kg·m². El eje está a d = 0.25 m del centro, y por el teorema de ejes paralelos $I = I_{\text{cm}} + Md^2 = 0.9375 + 5(0.25)^2 = 1.25$ kg·m². Entonces α = τ/I = 15/1.25 = 12 rad/s². Los 4 rad/s² salen de usar $ML^2/3 = 3.75$ kg·m² (eje en el extremo), los 16 rad/s² de usar solo 0.9375 kg·m², y los 48 rad/s² de usar solo $Md^2 = 0.3125$ kg·m².
