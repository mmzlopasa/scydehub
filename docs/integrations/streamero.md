# Streamero → SCYDE Hub (`/api/stats`)

Streamero je vlastita aplikacija, pa Hub očekuje jedan endpoint koji vraća gotovo stanje.
Dodaj ga u Streamero (put i header za ključ se mogu promijeniti u postavkama servisa u Hubu).

`GET /api/stats` — header `X-Api-Key: <ključ>` (opcionalno)

```json
{
  "version": "2.4.0",
  "streams": [
    {
      "user": "Mislav",
      "title": "Dune: Part Two",
      "subtitle": "S01E02 · Naslov epizode",
      "progress": 42.5,
      "transcoding": false,
      "device": "Android TV",
      "quality": "4K HDR",
      "bandwidth": 42000000
    }
  ],
  "library": { "movies": 1184, "shows": 214, "episodes": 9842, "sizeBytes": 14200000000000 },
  "recentlyAdded": [
    { "title": "Conclave", "subtitle": "2024", "addedAt": "2026-11-16T09:00:00Z", "poster": "https://…" }
  ]
}
```

Sva polja osim `streams` su opcionalna. `progress` je 0–100, `bandwidth` u bit/s.
Metrike koje Hub sprema u povijest: `streams`, `transcodes`, `bandwidth`.
