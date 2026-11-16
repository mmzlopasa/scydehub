# SCYDE Hub

Self-hosted dashboard i monitoring za cijeli homelab, na jednom ekranu. Radi na monitoru, Android TV-u i iPadu u kiosk načinu.

Plan projekta je u [PLAN.md](PLAN.md).

- **Backend:** Node.js 22 + TypeScript (Fastify). On poziva sve servise, pinga hostove, sprema povijest i okida alerte. API ključevi nikad ne dolaze do browsera ni do TV-a.
- **Frontend:** React + Vite + Tailwind, PWA. Sve je widget. Widgeti imaju drag-and-drop, resize i veličine S/M/L/XL, a svaki uređaj pamti svoj raspored.
- **Klijenti:**
  - web (PWA);
  - Android TV `.apk`: WebView omotač s Leanback ikonom i D-pad navigacijom;
  - iOS/iPadOS `.ipa`: Capacitor, nepotpisan, potpisuje se kroz Feather.
- **Pohrana:** SQLite (`node:sqlite`, bez nativnih modula). Tu su konfiguracija, layouti i povijest metrika, koja se automatski sažima: sirovo 48 h → 5 min 30 dana → 1 h 400 dana.

## Brzi start

### Lokalno (LAN)

```bash
git clone https://github.com/mmzlopasa/scydehub && cd scydehub
```

```bash
cp .env.example .env
```

```bash
sed -i "s/^SCYDE_SECRET_KEY=.*/SCYDE_SECRET_KEY=$(openssl rand -hex 32)/" .env
```

```bash
docker compose up -d --build
```

Otvori `http://<ip-hosta>:8080`. Pri prvom pokretanju sučelje traži **kod za postavljanje**, a on je ispisan u logu:

```bash
docker compose logs hub | grep -A1 "kod"
```

Admina možeš napraviti i unaprijed, preko `SCYDE_ADMIN_PASSWORD` u `.env`.

Ako želiš odmah vidjeti kako sve izgleda, idi na *Postavke → Backup i sustav → Učitaj demo*. To dodaje sve integracije u mock načinu i pet gotovih stranica.

> `SCYDE_SECRET_KEY` šifrira sve spremljene API ključeve i lozinke (AES-256-GCM). Čuvaj ga izvan repozitorija. Bez njega se tajne iz backupa ne mogu dešifrirati.

### Preko domene (nginx + certbot u Dockeru)

1. U `.env` postavi:
   - `DOMAIN`
   - `CERTBOT_EMAIL`
   - `HUB_BIND=127.0.0.1`
   - `SCYDE_SECURE_COOKIES=1`
   - `ALLOW_CIDRS` (LAN i VPN mreže koje smiju pristupiti)
2. DNS A zapis za domenu mora pokazivati na host, a portovi 80 i 443 moraju biti otvoreni.
3. Pokreni:

```bash
./deploy/init-letsencrypt.sh
```

Skripta napravi privremeni certifikat, pokrene nginx, zatraži pravi Let's Encrypt certifikat, a zatim pokrene `certbot renew` petlju svakih 12 h. Nginx se reloada svakih 6 h. Ako prvo želiš probati bez trošenja Let's Encrypt limita, dodaj `--staging`.

Nakon toga je dovoljno ovo:

```bash
docker compose --profile proxy up -d
```

Ako na hostu već imaš nginx i `certbot --nginx`, koristi [deploy/nginx/host-nginx.conf.example](deploy/nginx/host-nginx.conf.example).

## Klijenti

Svi klijenti traže samo dvije stvari: **URL Huba** i **kiosk token**. Token napraviš u *Postavke → Kiosk i uređaji*. Samo je za čitanje i opoziva se jednim klikom.

| Klijent | Gdje ga dobiti | Napomene |
| --- | --- | --- |
| Monitor / mini PC | `https://hub/kiosk?token=…` | Za pravi kiosk: `chromium --kiosk --noerrdialogs "https://hub/kiosk?token=…&profile=desktop"` |
| Android TV | GitHub Actions → **Android TV APK** → artefakt `scydehub-tv.apk` (na tagu `v*` i u Releases) | Ikona je na TV početnom zaslonu, zaslon ostaje upaljen, a autostart nakon boota je opcionalan. Strelice ←/→ mijenjaju stranice, OK pauzira rotaciju, a BACK ×2 ili MENU vraćaju na postavke. |
| iPad / iPhone | GitHub Actions → **iOS IPA** → `scydehub.ipa` | Potpiši i instaliraj kroz Feather. Zaslon se ne gasi, nema statusne trake. Uključi *Guided Access*. Za povratak na postavke tapni 5× na sat u kiosku. |

APK se po defaultu potpisuje debug ključem CI-ja. Ako želiš stabilan potpis (da se nove verzije instaliraju preko stare), dodaj secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### Kiosk

- Nema navigacije, kursora ni edit kontrola.
- Stranice se automatski rotiraju; dodir ili tipka pauziraju rotaciju.
- Wake lock i automatski reconnect. Kad server dobije novi build, kiosk se sam reloada.
- Zaštita od burn-ina (pomak piksela) i noćno zatamnjenje po rasporedu.
- **Kritični incident preuzima ekran** dok ga ne potvrdiš.
- TV profil (`?profile=tv`) ima veći font, manju gustoću i fokus stanja za daljinski.

## Integracije

Svaka integracija je jedna mapa u `server/src/plugins/<servis>/`. Sadrži `collect()`, `mock()`, `actions` i definicije widgeta. Novi servis znači novu mapu plus jedan redak u `registry.ts`.

| Servis | Čita | Akcije (uz potvrdu i audit log) |
| --- | --- | --- |
| Proxmox VE | host (CPU, RAM, load, uptime, verzija, updatei), LXC i VM s resursima, storage, zadnji backup po gostu, snapshoti, status zadnjeg vzdump taska | start, shutdown, reboot, stop (zaseban token) |
| Radarr / Sonarr | queue s progresom i ETA, kalendar, missing, health, disk, biblioteka | pretraži nedostajuće, RSS sync, osvježi preuzimanja, makni iz reda |
| Bazarr | titlovi koji nedostaju, provideri, zadnja preuzimanja, health | reset throttlea providera |
| Prowlarr | indexeri (rade / ne rade), upiti, grabovi, odziv | test svih indexera |
| Seerr | zahtjevi (na čekanju, u obradi, dostupni) s naslovima | odobri, odbij |
| qBittorrent (4.x i 5.x) | brzine uživo, aktivni torrenti, seeding, slobodan disk | pauziraj ili nastavi sve ili pojedinačni torrent |
| AdGuard Home | upiti, postotak blokiranih, graf po satu, top domene i klijenti | pauziraj ili uključi zaštitu |
| MikroTik (RouterOS 7 REST) | CPU, RAM, promet po sučeljima uživo, WAN, DHCP, WireGuard peerovi | — |
| Pangolin (Integration API) | siteovi online/offline, resursi | — |
| Vaultwarden | `/alive` (provjerava i bazu), odziv, verzija, istek certifikata | — |
| WHM | load, servisi, računi, suspendirani računi, backup | — |
| cPanel (direktno ili kroz WHM) | po računu: disk, bandwidth, domene, SSL istek, e-mail kvote | — |
| Immich | fotografije i videi, zauzeće, korisnici, job queue (`/api/queues`) | — |
| Streamero, Mediarr | vlastiti `/api/stats` (vidi [docs/integrations](docs/integrations)) | — |
| Generički | HTTP/JSON (bilo koje polje), Prometheus (PromQL), Docker | restart kontejnera |

Uz integracije postoje i ugrađeni widgeti:

- Status wall i sažetak
- Uptime provjere i incidenti
- Graf bilo koje metrike
- Spojeni Radarr i Sonarr kalendar
- Sat, vrijeme (Open-Meteo), bilješke, linkovi i iframe

API detalji provjereni su u službenoj dokumentaciji i izvornom kodu (studeni 2026). Promjene koje utječu na postavljanje:

- **Proxmox** ne izlaže temperaturu. Za nju koristi Prometheus widget s node_exporterom (`node_hwmon_temp_celsius`).
- **Proxmox** popis updatea traži `Sys.Modify`, a popis backupa `Datastore.AllocateSpace` + `VM.Backup`. Sam PVEAuditor ih ne vidi, pa ti podaci tada izostanu bez greške.
- **qBittorrent 5.x** koristi `torrents/stop|start` i cookie `QBT_SID_<port>`. Hub to prepoznaje sam. Na 5.2+ možeš koristiti i API ključ.
- **Immich** 2.4+ koristi `/api/queues`. Stari `/api/jobs` je fallback.

### Pravila

- **Mock način:** svaka integracija ima mock način (prekidač po servisu ili `SCYDE_MOCK=1` za cijeli Hub), pa se UI razvija bez homelaba.
- **Izolacija grešaka:** pad jedne integracije ne ruši ostale. Widget tada pokazuje grešku i **zadnje poznato stanje**.
- **TLS po servisu:** self-signed certifikat prihvaća se **po servisu** (prekidač ili SHA-256 pin), nikad globalno.

## Monitoring i alerti

- **Provjere:**
  - Vrste: ICMP ping, TCP port, HTTP (status i ključna riječ), istek SSL certifikata, DNS.
  - Latencija ide u povijest; uptime se računa za 24 h, 7 i 30 dana, uz traku povijesti po satu.
- **Pravila:**
  - servis offline;
  - provjera ne prolazi;
  - metrika iznad ili ispod praga (npr. disk, CPU);
  - certifikat ističe;
  - upozorenja koja servis sam javi (health, neuspjeli backup, indexer pao, disk pun…).
- **Kanali:** ntfy, Gotify, Telegram, Discord webhook, e-mail (SMTP).
- **Incident log:** početak, trajanje i potvrda. *Održavanje* utišava obavijesti na zadano vrijeme.
- **Vanjski heartbeat:** ako Hub živi na Proxmoxu koji prati, pad hosta ruši i Hub. Dvije mogućnosti:
  - u *Postavke → Backup i sustav* upiši heartbeat URL (healthchecks.io, Uptime Kuma push);
  - na hosting server stavi [deploy/heartbeat/hub-watch.sh](deploy/heartbeat/hub-watch.sh) u cron.

## Sigurnost

- Admin prijava s lozinkom (scrypt) i **TOTP 2FA**. Login je rate-limitiran.
- Sesije su u httpOnly cookieju. Svaki zahtjev koji mijenja stanje traži `x-scyde` header (CSRF zaštita).
- Kiosk token je zaseban, samo za čitanje (opcionalno smije potvrditi incident) i opoziva se jednim klikom.
- Tajne su u bazi šifrirane i nikad se ne vraćaju u preglednik.
- Svaka akcija traži potvrdu i zapisuje se u **audit log**, kao i prijave i promjene konfiguracije.
- Preporuka je pristup samo iz LAN-a ili kroz Pangolin/VPN: `ALLOW_CIDRS` u nginxu. Ne izlaži Hub direktno na internet bez 2FA.
- Koristi read-only tokene gdje god servis to podržava:
  - Proxmox: PVEAuditor plus zaseban token s `VM.PowerMgmt` za akcije;
  - WHM: token s minimalnim ACL-ovima;
  - MikroTik: korisnik u grupi `read` + `rest-api`.

## Razvoj

```bash
npm install
```

```bash
SCYDE_MOCK=1 SCYDE_ADMIN_PASSWORD=admin12345 npm run dev -w server
```

```bash
npm run dev -w web
```

Vite dev server (`:5173`) prosljeđuje `/api` i WebSocket na backend (`:8080`).

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

Android lokalno (treba Android SDK):

```bash
cd android && ./gradlew assembleRelease
```

iOS se builda samo na macOS-u (vidi `.github/workflows/ios.yml`).

### Struktura

```
server/            Fastify backend
  src/plugins/     jedna mapa po integraciji (+ types.ts, registry.ts)
  src/monitoring/  ping/TCP/HTTP/SSL/DNS provjere, uptime
  src/alerts/      pravila, incidenti, kanali
  src/routes/      REST API, WebSocket + SSE
  test/            node:test
web/               React PWA (widgeti u src/widgets, kiosk u src/pages/Kiosk.tsx)
android/           Android TV / Android omotač (Kotlin, bez AndroidX ovisnosti)
ios/app/           Capacitor iOS omotač (Xcode projekt s SPM-om)
deploy/            nginx predložak, certbot skripta, vanjski heartbeat
docs/integrations/ ugovori za vlastite /api/stats endpointe
```

## Što je testirano i kako

| Područje | Kako | Rezultat |
| --- | --- | --- |
| Backend | `npm test` (node:test): AES-GCM tajne i tamper, scrypt, TOTP prema RFC 6238 vektorima, base32, downsampling, RouterOS trajanja, JSON putanje, mock svih 19 pluginova, enkripcija tajni u bazi i placeholder logika | 9/9 prolazi |
| Tipovi | `tsc` za server i web | bez grešaka |
| API end-to-end | server pokrenut s demo podacima; curl za login, demo seed, `/api/state`, healthz | radi |
| UI | Playwright (Chromium), screenshotovi desktop 1600×1000, iPhone 13 i kiosk `?profile=tv`. Provjereno: login, svih pet stranica, detaljni panel s grafovima, command palette, postavke | radi; bez JS grešaka |
| Docker | runtime image pokrenut kroz `docker compose` (read-only FS, non-root, sysctl za ping, healthcheck) | `healthy`, login i SPA rade |
| nginx | predložak renderiran u `nginx:1.27-alpine` s allowlistom i testnim certifikatom | `nginx -t` OK |
| Android | `./gradlew assembleRelease` (AGP 8.7, SDK 35) | APK 34 KB; `aapt2` potvrđuje LAUNCHER i LEANBACK_LAUNCHER |
| iOS | Xcode projekt generiran s `cap add ios --packagemanager SPM`; build na macOS runneru u GitHub Actionsu | `.ipa` artefakt napravljen; na uređaju još nije isproban |
| GitHub Actions | CI (typecheck, testovi, build, multi-arch Docker image na GHCR), APK, IPA | sva tri workflowa prošla na prvom pushu |

Nije testirano na pravim servisima jer ovo okruženje nema pristup homelabu. Integracije su napisane prema službenoj dokumentaciji, a u postavkama servisa postoji gumb **Testiraj vezu**.

## Otvorene odluke (iz plana)

- Naziv je još radni.
- Stack je Node.js; ako su Streamero ili Mediarr na nečem drugom, plugin sučelje se lako prenosi.
- Treba dopuniti popis servisa iza „itd.“. Generički HTTP/JSON i Prometheus plugin pokrivaju većinu bez novog koda.
- Gdje Hub živi: preporuka je LXC na Proxmoxu + vanjski heartbeat s hosting servera.
