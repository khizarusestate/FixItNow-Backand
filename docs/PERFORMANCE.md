# Fix It Now — Performance & Scale

## Caching (Redis)

Set `REDIS_URL` on Railway (Redis add-on). Without it, the API falls back to in-memory LRU (single instance only).

| Key prefix | TTL | Invalidated on |
|------------|-----|----------------|
| `fixitnow:public:services:*` | 120s | Booking create/cancel |
| `fixitnow:public:categories` | 300s | Service admin changes |
| `fixitnow:admin:summary:*` | 30s | Booking mutations |

## Static assets

- Uploads: `Cache-Control: 7d` in production (`/uploads`)
- Vercel frontends: long-cache headers for `/Assets` and hashed bundles (`vercel.json`)
- Optional CDN: set `VITE_CDN_BASE_URL` on customer/admin builds

## Frontend

- Route-level code splitting (`React.lazy`) for heavy sections
- `LazyImage` + `loading="lazy"` on ad/media grids
- Client image compression before upload (`compressImageFile`)
- Manual Vite chunks: leaflet, socket, icons

## Database

- Admin bookings: single query + `.populate()` (2 refs), paginated
- Public services: `.lean()` + Redis cache
- Admin summary: `Promise.all` parallel counts + 30s cache

## 10k+ users

1. **Redis** — shared cache across Railway replicas
2. **Pagination** — admin lists default 50/page
3. **Socket.IO** — room-based emits (customer/worker/admin)
4. **Indexes** — ensure Mongo indexes on `Booking.status`, `Booking.customerId`, `Service.isActive`
5. **Horizontal scale** — stateless API behind Railway; sticky sessions not required if Redis is used for cache

## i18n

Customer app: English + Urdu via `I18nContext` (`localStorage` locale).
