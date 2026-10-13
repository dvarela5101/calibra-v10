# Banco de preguntas

De aquí saca Calibra las preguntas del diagnóstico. Cada materia tiene su carpeta y cada tema su archivo de Markdown, para que cualquiera del equipo pueda escribir y revisar preguntas en un PR sin programar.

**Esta carpeta manda, salvo lo que un admin corrigió en la app.** La base de datos se carga desde aquí con `npm run contenido:cargar`. Lo que un admin cambia en `/admin/materias` (el nombre y el código de una materia, el nombre y la semana de una evaluación) lo conserva la carga y lo avisa (ver «Comandos»). Lo que se edite a mano en la base, sin pasar por la app, se pierde en la siguiente carga.

El diseño completo, con el porqué de cada regla, está en [docs/diseno/2026-09-29-banco-por-habilidades.md](../docs/diseno/2026-09-29-banco-por-habilidades.md). El material fuente (parciales, talleres, guías) nunca entra a este repo: es de los profesores y de la universidad, y el repo es público.

## Cómo está organizado

```
contenido/
  <materia>/           carpeta en minúsculas, sin tildes, con guiones: calculo-integral
    materia.md         código, nombre, libro, temas y evaluaciones
    <tema>.md          un archivo por tema: habilidades, errores y preguntas
```

### materia.md

```markdown
---
codigo: MATE-1214
nombre: Cálculo Integral con Ecuaciones Diferenciales
libro: Stewart, Cálculo de una variable, 6.ª ed.
---

Texto libre sobre la materia. No se carga.

## Temas
- partes
- sustitucion

## Evaluaciones

### parcial-1 · Parcial 1 · semana 4
temas: partes

### parcial-2 · Parcial 2 · semana 8 · acumulativa
temas: sustitucion
```

- `codigo` es el código Uniandes en mayúsculas (`MATE-1214`). La carga reconoce la materia por su carpeta y no por el código, así que cambiarlo después no crea otra materia: si nadie lo editó en la app, la siguiente carga lo aplica. Si otra materia ya tiene el código nuevo, la carga falla entera y nombra las dos.
- `## Temas` da el orden de los temas. Cada clave tiene su archivo `<clave>.md` y cada archivo de tema está en la lista.
- Cada materia tiene al menos una evaluación. La semana es la del curso, según el programa de la materia.
- Una evaluación `acumulativa` cubre sus temas y los de todas las evaluaciones de la misma materia con semana menor. Si no agrega temas propios, la línea queda como `temas:`.

### Un tema

```markdown
# Integración por partes

Texto libre sobre el tema. No se carga.

## Habilidades
kc: partes-formula · Aplicar uv − ∫v du con signos y términos correctos
kc: partes-reiterada · Aplicar partes varias veces · prerrequisitos: partes-formula, calculo-diferencial/regla-producto

## Errores
mc: signo-partes · partes-formula · te equivocas en el signo de la fórmula uv − ∫v du
mc: omite-uv · partes-formula · omites el término u·v

## Preguntas

### P4 · dificultad 2 · kc: partes-formula · revisada · origen: humano · revisó: Laura
En ∫ x·eˣ dx, con u = x y dv = eˣ dx, el resultado es:

- A) x·eˣ − eˣ + C · CORRECTA
- B) x·eˣ + eˣ + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) eˣ + C · [omite-uv]
- D) x²·eˣ/2 + C · [producto-factor-a-factor]

solución: con u = x, du = dx y v = eˣ: x·eˣ − ∫eˣ dx = x·eˣ − eˣ + C
```

**Habilidades (`kc:`).** Una habilidad concreta que se puede verificar con una pregunta: `kc: clave · descripción`. Cada tema tiene al menos una. Los prerrequisitos van al final, separados por comas: `clave` si son de la misma materia, `carpeta/clave` si son de otra. No puede haber ciclos.

**Errores (`mc:`, misconcepciones).** Un error de razonamiento que se repite entre preguntas: `mc: clave · habilidad · texto`. La habilidad es de la misma materia, aunque esté en otro tema.

**Preguntas.** El encabezado es `### <id> · dificultad <1-3> ·` seguido de estos datos, en cualquier orden:

| Dato | Cuándo |
|---|---|
| `kc: a, b` | Siempre. Las habilidades que mide la pregunta |
| `borrador`, `revisada` o `retirada` | Siempre |
| `origen: humano` u `origen: ia (<modelo>)` | Siempre |
| `revisó: <nombre>` | Obligatorio en las `revisada` |
| `⚠ revisar` | Lo pone la verificación cruzada del proceso con IA (HU-061) |

- El id (`P4`) es único dentro de la materia y nunca se reutiliza, ni siquiera cuando la pregunta se retira. Para sacar una pregunta de uso se marca `retirada`; no se borra.
- `borrador`: nadie que sepa la materia la ha revisado. `revisada`: la aprobó alguien que sabe la materia, y solo estas llegan a producción. Revisar es leer la pregunta, confirmar la respuesta y los errores, y cambiar `borrador` por `revisada · revisó: <tu nombre>`. La IA nunca marca `revisada`.
- Las opciones son cuatro, A a D, en orden. Exactamente una lleva `CORRECTA`. Cada incorrecta lleva `[clave]` con la misconcepción que delata. Después puede ir un texto de error propio, más específico que el de la misconcepción; si no lo lleva, se usa el de la misconcepción.
- `solución:` va después de las opciones y puede ocupar varias líneas. El estudiante no la ve: sirve al revisor y al monitor. Es obligatoria para pasar a `revisada` una pregunta de origen IA.

## Cómo se redactan los errores

Una opción incorrecta cualquiera no sirve. Si en una pregunta de conteo la respuesta es 120 y las otras son 118, 122 y 150, el estudiante que falla no aprende nada y nosotros tampoco. Si las otras son 720, 1000 y 30, cada una delata un error distinto: usó permutación, contó con repetición o multiplicó en vez de contar subconjuntos. Con eso Calibra puede decir "no distingues permutación de combinación" en vez de "sacaste 3 de 4".

- El error va en segunda persona y describe qué pensó el estudiante, no qué le faltó. "Usas permutación y cuentas como si el orden importara" funciona. "No sabe combinatoria" no sirve, porque no se puede convertir en un plan de sesión.
- Va en minúscula y sin punto final, porque en pantalla aparece después de "Error detectado: ".
- El separador es un punto medio con un espacio a cada lado (` · `). Pegado es multiplicación: `x·ln(x)` se escribe tal cual. Una opción se parte en el último ` · ` de la línea, así que el texto de la opción sí puede contener ` · `.

## Matemáticas y código

- Las fórmulas que necesitan estructura (fracciones apiladas, integrales con límites, límites, sumatorias, raíces anidadas) van entre `$…$` con un pedazo pequeño de TeX: `$\int_0^{\pi/2} \sen^2 x \cos x\,dx$`. Lo demás se queda en Unicode: `x²`, `q₁`, `≤`, `π`.
- Comandos permitidos, y ningún otro (la lista vive en `scripts/contenido/matematica.mts`):
  - estructura: `\frac \sqrt \int \iint \oint \sum \prod \lim \left \right \text \vec \bar \hat \mathrm`
  - funciones: `\sen \sin \cos \tan \sec \csc \cot \ln \log \exp` (`\sen` es el seno en español)
  - griegas: `\alpha \beta \gamma \delta \epsilon \varepsilon \theta \lambda \mu \nu \pi \rho \sigma \tau \phi \varphi \omega \Delta \Sigma \Omega \Gamma \Phi`
  - símbolos: `\le \leq \ge \geq \ne \neq \approx \pm \mp \to \rightarrow \infty \cdot \times \div \partial \nabla`
  - espacios: `\, \; \quad`
- Una letra que no está en la lista (`\chi`, `\eta`, `\psi`...) se escribe en Unicode dentro de `$…$`: `$χ^2$`. Un signo de pesos de verdad es `\$`.
- Un programa en el enunciado va en un bloque cercado con ```` ``` ````, sin lenguaje, con la sangría real. Dentro del bloque todo es literal. Comprueba la respuesta ejecutando el programa.

## Cobertura: cuándo una evaluación se activa

Una evaluación solo se usa en el diagnóstico si está activa. Queda activa cuando cada habilidad de sus temas tiene al menos 3 preguntas `revisada` en al menos 2 dificultades distintas (decisión D-13 en `REVISION_REGLAS.md`).

Además, el reporte mide si cada misconcepción sale como trampa en al menos 2 preguntas revisadas, porque confirmarla exige que el estudiante la elija dos veces. Esa meta se reporta pero no decide la activación.

## Comandos

```bash
npm run contenido:validar                 # revisa todo, sin tocar ninguna base
npm run contenido:validar -- --borradores # cuenta también los borradores
npm run contenido:cargar                  # valida y carga en la base local
npm run contenido:cargar -- --borradores  # carga también los borradores
```

- La validación señala cada error con archivo y línea, y no carga nada si hay errores. Imprime los avisos, las filas que se cargarían, la cobertura y qué evaluaciones quedan activas. El CI la corre en cada PR.
- La carga solo acepta la base local. Se puede correr las veces que quieras: cada fila se reconoce por su clave dentro de la materia, y la materia por su carpeta, así que nada se duplica. Sin `--borradores` solo carga las revisadas. Una pregunta que desaparece del banco queda `retirada` en la base. Un tema, una habilidad, una misconcepción o una evaluación que desaparecen no se borran: la carga lo avisa y termina con error porque la base queda con más filas que el banco. Hay que borrarlos a mano en la base local. Una evaluación que ya no está en el banco queda inactiva.
- Lo que un admin corrigió en la app (`/admin/materias`) se conserva: el nombre y el código de una materia, y el nombre y la semana de una evaluación. La carga no los vuelve a poner y deja una línea de aviso por fila, con los dos valores: `materia-a: la base conserva lo que un admin cambió en la app (nombre: base "X", materia.md "Y"). Para que vuelva a seguir al banco, iguala materia.md con la base.` Cuando `materia.md` ya dice lo mismo que la base, la carga baja la marca y esa fila vuelve a seguir al banco. Todo lo demás sigue saliendo del banco: temas, habilidades, preguntas, qué evaluaciones están activas, si son acumulativas y los temas de cada una. La marca es por fila: si un admin corrige solo el nombre de una materia, un PR que cambie su código tampoco se aplica hasta que `materia.md` iguale la base.
- Cambiar la semana de una evaluación en la app no mueve los temas de una acumulativa, porque las acumulativas se expanden con las semanas de `materia.md`. Para mover temas se cambia `materia.md` en un PR.
- La carga reconoce la materia por su carpeta (`materia.carpeta`) y no por el código. Una materia que un admin creó en la app con el código de una carpeta se adopta en la primera carga: queda con esa carpeta y recibe sus temas, sin duplicarse. Si el código de `materia.md` ya lo tiene otra materia, la carga falla entera con un mensaje que nombra las dos y no cambia nada.
- Renombrar una carpeta de `contenido/` necesita un paso a mano. La fila conserva la carpeta vieja y la carga falla nombrando las dos materias, así que antes de cargar se corrige en la base local: `update public.materia set carpeta = '<nueva>' where carpeta = '<vieja>'`.
- Una materia o una evaluación borrada desde la app que siga en `contenido/` vuelve con la siguiente carga, sin aviso: la carga no distingue una que nunca existió de una que se borró. Para quitarla del banco se saca su carpeta o su entrada de `materia.md` en un PR. Una evaluación que sale del banco queda inactiva y conserva sus temas, así que la app no deja borrarla. La app solo borra lo que no tiene nada ligado, y una materia con temas cargados nunca se borra desde ahí.
- Una edición hecha directo en la base, sin pasar por la app (SQL Editor, `psql` o la llave secreta), no se marca y la siguiente carga la pisa.

## De dónde viene este contenido

Las 8 materias se migraron del prototipo (`dvarela5101/Calibra`, `contenido/*.md`, commit `87f71ed`) con `scripts/contenido/migrar-prototipo.mts`. La migración comprobó contra el convertidor del propio prototipo que ningún enunciado, opción o error cambió. Las materias que no tenían habilidades recibieron una habilidad provisional por tema, y cada texto de error distinto de ese tema quedó como su misconcepción. El reprocesamiento con IA ([HU-061](../backlog/HU-061.md)) las reemplaza por habilidades reales.

Los textos libres de cada `materia.md` y de cada tema se copiaron tal cual y algunos ya no son ciertos: hablan de `convertir.js` o dicen que faltan preguntas. La migración no se vuelve a correr: desde aquí el banco se edita a mano en PRs.
