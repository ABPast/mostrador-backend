# Mostrador · Backend

API REST en Node.js + Express con MySQL. Incluye el frontend web (`public/`): login, aplicación (`app.html`) y panel del superadministrador (`admin.html`).

**Roles**
- `superadmin`: da de alta negocios (con su administrador), los suspende o elimina, restablece contraseñas y **puede entrar a cualquier negocio** (botón «Entrar»): dentro actúa con permisos de administrador de ese negocio. La API lo recibe con la cabecera `X-Business-Id`.
- `admin` (por negocio): permisos sobre todo el negocio; ve **todas las ventas** (con filtros por periodo, empleado, forma de pago, tipo de venta, categoría y cliente) y gestiona a sus empleados.
- `user` (empleado): vende, consulta inventario y proveedores y crea/edita clientes. **Solo ve las ventas que él registró.** No edita inventario ni precios, no anula ventas, no ve costos, utilidad ni gastos (esto lo aplica la API, no solo la pantalla).

**Tipo de venta.** Cada producto se vende *por unidad* (precio por pieza, cantidades enteras) o *por peso* (precio y costo por kg, existencias y ventas en kg con hasta 3 decimales). El servidor calcula el importe con el precio guardado, descuenta las existencias en una transacción y anota qué usuario vendió.

**Actualización desde una versión anterior.** Al arrancar, el servidor agrega solo las columnas nuevas (`products.sale_type`, existencias decimales, `sales.user_id`/`user_name`). Los productos existentes quedan «por unidad» y las ventas anteriores sin empleado aparecen como «Sin asignar».

Los datos de cada negocio están aislados: cada consulta se filtra por el negocio del usuario autenticado.

## Instalación

1. Requisitos: Node.js 18+ y MySQL 8 (o MariaDB 10.5+).
2. MySQL rápido con Docker (opcional): `docker compose up -d`
3. Dependencias: `npm install`
4. Configuración: copia `.env.example` a `.env` y completa `JWT_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` y los datos de MySQL.
   - Genera el secreto con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. Arranca: `npm start` → http://localhost:3000

La primera vez se crean la base, las tablas y el superadministrador. Entra en `/login.html` con ese correo; te llevará a `/admin.html` para crear negocios.

## Frontend

- `public/login.html`: acceso único para todos los roles.
- `public/app.html` + `css/app.css` + `js/app.js`: aplicación del negocio (Inicio, Vender, Inventario, Clientes, Gastos, y en «Más»: Proveedores, Equipo y cambio de contraseña). El empleado no ve utilidad, costos, gastos ni equipo.
- `public/admin.html`: alta y gestión de negocios (superadmin).
- `public/api-shim.js`: capa de conexión con la API (sesión, lectura/escritura y refresco cada 5 s).

## Endpoints

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/auth/login` | público |
| GET | `/api/auth/me` | autenticado |
| POST | `/api/auth/password` | autenticado |
| GET/POST | `/api/admin/businesses` | superadmin |
| PATCH/DELETE | `/api/admin/businesses/:id` | superadmin |
| GET | `/api/admin/businesses/:id/users` | superadmin |
| PATCH | `/api/admin/users/:id` | superadmin |
| GET/POST | `/api/users` | admin |
| PATCH/DELETE | `/api/users/:id` | admin |
| GET/POST | `/api/{products,customers,suppliers,expenses}` | admin / user (según permisos) |
| PATCH/DELETE | `/api/{products,customers,suppliers,expenses}/:id` | admin / user (según permisos) |
| GET | `/api/sales` | admin (todas) · user (solo las suyas) |
| POST | `/api/sales` — `{items:[{pid,qty}], discount, method, customerId, day}` | admin / user |
| DELETE | `/api/sales/:id` (devuelve existencias) | admin |

Las listas aceptan `?where=campo:valor&orderBy=campo&dir=desc&limit=N`. Se envía el token en `Authorization: Bearer <token>`.

## Frontend en GitHub Pages / otro dominio

Si sirves el frontend aparte (ver `mostrador-frontend/`), el backend debe estar actualizado: la API ahora acepta la cabecera `X-Business-Id` en CORS (sin eso, el botón «Entrar» del superadministrador falla con «Failed to fetch»). Define en `.env` `CORS_ORIGIN=https://TU_USUARIO.github.io` (solo el dominio, sin ruta). Detrás de Cloudflare usa `TRUST_PROXY=1` (si además hay Nginx en medio, `2`) para que el límite de intentos use la IP real.

## Producción

- Usa HTTPS (Nginx/Caddy) y pon `TRUST_PROXY=1`.
- Haz respaldos de la base MySQL.
- Si publicas el frontend en otro dominio, hay que agregar CORS; por defecto todo va en el mismo origen.
