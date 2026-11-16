# Streamero → SCYDE Hub (`/api/stats`)

Streamero is a custom app, so the Hub expects one endpoint that returns ready-made state.
Add it to Streamero (the path and the key header can be changed in the service settings in the Hub).

`GET /api/stats` — header `X-Api-Key: <key>` (optional)

```json
{
  "version": "2.4.0",
  "streams": [
    {
      "user": "Mislav",
      "title": "Dune: Part Two",
      "subtitle": "S01E02 · Episode title",
      "progress": 42.5,
      "transcoding": false,
      "device": "Android TV",
      "quality": "4K HDR",
      "bandwidth": 42000000
    }
  ],
  "library": { "movies": 1184, "shows": 214, "episodes": 9842, "sizeBytes": 14200000000000 },
  "recentlyAdded": [
    { "title": "Conclave", "subtitle": "2024", "addedAt": "2026-11-16T09:00:00Z" }
  ]
}
```

Every field except `streams` is optional. `progress` is 0–100, `bandwidth` is in bit/s.
The stats path must be a path on the configured host (absolute URLs are refused).
Metrics stored in history: `streams`, `transcodes`, `bandwidth`.
