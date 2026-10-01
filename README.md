# Tul en Foco

Catálogo y gestión de vestidos de quinceañera para sesiones fotográficas supervisadas de Tul en Foco.

## Tecnología y privacidad

- Frontend en React con Vite.
- API en Express y base de datos SQLite persistente en `data/dressmanager.sqlite`.
- Inicio de sesión con contraseña cifrada y cookie de sesión HttpOnly almacenada en SQLite.
- La portada (`/`) siempre abre la vista pública. La gestión está en `/admin` y requiere iniciar sesión.
- El catálogo público recibe solo nombre, color, descripción, tallas, fotos y tarifas. El coste de compra y las finanzas se sirven únicamente desde endpoints autenticados.
- Las solicitudes de sesión y las sesiones realizadas se guardan en SQLite. El estudio o fotógrafo se guarda como cliente. Las fotos nuevas se guardan en `public/uploads/`.
- Cada vestido puede tener tarifas diferentes para sesiones en interior y exterior. La web pública solo muestra precio, tallas y datos de catálogo; la inversión y las finanzas requieren acceso privado.
- El inventario clasifica los vestidos como Premium, Estándar, Económico u Otra. Las tarifas y fondos se configuran por vestido; una pieza con importes pendientes queda fuera del catálogo público y no se puede registrar para una sesión.

## Ejecutar en local

Necesitas Node.js 22 o posterior.

```powershell
npm install
npm run dev
```

Abre `http://localhost:5173`. En el primer arranque, el servidor crea la base de datos con Aurora Rosé y el usuario administrador indicado en `.env`.

Las variables necesarias son `SESSION_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Puedes partir de `.env.example`; la contraseña debe tener al menos 12 caracteres. El archivo `.env` no se guarda en Git.

La lectura automática de tablas de tallas funciona **completamente en local** con Tesseract.js y el modelo inglés incluido como dependencia del proyecto. No requiere API key, cuenta externa ni pago por uso. La imagen no sale del equipo: al pulsar **Leer tabla de la imagen**, el servidor local ejecuta OCR y propone las filas detectadas para que se revisen antes de guardarlas.

Para cambiar la contraseña después de crear la base de datos, actualiza `ADMIN_PASSWORD` en `.env` y ejecuta `npm run reset-admin`.

## Datos y fotos

- Base de datos: `data/dressmanager.sqlite` (se crea automáticamente y está excluida de Git).
- Fotos iniciales: `public/images/vestidos/aurora-rose/`.
- Fotos de vestidos añadidos desde el administrador: `public/uploads/`.
- En el formulario de vestido se pueden subir hasta ocho fotos JPG, PNG o WebP por operación, de 8 MB como máximo cada una. Las fotos existentes se pueden ordenar, quitar o elegir como portada.
- Desde Finanzas se descargan CSV de reservas y finanzas, además de un ZIP con la base de datos y las fotos subidas. Para restaurarlo, detén la aplicación, guarda aparte los datos actuales, retira los archivos antiguos `data/dressmanager.sqlite`, `data/dressmanager.sqlite-wal` y `data/dressmanager.sqlite-shm` si existen, extrae el ZIP en la raíz del proyecto y vuelve a iniciarla. Conserva `.env` por separado; las fotos iniciales de `public/images/` se recuperan desde el repositorio.
- Las sesiones anteriores al seguimiento de cobros aparecen **Por verificar**. Revísalas en Reservas y marca cada una como cobrada o pendiente de cobro según corresponda; no se incluyen en los ingresos hasta confirmar el pago.
- En Reservas puedes eliminar un registro de prueba mediante **Eliminar** y confirmar la acción. Se retira de la agenda, los perfiles de estudio y los cálculos financieros. Descarga antes un **Backup ZIP** desde Finanzas si quieres conservar una copia.

## Reglas económicas iniciales

- Aurora Rosé: coste de compra 595 €.
- Sesión en interior: 230 € IVA incluido hasta 30 minutos; 25 € por cada bloque adicional de 30 minutos; sin ayudante; 15 € de mantenimiento.
- Sesión en exterior: 350 € IVA incluido hasta 2 horas; 25 € por cada hora adicional; ayudante a 20 €/hora; 30 € de mantenimiento.
- El beneficio restante después de IVA, ayudante (si corresponde) y mantenimiento se divide a partes iguales.
- El importe de mantenimiento de cada sesión es un **fondo reservado** antes del reparto. El gasto real de lavandería o reparación se registra aparte en Editar sesión y reduce el saldo del fondo, sin cambiar la mitad de beneficio de cada socio.
- El vestido permanece bajo supervisión del equipo fotográfico durante toda la sesión.

## Despliegue local con Runara

Desde la raíz del proyecto, ejecuta `make deploy`. El comando compila React y publica la aplicación completa en `C:\www\tul-en-foco`; Runara la mantiene activa en `http://127.0.0.1:3101/` y la administración queda en `/admin`. El `Makefile` acepta `PORT` y `DEPLOY_DIR` si necesitas cambiar esos valores, por ejemplo `make deploy PORT=3102`.

La primera publicación copia de forma segura la base de datos SQLite, las fotos subidas y `.env` del proyecto. Las publicaciones posteriores conservan esos datos y los secretos de producción. El `.env` publicado usa `NODE_ENV=production`, `HOST=127.0.0.1` y el puerto indicado en el comando. Runara reinicia la aplicación después de cada publicación. No edites directamente los archivos compilados en `C:\www`; modifica este repositorio y vuelve a ejecutar `make deploy`.

Para exponer la aplicación fuera del equipo, colócala detrás de un proxy HTTPS. La cookie de administración se marca como segura automáticamente cuando la petición llega por HTTPS.
