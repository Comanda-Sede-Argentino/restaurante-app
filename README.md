# Sistema de Administración de Restaurante — Argentino Sede Social

Sistema **web local-first** que reemplaza al POS legado MRC (`C:\sistemas`). Incluye toma de
pedidos (mozo + delivery), comandas en cocina (KDS) con **impresión térmica**, catálogo de platos,
caja y monitoreo en tiempo real. Sembrado con el **catálogo y precios reales** migrados del sistema
anterior: 494 platos (230 activos) con sus **precios exactos** extraídos de la base SQL Server
`mrccentral` (tabla `ARTICULO`).

## Stack
- **Backend:** Node.js + Express + Socket.IO (tiempo real) + SQLite (`better-sqlite3`).
- **Frontend:** React + Vite (PWA), un solo build para todas las pantallas.
- **Base de datos:** `backend/data/restaurante.db` (archivo único, sin servidor externo).

## Uso diario
1. Doble clic en **`INICIAR.bat`** (o `cd backend && npm start`).
2. Abrir **http://localhost:3001** en esta PC.
3. Desde tablets/celulares/otras PC de la red local: `http://IP-DE-ESTA-PC:3001`
   (ver la IP con `ipconfig`; abrir el puerto 3001 en el Firewall de Windows si hace falta).

## Pantallas
| Ruta | Para qué |
|---|---|
| `/salon` | Plano de mesas, estados en vivo (verde libre / naranja ocupada). |
| `/mozo` | El mozo elige mesa y carga la comanda con búsqueda por categoría. |
| `/delivery` | Pedidos a domicilio con datos del cliente (nombre, teléfono, dirección). |
| `/whatsapp` | Conexión a WhatsApp (QR) + bandeja de pedidos entrantes → convertir a pedido. |
| `/kds` | **Pantalla de cocina**: comandas en tiempo real por sector (Cocina/Parrilla/Barra/Postres) con cronómetro y reimpresión. |
| `/caja` | Cobro de mesas/pedidos, medios de pago y vuelto. |
| `/dashboard` | **Monitoreo en vivo**: ventas, ticket promedio, mesas, carga de cocina, ranking. |
| `/admin` | ABM de platos: nombre, categoría, sector de cocina, precio, alta/baja. |
| `/ajustes` | **Impresión de comandas**: asignar impresora térmica por sector y probarla. |

## Pedidos por WhatsApp (`/whatsapp`)
- El sistema se conecta a WhatsApp (no oficial, vía **Baileys**) escaneando un **QR** desde
  **WhatsApp → Dispositivos vinculados**. Usá un **número dedicado a pedidos** (no el personal).
  Corre 100% local; la sesión queda guardada (se escanea una sola vez).
- Cuando un cliente escribe, el mensaje entra a la **bandeja de entrada** y se le envía una
  auto-respuesta de recepción. El cajero revisa el mensaje y con **"Crear pedido"** genera un
  pedido de delivery (con nombre y teléfono del cliente ya cargados), agrega los ítems del catálogo
  y al enviar a cocina **se imprime la comanda** automáticamente.
- Nota: el método no oficial puede implicar bloqueo del número si WhatsApp lo detecta; por eso se
  recomienda un número exclusivo. Para cumplir 100% los términos se puede migrar a la API oficial
  de WhatsApp Cloud (la lógica de bandeja/pedido/impresión queda igual).

## Impresión térmica de comandas
- Al enviar a cocina, se imprime automáticamente una comanda por cada sector involucrado.
- En `/ajustes` se asigna la impresora (de las instaladas en Windows) a cada sector y se prueba.
- Si un sector no tiene impresora asignada, la comanda se guarda en `backend/comandas_impresas/`
  (sirve de respaldo y para operar sin hardware). Botón 🖨 en el KDS para reimprimir.

## Datos migrados (Fase 0 completada)
Se instaló SQL Server Express **LocalDB**, se adjuntó una **copia** de `mrccentral.MDF`
(el original en `C:\sistemas` NO se modificó) y se migró la tabla `ARTICULO` con sus precios
exactos. Artefactos: `../articulo_precios_reales.csv`. La base de SQL quedó en
`C:\sqlsetup\mdf\` por si se necesita re-extraer histórico de ventas (`HISTFACT`/`EMITIDOS`).

## Usuarios sembrados (PIN)
Administrador 0000 · Mozo 1 1111 · Mozo 2 2222 · Cajero 3333 · Cocina 4444

## Puesta a punto inicial
- Los **precios** del seed son estimados (el detalle exacto está en binario en el MDF del sistema
  viejo). Ajustarlos en `/admin`, o completar la **migración exacta (Fase 0)**: instalar SQL Server
  Express, adjuntar `C:\sistemas\mrccentral\mrccentral.MDF` (login `sa` / clave `12345`) y exportar
  la tabla `ARTICULO` con precios reales. Ver `../PLAN_SISTEMA_RESTAURANTE.md`.

## Desarrollo
```
cd backend  && npm install && npm run seed && npm start      # API + sirve el frontend en :3001
cd frontend && npm install && npm run dev                    # hot-reload en :5173 (proxy a :3001)
cd frontend && npm run build                                 # recompila el frontend que sirve el backend
```

## Re-sembrar la base desde cero
Borrar `backend/data/restaurante.db*` y correr `npm run seed` en `backend`.
