# Guía de instalación en la PC del restaurante

Sistema **Argentino Sede Social**. Esta guía es para **instalar el sistema por primera vez**
en la computadora del restaurante. Hacerla una sola vez. Para actualizaciones posteriores,
ver el final (sección **8**).

> Resumen rápido (para quien ya sabe): instalar Node.js 24 + Git → iniciar sesión en GitHub →
> `git clone` del repo privado → doble clic en `INSTALAR.bat` → doble clic en `INICIAR.bat`.

---

## 1. Instalar los programas necesarios (una vez)

El sistema necesita **dos programas base**: **Node.js** (motor que corre la app) y **Git**
(para descargar y actualizar el código).

### Opción A — con winget (rápida, recomendada)
Abrir **PowerShell** (botón Inicio → escribir "PowerShell" → Enter) y pegar:

```powershell
winget install OpenJS.NodeJS --version 24.16.0 --accept-source-agreements --accept-package-agreements
winget install Git.Git --accept-source-agreements --accept-package-agreements
```

> Si no anda esa versión exacta, usar `winget install OpenJS.NodeJS.LTS` (Node 24 LTS).

### Opción B — instaladores manuales
- Node.js: https://nodejs.org → descargar **LTS** (24.x) → instalar (Siguiente, Siguiente, Finalizar).
- Git: https://git-scm.com/download/win → instalar con todas las opciones por defecto.

### Verificar que quedaron instalados
**Cerrar y volver a abrir** PowerShell (importante, para que tome los programas nuevos) y correr:

```powershell
node --version
git --version
```

Ambos deben mostrar un número de versión. Si uno dice "no se reconoce", reinstalarlo (Opción B).

---

## 2. Iniciar sesión en GitHub (una vez)

El código está en un repositorio **privado** (`Comanda-Sede-Argentino/restaurante-app`), así que la PC
necesita autorización para descargarlo. La primera vez que descargues, Git abrirá el navegador
para iniciar sesión:

1. En el **paso 3** (al hacer `git clone`) se abrirá una ventana / el navegador.
2. Iniciar sesión en GitHub con la cuenta **`mreggiori2026`**.
3. Dar **Authorize / Autorizar**.

La sesión queda **guardada en esta PC** (no hay que volver a ingresarla en cada actualización).

---

## 3. Descargar el sistema

Elegir una carpeta donde vivirá el sistema (ej. el Escritorio). En PowerShell:

```powershell
cd $HOME\Desktop
git clone https://github.com/Comanda-Sede-Argentino/restaurante-app.git
```

(Acá se abre el login de GitHub del paso 2 si es la primera vez.)

Esto crea la carpeta **`restaurante-app`** en el Escritorio con todo el código.

---

## 4. Instalar (primera vez)

Entrar a la carpeta `restaurante-app` y hacer **doble clic en `INSTALAR.bat`**.

Ese script, automáticamente:
1. Instala las dependencias del backend.
2. **Carga los datos iniciales** (platos con precios reales, mesas, usuarios).
3. Instala las dependencias del frontend.
4. Compila la interfaz.

Puede tardar varios minutos (descarga librerías de internet). Cuando diga
**"INSTALACION COMPLETA"**, cerrar la ventana.

> ⚠️ Esto requiere **conexión a internet** (la primera vez baja las librerías).

---

## 5. Arrancar el sistema

**Doble clic en `INICIAR.bat`**. Se abre una ventana negra (no cerrarla mientras se usa el
sistema; es el servidor) y el navegador en **http://localhost:3001**.

- Para que arranque solo al prender la PC: ver sección **9**.

---

## 6. Usar desde tablets, celulares y otras PC (red local)

Las tablets/celulares se conectan a la **misma red WiFi** que esta PC y abren la dirección
con la **IP de esta computadora**.

### 6.1 Averiguar la IP de esta PC
En PowerShell:
```powershell
ipconfig
```
Buscar **"Dirección IPv4"** (algo como `192.168.0.105`). Esa es la IP.

### 6.2 Abrir el puerto en el Firewall (una vez)
Abrir PowerShell **como administrador** (clic derecho → "Ejecutar como administrador") y correr:
```powershell
netsh advfirewall firewall add rule name="Sistema Restaurante 3001" dir=in action=allow protocol=TCP localport=3001
```

### 6.3 Conectarse desde los dispositivos
En la tablet/celular, abrir el navegador y entrar a:
```
http://IP-DE-ESTA-PC:3001
```
Ejemplo: `http://192.168.0.105:3001`

> Conviene que esta PC tenga **IP fija** en el router para que no cambie. Si cambia, hay que
> volver a usar la IP nueva.

---

## 7. Configuración inicial dentro del sistema

### 7.1 Usuarios y PIN
| Rol | PIN |
|---|---|
| Administrador | 0000 |
| Mozo 1 | 1111 |
| Mozo 2 | 2222 |
| Cajero | 3333 |
| Cocina | 4444 |

(Se pueden cambiar/crear más desde el panel de administración.)

### 7.2 Impresoras térmicas de comandas
1. Conectar e instalar las impresoras térmicas en Windows (que aparezcan en
   *Configuración → Impresoras*).
2. En el sistema, ir a **/ajustes** (o el menú Ajustes).
3. Asignar una impresora a cada sector (Cocina / Parrilla / Barra / Postres) y usar
   **"Probar"** para confirmar.

> Si un sector no tiene impresora asignada, la comanda se guarda como archivo de texto en
> `backend/comandas_impresas/` (respaldo). Igual se puede operar sin impresora.

### 7.3 Vincular WhatsApp (opcional, para pedidos por WhatsApp)
1. Conseguir un **número dedicado** para los pedidos (un celular o un número aparte).
2. En el sistema, ir a **/whatsapp**.
3. Aparece un **código QR**: escanearlo desde *WhatsApp del celular → Dispositivos vinculados →
   Vincular un dispositivo*.
4. Cuando diga **conectado**, los mensajes entrantes caen en la bandeja para crear pedidos.

> La vinculación queda guardada en esta PC (`backend/auth_wa/`) y **no se sube a GitHub**.

---

## 8. Actualizar el sistema (cuando haya cambios nuevos)

Cuando desde el portátil se suban mejoras a GitHub, acá se baja todo con **un doble clic**:

1. **Doble clic en `ACTUALIZAR.bat`** → descarga los cambios, actualiza librerías y recompila.
2. Cuando termine, **doble clic en `INICIAR.bat`**.

> `ACTUALIZAR.bat` **no toca los datos** (pedidos, ventas, platos editados): la base de datos
> es local de esta PC y no se sobrescribe.

---

## 9. (Opcional) Que arranque solo al prender la PC

Para que el sistema se inicie automáticamente con Windows:

1. Apretar **Windows + R**, escribir `shell:startup` y Enter (se abre la carpeta de Inicio).
2. Hacer **clic derecho sobre `INICIAR.bat` → Copiar**, y **pegar un acceso directo** en esa
   carpeta (clic derecho → "Pegar acceso directo").

Así, cada vez que se prenda la PC, el sistema arranca solo.

---

## 10. Problemas comunes

| Síntoma | Solución |
|---|---|
| `node` o `git` "no se reconoce" | Falta instalarlos (sección 1) o **reabrir** PowerShell tras instalar. |
| `INSTALAR.bat` falla en el paso 1 o 3 | Sin internet, o falta Node/Git. Revisar conexión y sección 1. |
| Error de compilación de `better-sqlite3` | Usar la **misma versión de Node que el portátil (24.x)**. Si persiste, instalar *VC++ Redistributable x64* y reintentar. |
| Las tablets no abren el sistema | Verificar **misma WiFi**, la **IP correcta** (6.1) y el **firewall abierto** (6.2). |
| No imprime comandas | Revisar que la impresora esté instalada en Windows y asignada en **/ajustes** (7.2). |
| WhatsApp se desconecta | Volver a **/whatsapp** y reescanear el QR (7.3). |
| Quiero empezar la base desde cero | Borrar `backend/data/restaurante.db*` y correr `INSTALAR.bat` de nuevo (vuelve a sembrar). ⚠️ Borra pedidos y ventas. |

---

**Contacto / soporte:** ante cualquier error, sacarle una **foto a la pantalla** completa
(con el mensaje de error visible) y enviarla a quien administra el sistema.
