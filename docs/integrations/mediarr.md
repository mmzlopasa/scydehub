# Mediarr → SCYDE Hub (`/api/stats`)

`GET /api/stats` — header `X-Api-Key: <ključ>` (opcionalno)

```json
{
  "version": "1.3.0",
  "photos": 48219,
  "videos": 2311,
  "usageBytes": 612000000000,
  "diskTotalBytes": 4000000000000,
  "jobs": [ { "name": "thumbnails", "active": 3, "waiting": 48, "failed": 0 } ],
  "lastUploadAt": "2026-11-16T11:58:00Z"
}
```

Ako je Mediarr samo sučelje oko Immicha, umjesto ovoga dodaj **Immich** integraciju
(službeni API, admin API ključ s dozvolama `server.statistics` i `queue.read`).
