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
- Cuando un cliente escribe, el mensaje entra a la **bandeja de entrada**. El cajero revisa el
  mensaje y con **"Crear pedido"** genera un pedido de delivery (con nombre y teléfono del cliente
  ya cargados), agrega los ítems del catálogo y al enviar a cocina **se imprime la comanda**.
- **Auto-respuesta inteligente:** el sistema detecta si el mensaje es un **pedido** (por palabras
  clave: *pedido, encargar, quiero, delivery…*) o una **consulta**, y responde distinto en cada
  caso. **No repite** la respuesta a un mismo número dentro de un lapso configurable (evita
  contestar varios mensajes seguidos); única excepción: si venía consultando y luego hace un
  pedido, se le confirma una vez. Todo editable en **`/ajustes`** (palabras clave, los dos
  mensajes y los minutos del lapso).
- Nota: el método no oficial puede implicar bloqueo del número si WhatsApp lo detecta; por eso se
  recomienda un número exclusivo. Para cumplir 100% los términos se puede migrar a la API oficial
  de WhatsApp Cloud (la lógica de bandeja/pedido/impresión queda igual).

## Impresión térmica de comandas
- Al enviar a cocina se imprime **una sola comanda** con todo el pedido (no una por sector).
- La comanda destaca en **grande/negrita**: **DELIVERY** o **MESA N**, la **cantidad + nombre del
  plato**, la **hora de entrega** y el **TOTAL**. Incluye cliente, dirección y teléfono (delivery).
- Impresión por **ESC/POS** (estándar de las térmicas de tickets), enviada en crudo a la impresora
  vía `rawprint.ps1` (winspool). En `/ajustes` se elige la **impresora de comandas**, el **tipo**
  (térmica ESC/POS o impresora común de texto) y se prueba con un ticket de ejemplo.
- Si no hay impresora configurada, la comanda se guarda en `backend/comandas_impresas/` (respaldo y
  para operar sin hardware). Botón 🖨 en el KDS para reimprimir.
- La **hora de entrega** se carga en Delivery y en los pedidos de WhatsApp antes de mandar a cocina.

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

## Actualizar el sistema (GitHub)
El código vive en un repositorio **privado** de GitHub. Flujo de trabajo:

- **En el portátil (desarrollo):** se hacen los cambios y se suben con doble clic en
  **`SUBIR-CAMBIOS.bat`** (hace `git add` + `commit` + `push`).
- **En la PC del restaurante:** doble clic en **`ACTUALIZAR.bat`** para bajar los últimos
  cambios (`git pull`), reinstalar dependencias y recompilar el frontend. Al terminar,
  ejecutar `INICIAR.bat` para arrancar el sistema actualizado.

Lo que **no** viaja por GitHub (ver `.gitignore`): `node_modules/` (se reinstala solo),
`frontend/dist/` (se recompila), el instalador `SQLEXPR_x64_ESN/`, la base de datos local
`backend/data/*.db`, las comandas impresas y las **credenciales de WhatsApp** (`backend/auth_wa/`).
Por eso cada PC mantiene su propia base de datos y su propia vinculación de WhatsApp.

### Primera instalación en la PC del restaurante
Guía paso a paso completa (para alguien no técnico): **`INSTALACION-RESTAURANTE.md`**.
Resumen: con **Node.js 24** y **Git** instalados, una sola vez:
```
git clone https://github.com/Comanda-Sede-Argentino/restaurante-app.git
cd restaurante-app
INSTALAR.bat     (instala dependencias, SIEMBRA la base y compila) -- solo la 1ra vez
INICIAR.bat      (arranca el sistema)
```
Diferencia clave: **`INSTALAR.bat`** siembra la base (primera vez); **`ACTUALIZAR.bat`** baja
cambios sin tocar los datos (uso diario tras cada mejora subida desde el portátil).
