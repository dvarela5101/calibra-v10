# Backlog de HUs

Sistema simple para guardar historias de usuario y que Claude las tome de aqui. Todo son archivos markdown dentro del repo, asi que queda versionado con Git y no depende de ninguna herramienta externa. Solo necesitas Python 3.8+.

## Estructura

```
CLAUDE.md              Instrucciones que Claude lee al iniciar sesion en el repo
BACKLOG.md             Tablero/indice generado automaticamente
backlog/
  _plantilla.md        Plantilla de una HU
  HU-001.md ...        Una HU por archivo
scripts/backlog.py     CLI para crear, listar y mover HUs
```

## Flujo de trabajo

1. **Crear**: `python scripts/backlog.py new "Login con Google" -p P1 -e M`
2. **Refinar**: abre `backlog/HU-001.md` y completa historia, contexto y criterios de aceptacion.
3. **Liberar**: `python scripts/backlog.py ready HU-001` (pasa a `Lista`; solo estas puede tomar Claude).
4. **Ejecutar**: al iniciar sesion de Claude en el repo, dile:
   - "Toma la siguiente HU" → Claude corre `take`, elige por prioridad y dependencias.
   - o "Trabaja HU-001" → Claude la lee y la inicia.
5. **Revisar**: Claude la deja en `En revision` con un resumen. Tu la apruebas con `python scripts/backlog.py done HU-001`.

## Comandos

| Comando | Que hace |
|---|---|
| `new "titulo" [-p P0-P3] [-e XS-XL] [-d HU-001,HU-002]` | Crea una HU en `Backlog` |
| `list [-s estado] [--all]` | Lista HUs (oculta las `Hecha` salvo `--all`) |
| `show HU-001` | Muestra la HU completa |
| `next` | Muestra la siguiente HU elegible sin iniciarla |
| `take` | Toma la siguiente elegible y la pasa a `En progreso` |
| `ready / start / review / done / block HU-001 [-m msg]` | Cambia el estado y deja registro |
| `log HU-001 "mensaje"` | Agrega una linea al registro de la HU |
| `edit HU-001 [-t titulo] [-p P1] [-e L] [-d HU-002,HU-003]` | Cambia titulo, prioridad, talla o dependencias y deja registro |
| `index` | Regenera `BACKLOG.md` |

## Regla de "siguiente"

Elegible = estado `Lista` y todas sus dependencias en `Hecha`. Se ordena por prioridad (P0 primero) y luego por numero de HU.

## Como usarlo

Copia esta carpeta a la raiz del repo donde trabaja Claude (o usala como repo aparte). Si la persona que inicia la sesion es otra, basta con que tenga el repo: el `CLAUDE.md` ya explica a Claude el proceso completo.
