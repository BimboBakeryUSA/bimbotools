# Sincronización con listado ZSL Diego Guzmán — 2026-11-01

Fuente: `tiendas-zsl-diego-guzman.xlsx` (1598 filas, 1597 tiendas únicas).
Estructura: DOS Rebecca Crocker → ZSL Diego Guzmán → 5 MSL → 59 rutas (IBP).

| MSL | Rutas |
|---|---|
| Armando Leonides | 14 |
| Douglas Morales Reyes | 13 |
| Open Guzman | 11 |
| Ricardo Doig | 11 |
| Agnello Anthony | 10 |

## Resultado en Supabase

| | Antes | Después |
|---|---|---|
| Rutas (ibps) | 22 | 59 |
| Tiendas visibles | 701 | 1597 |
| Tiendas apagadas (ocultas, no borradas) | 0 | 108 |
| Tiendas activas con días de visita (visibles) | 154 | 130 (+24 apagadas que conservan su plan) |

- **Plan de visitas**: 0 tiendas cambiaron estatus/frecuencia/días (verificado contra el respaldo). Única excepción intencional: `0813323`.
- **Nuevas (1004)**: pendientes de revisar, sin día de visita.
- **Respaldo**: `respaldo.tiendas_20261101`, `respaldo.ibps_20261101`, `respaldo.tiendas_historial_20261101`, archivo en `respaldo.archivo_zsl_20261101`.

## Decisiones

1. **Carmen Camargo ya no aparece como MSL.** Sus 11 rutas pasaron a Open Guzman (0495, 2132, 5528, 5529, 5536, 5540, 5542) y Douglas Morales Reyes (2145, 2906, 3782, 4396).
2. **Rutas de Douglas que cambian de MSL:** 0150 y 4339 → Armando Leonides; 2192 → Agnello Anthony.
3. **5527:** propietario actualizado de "Distribution Cal" a "Pr Distribution".
4. **24 tiendas cambian de ruta** (17 de 3778→5537, 3 de 5529→2132, 3 de 0150→4339, 1 de 4339→0150). Ninguna tenía días asignados.
5. **0813323 Kings Market & Check Cashed:** en 4339 estaba inactiva con motivo "no es de mi ruta"; el archivo la pone en 0150 → se movió y quedó pendiente para que 0150 la revise.
6. **0359593 7 Eleven 36748** viene repetida en 0150 y 4339 → se quedó en **0150**, donde ya tenía plan (activa, semanal, jueves).
7. **Ventas**: el archivo trae semanas 11–22/2026 (más viejas que las 24–37 que ya hay). **No se cargaron.** Las tiendas nuevas se ven sin ventas hasta subir el reporte semanal actual.
8. Lat/Lng, Tier y Store Type del archivo no tienen columna todavía; no se cargaron.

## Tiendas apagadas que tenían plan (27)

Siguen en la base con sus días; si alguna sí debe seguir, se reactiva con un `update`.

| Tienda | Ruta | Nombre | Estatus | Días | Frecuencia / motivo |
|---|---|---|---|---|---|
| 0016787 | 0150 | Walmart 2564 Sc | activa | martes | semanal |
| 0016797 | 0150 | Walmart 2807 Sc | activa | lunes | semanal |
| 0017094 | 0150 | Walmart 1726 Sc | activa | jueves, lunes | 2x_semana |
| 0031559 | 0150 | Kroger 0310 Kr029 | activa | lunes | semanal |
| 0309183 | 0150 | Abis Grocery | activa | martes | pedido |
| 0352444 | 0150 | Walmart 7177 Nm | activa | lunes | semanal |
| 0353821 | 0150 | Walmart 6952 Sc | activa | lunes | semanal |
| 0813324 | 0150 | Hernandez Deli | activa | jueves | pedido |
| 0813325 | 0150 | Paleteria La Mexicana | activa | jueves | pedido |
| 0813336 | 0150 | Panaderia La Flor De Mexico | activa | martes | pedido |
| 0813357 | 0150 | El Paisano Panaderia | activa | miercoles | pedido |
| 1040163 | 0523 | 7 Eleven 17219 | inactiva | — | Nunca compro |
| 0016432 | 4339 | Walmart 1344 Sc | activa | jueves, lunes | 2x_semana |
| 0017128 | 4339 | Walmart 5117 Sc | activa | lunes, sabado | 2x_semana |
| 0031007 | 4339 | Kroger 0228 Kr029 | activa | martes | quincenal |
| 0031489 | 4339 | Kroger 0343 Kr029 | activa | lunes | quincenal |
| 0147873 | 4339 | El Aba Productos Y Restaurant | inactiva | — | Pertenece a la ruta 0150 |
| 0175971 | 4339 | Moreliana Ice Cream | inactiva | — | Cancelacion de servicio |
| 0343468 | 4339 | Paleteria La Flor Michoacana | activa | jueves | pedido |
| 0353820 | 4339 | Walmart 4388 Nm | activa | jueves, lunes | 2x_semana |
| 0359600 | 4339 | 7 Eleven 36891 | activa | lunes | semanal |
| 1053764 | 4339 | Wawa 6628 | activa | jueves, martes | 2x_semana |
| 0010118 | 5528 | Cvs Elmnt 001516 | activa | lunes | pedido |
| 0292116 | 5528 | Family Dollar 10198 | activa | martes | semanal |
| 1045294 | 5528 | Don Pepe | activa | martes | pedido |
| 1052248 | 5528 | Family Dollar 05577 | activa | martes | semanal |
| 1052255 | 5528 | Family Dollar 08973 | activa | martes | semanal |

Las otras 81 apagadas nunca se habían revisado.

## Pendiente conocido

- El botón "Actualizar catálogo" de `admin.html` hace `upsert` sobre `tiendas`. Si un reporte futuro trae una tienda apagada, Postgres rechaza el upsert por RLS (la fila existe pero no es visible). Solución: una función RPC de sincronización que reactive (`vigente=true`) lo que venga en el reporte.
- El historial del admin no tiene etiqueta para los campos nuevos `ibp_id` y `vigente` (se ven en blanco).
