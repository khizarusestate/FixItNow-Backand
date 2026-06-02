# Deploy checklist — Fix It Now API

Verified bundle includes:

- Redis cache (`REDIS_URL`) + `cacheGetOrSet` on public services and admin summary
- Booking cancel → status `cancelled` + socket + push notifications (admin + customer)
- Customer email verification (register → 6-digit code → verify/resend)
- Worker `primaryServiceId` / category / name + job matching priority
- Image uploads validated; static `/uploads` cache headers in production
- See `PERFORMANCE.md` for 10k+ user scaling notes

**Railway env:** `REDIS_URL`, `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `MONGODB_URI`, `JWT_SECRET`
