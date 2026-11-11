# Trigonometría en triángulos rectángulos

Razones trigonométricas de un ángulo agudo con los lados de un triángulo rectángulo, y cómo usarlas para hallar lados y ángulos que faltan, también con el ángulo complementario. Cae en el Parcial 4 (semana 16).

## Habilidades
kc: razones-triangulo · Hallar las razones trigonométricas y los lados o ángulos que faltan en un triángulo rectángulo · prerrequisitos: exponentes-racionales

## Errores
mc: opuesto-adyacente-intercambiados · razones-triangulo · tomas el cateto adyacente como si fuera el opuesto al ángulo dado, o al revés
mc: razon-trig-invertida · razones-triangulo · escribes la razón al revés, con la hipotenusa o el otro cateto arriba en vez de abajo
mc: confunde-seno-con-tangente · razones-triangulo · mezclas las razones: pones la hipotenusa en la tangente o el otro cateto en el seno
mc: hipotenusa-mal-calculada · razones-triangulo · hallas la hipotenusa sumando los catetos, o sumando sus cuadrados sin sacar la raíz
mc: despeje-con-operacion-contraria · razones-triangulo · al despejar el lado desconocido divides donde debías multiplicar, o al revés
mc: complemento-mal-usado · razones-triangulo · para el otro ángulo agudo usas el mismo ángulo o su suplemento, en vez de 90° menos el ángulo

## Preguntas

### P126 · dificultad 1 · kc: razones-triangulo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un triángulo rectángulo tiene catetos de 5 y 12. Sea θ el ángulo agudo opuesto al cateto de 5. ¿Cuánto vale sen θ?

- A) 5/13 · CORRECTA
- B) 12/13 · [opuesto-adyacente-intercambiados] tomas el cateto de 12 como el opuesto a θ y calculas lo que en realidad es cos θ
- C) 13/5 · [razon-trig-invertida] escribes hipotenusa sobre cateto opuesto, que es csc θ y no sen θ
- D) 5/17 · [hipotenusa-mal-calculada] sumas los catetos, 5 + 12 = 17, y lo usas como hipotenusa

solución: la hipotenusa es √(5² + 12²) = √169 = 13. El seno es cateto opuesto sobre hipotenusa: sen θ = 5/13.

### P127 · dificultad 2 · kc: razones-triangulo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un triángulo rectángulo tiene catetos de 7 y 24. Sea α el ángulo agudo que forma el cateto de 24 con la hipotenusa. ¿Cuánto vale cos α?

- A) 24/25 · CORRECTA
- B) 7/25 · [opuesto-adyacente-intercambiados] tomas el cateto de 7 como el adyacente a α y calculas lo que en realidad es sen α
- C) 25/24 · [razon-trig-invertida] escribes hipotenusa sobre cateto adyacente, que es sec α y no cos α
- D) 24/625 · [hipotenusa-mal-calculada] sumas los cuadrados, 49 + 576 = 625, y no sacas la raíz para obtener la hipotenusa

solución: la hipotenusa es √(7² + 24²) = √625 = 25. El coseno es cateto adyacente sobre hipotenusa: el cateto adyacente a α es el de 24, así que cos α = 24/25.

### P128 · dificultad 2 · kc: razones-triangulo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En un triángulo rectángulo, la hipotenusa mide 14 y uno de los ángulos agudos mide 30°. ¿Cuánto mide el cateto opuesto a ese ángulo?

- A) 7 · CORRECTA
- B) 28 · [despeje-con-operacion-contraria] de sen 30° = x/14 despejas x = 14/sen 30° en vez de x = 14·sen 30°
- C) $7\sqrt{3}$ · [opuesto-adyacente-intercambiados] usas el coseno, que da el cateto adyacente, como si fuera el opuesto
- D) $\frac{14\sqrt{3}}{3}$ · [confunde-seno-con-tangente] usas tan 30° con la hipotenusa, como si la tangente fuera cateto opuesto sobre hipotenusa

solución: el cateto opuesto y la hipotenusa se relacionan con el seno: sen 30° = x/14. Como sen 30° = 1/2, x = 14·(1/2) = 7.

### P129 · dificultad 2 · kc: razones-triangulo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En un triángulo rectángulo, un ángulo agudo mide 60° y la hipotenusa mide 12. ¿Cuánto mide el cateto opuesto al otro ángulo agudo?

- A) 6 · CORRECTA
- B) $6\sqrt{3}$ · [complemento-mal-usado] calculas el otro ángulo como 180° − 60° = 120° y usas 12·sen 120°
- C) 24 · [despeje-con-operacion-contraria] de sen 30° = x/12 despejas x = 12/sen 30° en vez de multiplicar
- D) $4\sqrt{3}$ · [confunde-seno-con-tangente] usas 12·tan 30°, como si la tangente fuera cateto opuesto sobre hipotenusa

solución: los ángulos agudos de un triángulo rectángulo suman 90°, así que el otro ángulo mide 90° − 60° = 30°. El cateto opuesto a 30° cumple sen 30° = x/12, y x = 12·(1/2) = 6.

### P130 · dificultad 3 · kc: razones-triangulo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En un triángulo rectángulo, α y β son los dos ángulos agudos y tan α = 5/12. ¿Cuánto vale sen β?

- A) 12/13 · CORRECTA
- B) 5/13 · [complemento-mal-usado] tomas sen β igual a sen α, sin ver que β es el complemento de α
- C) 12/5 · [confunde-seno-con-tangente] pones el cateto opuesto a β sobre el adyacente, que es tan β, en vez de dividir entre la hipotenusa
- D) 13/12 · [razon-trig-invertida] escribes hipotenusa sobre cateto opuesto a β, que es csc β y no sen β

solución: tan α = 5/12 dice que el cateto opuesto a α mide 5 y el adyacente 12 (en la misma proporción), y la hipotenusa es √(5² + 12²) = 13. El cateto de 12 es opuesto a β, porque β es el otro ángulo agudo. Entonces sen β = 12/13, que también es cos α.
