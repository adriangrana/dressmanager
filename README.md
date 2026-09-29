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

Para cambiar la contraseña después de crear la base de datos, actualiza `ADMIN_PASSWORD` en `.env` y ejecuta `npm run reset-admin`.

## Datos y fotos

- Base de datos: `data/dressmanager.sqlite` (se crea automáticamente y está excluida de Git).
- Fotos iniciales: `public/images/vestidos/aurora-rose/`.
- Fotos de vestidos añadidos desde el administrador: `public/uploads/`.
- En el formulario de vestido se pueden subir hasta ocho fotos JPG, PNG o WebP, de 8 MB como máximo cada una.

## Reglas económicas iniciales

- Aurora Rosé: coste de compra 595 €.
- Sesión en interior: 230 € IVA incluido hasta 30 minutos; 25 € por cada bloque adicional de 30 minutos; sin ayudante; 15 € de mantenimiento.
- Sesión en exterior: 350 € IVA incluido hasta 2 horas; 25 € por cada hora adicional; ayudante a 20 €/hora; 30 € de mantenimiento.
- El beneficio restante después de IVA, ayudante (si corresponde) y mantenimiento se divide a partes iguales.
- El vestido permanece bajo supervisión del equipo fotográfico durante toda la sesión.

En producción ejecuta `npm run build` y `npm start` detrás de HTTPS. Configura `NODE_ENV=production` y secretos propios para esa instalación. Las cookies privadas requieren HTTPS en producción.
