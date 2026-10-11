# Códigos oficiales de las materias del banco

Consulta del 11-oct-2026 que hizo Juzou04 con Claude, a pedido de dvarela5101. La carga de materias (HU-055) empareja por `Materia.codigo`, y D-16 y REVISION_REGLAS §3 dejaron cuatro códigos sin confirmar. Las fuentes se numeran al final y se citan entre corchetes.

## Resultado

El código de Física II que usa hoy la universidad es FISI-1528, no FISI-1019 ni FISI-1028. FISI-1028 fue el código anterior y FISI-1019 nunca fue Física II: en los catálogos de 2014 a 2023 es Física Experimental I, el laboratorio de mecánica. Lo mismo pasa con Física I: el código vigente es FISI-1518 y FISI-1018 es el anterior. MATE-1203 e ISIS-1221 están confirmados tal como están en el banco, y también los otros cuatro códigos (MATE-1105, MATE-1214, MATE-1207, IIND-2106).

El Parcial 1 de Física II es de termodinámica y cae en la semana 5 según el único programa público reciente (2022-2). Los temas del banco (electrostática, potencial, circuitos, magnetismo) son de los parciales 2 a 4 de esa materia, no del Parcial 1.

## Tabla

| Materia | Código en el banco | Código confirmado | Fuente | Semana del primer parcial según la fuente |
|---|---|---|---|---|
| Física I | FISI-1018 | FISI-1518. FISI-1018 es el código anterior | [1] [2] [3] [4] [5] | 7, en el programa de 2020-1, que lleva el código FISI 1018 [7]. No hay programa público de FISI-1518 |
| Física II | FISI-1019 | FISI-1528. FISI-1028 es el código anterior. FISI-1019 es incorrecto | [1] [2] [3] [4] [5] [6] | 5, en el programa de 2022-2 [6]. Ese parcial es de termodinámica |
| Cálculo Diferencial | MATE-1203 | MATE-1203, confirmado | [3] [4] [5] [8] [9] | 5, en el programa de 2024-2 [9] |
| Introducción a la Programación | ISIS-1221 | ISIS-1221, confirmado | [3] [4] [5] [8] [15] [16] | No hay programa oficial público con cronograma. El examen de nivel 2 cae en la semana 8 en el calendario de una sección de 2026-1 [15] |
| Álgebra Lineal | MATE-1105 | MATE-1105, confirmado (el catálogo la llama "Álgebra Lineal 1") | [3] [4] [5] [8] [10] | 6, en el programa de 2026-2: Parcial I el 9-sep-2026 [10] |
| Cálculo Integral con Ecuaciones Diferenciales | MATE-1214 | MATE-1214, confirmado | [3] [4] [5] [8] [11] | Sección 5 de 2025-2: Parcial 1 en la semana 4, Parcial 2 en la 8 y Parcial 3 en la 13 [11] |
| Cálculo Vectorial | MATE-1207 | MATE-1207, confirmado | [3] [4] [5] [8] [12] | 7, en el programa de 2025-2. El Parcial 2 cae en la 13 [12] |
| Probabilidad y Estadística | IIND-2106 | IIND-2106, confirmado (el catálogo la llama "Probabilidad y Estadística I") | [4] [8] [13] [14] | 7, en el programa de 2020-1: 4-mar-2020, sesiones 1 a 6 [13]. No encontré cronograma de 2025 ni de 2026 |

## Física II

Hoy la universidad llama a la materia FISI-1528. Es el único código de Física II en los catálogos generales de 2024, 2025 y 2026, y el que usan el pensum de Física de 2026, el currículo de Ingeniería de Sistemas de 2024 y el pensum de Ingeniería Industrial de 2026 [1] [3] [4] [5]. FISI-1028 fue el código de Física II hasta el plan anterior: está en los catálogos de 2014 a 2023 con el nombre Física II y una descripción que habla de termodinámica y electromagnetismo [2]. El programa de 2022-2 cubre los dos códigos a la vez: 1028 para las secciones regulares y 1528 para la sección reformada, que incluye el laboratorio en la nota [6]. El currículo de Sistemas de 2024 todavía escribe "FISI-1028 o FISI-1528" en un prerrequisito [4]. FISI-1019 es Física Experimental I (1 crédito) en todos los catálogos de 2014 a 2023 [2], de modo que no puede ser Física II.

El Parcial 1 de esa materia es de termodinámica. En el programa de 2022-2 cae el viernes 9 de septiembre, semana 5, y cubre temperatura, dilatación térmica, calor y calorimetría, cambios de fase, gas ideal, primera y segunda ley, máquinas térmicas, ciclo de Carnot y entropía [6]. Los temas del banco corresponden a los parciales siguientes de ese mismo programa: electrostática (carga, Coulomb, campo, Gauss) al Parcial 2, en la semana 8; potencial, capacitores y circuitos al Parcial 3, en la semana 12; y magnetismo al Parcial 4, en la semana 16 [6]. Son temas de la misma materia, pero no del parcial al que el banco los asocia, y el banco no tiene preguntas de termodinámica.

Otras fuentes también ponen la termodinámica al principio del curso. La descripción oficial de FISI 1028 en las páginas de dos departamentos de ingeniería empieza por temperatura, calor y leyes de la termodinámica [17]. Los primeros parciales públicos del Departamento de Física (2011-1 y vacacional de 2018) son de termodinámica [18]. Los talleres de 2024-1 de las semanas 1 a 3 tratan dilatación térmica, calor latente, gas ideal y capacidad calorífica [19]. Pero no encontré ningún programa de Física II posterior a 2022-2, así que las semanas 5, 8, 12 y 16 son las de ese semestre y pueden haber cambiado. Una reseña de 2026-2 en un sitio de estudiantes (no oficial) habla de cuatro parciales, lo que apunta a la misma estructura, pero no la confirma.

## Recomendación para dvarela5101

1. `contenido/fisica-2/materia.md`: cambiar `codigo: FISI-1019` por `codigo: FISI-1528`, en un PR corto después de HU-055. Hoy la carga reconoce la materia por código, así que cambiarlo antes crearía otra materia en una base que ya cargó el banco; con HU-055 la reconoce por su carpeta (SPEC de HU-055, supuesto S13).

2. `contenido/fisica-2/materia.md`: la Evaluación actual ("Parcial 1, semana 5") junta los cuatro temas de electromagnetismo, y ese parcial es de termodinámica. Una estructura que sigue el modelo de `calculo-diferencial` y refleja el programa de 2022-2:

   ```
   ### parcial-2 · Parcial 2 · semana 8
   temas: electrostatica

   ### parcial-3 · Parcial 3 · semana 12
   temas: potencial, circuitos

   ### parcial-4 · Parcial 4 · semana 16
   temas: magnetismo
   ```

   El Parcial 1 (termodinámica, semana 5) se agregaría cuando haya preguntas, y conviene anotarlo en `FALTA-MATERIAL.md`. Si hasta el corte debe quedar una sola Evaluación (D-16), lo que no se sostiene es el nombre "Parcial 1" y la semana 5. Antes de fusionar, vale la pena pedir el programa vigente de la materia al Departamento de Física o a un profesor de una sección actual, porque las semanas 8, 12 y 16 salen de un programa de hace cuatro años.

3. `contenido/fisica-1/materia.md`: cambiar `codigo: FISI-1018` por `codigo: FISI-1518`, en el mismo PR del punto 1. La semana 7 coincide con el programa de 2020-1, cuyo primer parcial cubre los capítulos 1 a 5 (cinemática y leyes de Newton). La energía y la rotación, que el banco incluye, van después de ese primer parcial en el mismo programa [7].

4. Sin cambios de código en `algebra-lineal`, `calculo-diferencial`, `calculo-integral`, `calculo-vectorial`, `introduccion-programacion` ni `probabilidad-estadistica`. Las semanas actuales (6, 5, 8, 7, 8 y 7) coinciden con las fuentes de la tabla.

5. Las mismas diferencias de tema que en Física II, solo como aviso porque la decisión es de ustedes: en el programa de 2026-2 de Álgebra Lineal, "espacios" empieza después del Parcial I (cae en el Parcial II, semana 11) [10]; en 2020-1, "inferencia" de Probabilidad y Estadística viene después del Parcial 1 [13]; en la sección 5 de Cálculo Integral de 2025-2, partes, sustitución e impropias son del Parcial 1 (semana 4), las ecuaciones diferenciales del Parcial 2 (semana 8) y las series del Parcial 3 (semana 13) [11]; y en Cálculo Vectorial de 2025-2, las integrales múltiples, de línea y los teoremas vienen después del Parcial 1 (semana 7) [12]. Juzou04 puede preparar el PR con esos ajustes si lo quieren.

6. La semilla local usa FISI-1018 como materia de prueba (README, D-2). No afecta la carga real, pero si se cambia el código de Física I conviene alinearla.

## Lo que no pude confirmar

- La oferta de cursos de 2026-2 (ofertadecursos.uniandes.edu.co) pide un captcha y no la consulté. Buscar FISI-1528 y FISI-1028 con el periodo 202620 confirmaría cuál se ofrece este semestre.
- No hay programa público de Física I posterior a 2020-1 ni de Física II posterior a 2022-2.
- Para ISIS-1221 no hay programa oficial público. La semana 8 sale del calendario de una sección que publicó su profesor [15]. Ese archivo escribe 2025 en la fecha del examen de nivel 2 (13 de marzo), pero los otros exámenes son de 2026; no verifiqué el inicio de clases de 2026-1 en el calendario de Registro.
- Para IIND-2106 solo tengo el cronograma de 2020-1. El material de 2025-1 trae el código y las 16 sesiones, sin fechas de parcial [14].
- Del material de Juan David revisé los encabezados de programas, parciales, talleres y bancos de problemas de las carpetas de Cálculo Diferencial, Cálculo Integral, Probabilidad, Física II e Introducción a la Programación. Los 451 archivos estaban descargados en el equipo (ninguno solo en la nube) y no abrí libros, diapositivas de Estructura de Datos ni la carpeta de Precálculo, que es MATE-1201 y no está en el banco.

## Fuentes

Catálogo general de la universidad (smartcatalogiq):

1. Cursos FISI, catálogos 2026, 2025 y 2024: https://uniandes.smartcatalogiq.com/en/2026/catalogo/courses/fisi, https://uniandes.smartcatalogiq.com/en/2025/catalogo/cursos/fisi, https://uniandes.smartcatalogiq.com/en/2024/catalogo/cursos/fisi. Solo traen FISI-1518 (Física I) y FISI-1528 (Física II), con periodo 202610 en el de 2026. La descripción de ambos cursos en esos catálogos está copiada de un curso de laboratorio, así que no sirve para saber su contenido.
2. Cursos FISI, catálogos 2014 a 2023: https://uniandes.smartcatalogiq.com/en/catalogo-general-2023/catalogo/cursos/fisi, https://uniandes.smartcatalogiq.com/en/catalogo-general-2022/catalogo/cursos/fisi, https://uniandes.smartcatalogiq.com/en/2020/catalogo/cursos/fisi. FISI-1018 Física I, FISI-1019 Física Experimental I, FISI-1028 Física II, FISI-1029 Física Experimental II; FISI-1518 y FISI-1528 aparecen con la nota "Reforma 202020".

Planes de estudio:

3. Pensum del pregrado en Física, 2026: https://fisica.uniandes.edu.co/images/soy-estudiante/pregrado-fisica/Pensum-Pregrado-Fisica_2026.pdf
4. Currículo de Ingeniería de Sistemas y Computación, 2024: https://sistemas.uniandes.edu.co/images/Programas/ISIS/curriculo-byn-2024.pdf
5. Plan de estudios de Ingeniería Industrial desde 2026-20: https://industrial.uniandes.edu.co/sites/default/files/Programas/IIND/Pensum/PensumIIND2026-20.pdf

Programas de curso:

6. Programa de Física 2, FISI 1028 y 1528, 2022-2: https://quantummaterials.uniandes.edu.co/images/Courses/ProgF%C3%ADsica2-202220_PGG.pdf
7. Programa de Física 1, FISI 1018, 2020-1: http://wwwprof.uniandes.edu.co/~gtellez/fisica1/programa.pdf (solo carga por http)
8. Catálogo 2026 de MATE-1203, MATE-1214, MATE-1207, MATE-1105, ISIS-1221 e IIND-2106: https://uniandes.smartcatalogiq.com/en/2026/catalogo/courses/mate/1000/mate-1203 (y la misma ruta con mate-1214, mate-1207, mate-1105, isis/1000/isis-1221 e iind/2000/iind-2106)
9. Programa de MATE-1203, sección 16, 2024-2 (copia en el material de cursos anteriores; el programa dice "Parcial 1: (Semana 5)").
10. Programa de MATE-1105 de 2026-2: https://math.uniandes.edu.co/~mwinklme/teaching/LinAlg-202620/PROGRAMA_Algebra_Lineal_202620-Winklmeier.pdf
11. Programa de MATE-1214, sección 5, 2025-2: https://math.uniandes.edu.co/aplicaciones/programas/2025-20/1214-5.pdf
12. Programa de MATE-1207 de 2025-2: https://math.uniandes.edu.co/aplicaciones/programas/2025-20/1207.pdf
13. Programa de IIND-2106 de 2020-1: https://industrial.uniandes.edu.co/sites/default/files/IIND_2106_PROBABILIDAD_Y_ESTADISTICA_I_2020_10.pdf
14. Bancos de problemas por sesión de Probabilidad y Estadística I (IIND2106) de 2025-1, con encabezado del Departamento de Ingeniería Industrial (material de cursos anteriores).
15. Calendario de exámenes de una sección de ISIS-1221 en 2026-1, publicado por su profesor: https://github.com/fedemelo/uniandes-profesor-ip (carpeta exams/config). El README identifica el curso como ISIS-1221.
16. Aula virtual guardada del curso, con código de curso 202320_ISIS1221 (2023-2), y diapositivas de bienvenida que nombran el curso como Introducción a la Programación con el código ISIS1221 (material de cursos anteriores).

Física II, apoyo sobre el contenido del Parcial 1:

17. Descripción oficial de FISI 1028 Física II en las páginas de Ingeniería Mecánica (https://mecanica.uniandes.edu.co/es/f%C3%ADsica-ii) y de Ingeniería Civil y Ambiental (https://civilyambiental.uniandes.edu.co/es/f%C3%ADsica-ii), publicada en 2019.
18. Exámenes públicos del Departamento de Física: primer parcial de Física II de 2011-1 y primer parcial vacacional de 2018, en https://fisica.uniandes.edu.co/soy-estudiante/estudiante-pregrado-en-fisica
19. Talleres de Física II de 2024-1, semanas 1 a 3 (material de cursos anteriores).
