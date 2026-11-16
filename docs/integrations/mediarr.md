# Mediarr → SCYDE Hub (`/api/stats`)

`GET /api/stats` — header `X-Api-Key: <key>` (optional)

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

If Mediarr is only a front end for Immich, add the **Immich** integration instead
(official API, admin API key with the `server.statistics` and `queue.read` permissions).
