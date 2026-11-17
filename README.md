# SCYDE Hub

A self-hosted dashboard and monitor for a whole homelab on one screen. It runs on a monitor, an Android TV and an iPad in kiosk mode.

The original project plan (in Croatian) is in [PLAN.md](PLAN.md).

- **Backend:** Node.js 22 + TypeScript (Fastify). It talks to every service, pings hosts, stores history and raises alerts. API keys never reach a browser or a TV.
- **Frontend:** React + Vite + Tailwind, PWA. Everything is a widget, and you can place a widget anywhere at any size. Each device type keeps its own layout.
- **Clients:**
  - web (PWA);
  - Android TV `.apk`: a WebView shell with a Leanback icon and D-pad navigation;
  - iOS/iPadOS `.ipa`: Capacitor, unsigned, to be signed with Feather.
- **Storage:** SQLite (`node:sqlite`, no native modules) for configuration, layouts and metric history. History is downsampled automatically: raw for 48 h → 5-minute for 30 days → hourly for 400 days.

## Install

### Behind a Cloudflare Tunnel (recommended)

You need Docker with the compose plugin. No ports are opened on the router.

```bash
git clone https://github.com/mmzlopasa/scydehub /opt/scydehub && cd /opt/scydehub
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

Then choose one of these:

- **You already run a tunnel on this host.** Add a public hostname to it with service `HTTP` and URL `localhost:8484`.
- **You want a dedicated tunnel.** Put its token in `.env` as `TUNNEL_TOKEN`, start with `docker compose --profile tunnel up -d --build`, and point the public hostname at `hub:8484`.

Open the site. The first run asks for a **setup code**, which is printed in the log:

```bash
docker compose logs hub | grep -A1 "setup code"
```

Enable two-factor sign-in right away (*Settings → Security*). The Hub is reachable from the internet through the tunnel.

> `SCYDE_SECRET_KEY` encrypts every stored API key and password. Keep a copy outside the server; without it the secrets in a backup cannot be decrypted.

### LAN only

Same steps without a tunnel. Open `http://<host>:8484`.

### nginx + certbot

- **In Docker:** set `DOMAIN` and `CERTBOT_EMAIL` in `.env`, then run `./deploy/init-letsencrypt.sh`.
- **nginx already on the host:** use [deploy/nginx/host-nginx.conf.example](deploy/nginx/host-nginx.conf.example).

If the reverse proxy runs on another machine, add its address to `SCYDE_TRUST_PROXY`.

### Updating

```bash
cd /opt/scydehub && git pull && docker compose up -d --build
```

Database migrations run on start. Layouts made before version 0.2 are converted to the finer grid automatically.

## Customizing

*Settings → Customize* changes how the Hub looks, live on every connected device:

| Area | What you can change |
| --- | --- |
| Branding | Dashboard name, tagline, logo and browser-tab icon (upload or URL), sign-in title and subtitle, footer text |
| Theme & colours | Dark, light or OLED; primary and secondary colour; online, warning and offline colours; page colour; five presets |
| Background | 3D planet, aurora, grid, your own image or a solid colour; dim level; motion (full, reduced, off) |
| Cards & type | Corner radius, opacity, glass blur, borders, glow, 3D tilt, widget headers, density; font (Sora, Geist, Inter, system); number style (dot-matrix, text, monospace); text size |
| Layout | Free placement or auto-pack, overlapping widgets, gap, page width, guide dots |
| Header | Floating pill, full-width bar or hidden; which live indicators show; clock; your own links |
| Regional | Locale, 12- or 24-hour clock, °C or °F, weather location |
| Custom CSS | Anything else |

More options sit next to the thing they change:

- **Per service** (*Settings → Services*): name, icon (a dashboard-icons name, an image URL or an upload) and accent colour.
- **Per widget** (edit mode → gear): title, icon, accent colour, size, hide the header, transparent card, edge-to-edge content, move to another board, duplicate.
- **Per board** (*Settings → Boards*): name, icon, order, whether it rotates in kiosk mode.

### Templates

*Settings → Boards → Templates* imports ready-made boards with the widgets already arranged.

- **Complete homelab** (built in, also in [templates/complete-homelab.json](templates/complete-homelab.json)): seven boards — Overview, Media, Infrastructure, Network, Hosting, Wall and Tools — with every widget of every integration.
- A template holds boards, widgets and positions. It holds no services and no keys.
- On import each widget attaches to your own service of that type. For types you do not have yet you choose: create a placeholder that runs in mock mode until you enter its real URL and key, or leave those widgets out.
- New boards are added after yours unless you choose to replace them. Services are never deleted.
- *Export my boards as a template* saves your own layout to a file, to share it or move it to another Hub.

### Arranging widgets

Click **Edit** on a board.

- Drag a widget anywhere. In *Free* mode it stays exactly where you drop it, gaps included. *Auto-pack* makes widgets float up.
- Resize from any edge or corner. The grid has 24 columns.
- *Overlap* lets widgets sit on top of each other.
- A widget shows more or less detail depending on the space it has.
- Monitor, TV, tablet and phone each store their own layout. Switch device type with the screen icon in the header.

## Clients

Every client needs only the **Hub URL** and a **kiosk token** (*Settings → Kiosk & devices*). A kiosk token is read-only and is revoked with one click; a revoked device is disconnected immediately.

| Client | Where to get it | Notes |
| --- | --- | --- |
| Monitor / mini PC | `https://hub/kiosk#token=…` | `chromium --kiosk --noerrdialogs "https://hub/kiosk#token=…"` |
| Android TV | [Releases](https://github.com/mmzlopasa/scydehub/releases/latest) → `scydehub-tv.apk` | Left/right switches boards, OK pauses rotation, BACK twice or MENU opens setup. The token is stored encrypted with the Android Keystore. Builds are signed with the same key every time, so a newer APK installs over an older one (coming from 0.2.x: uninstall once). |
| iPad / iPhone | [Releases](https://github.com/mmzlopasa/scydehub/releases/latest) → `scydehub.ipa` | Sign and install with Feather. Turn on *Guided Access*. Five quick taps in the top-left corner return to setup. Prefer an `https://` Hub address: iOS may refuse to show a plain `http://` Hub inside the app. |

Both apps are built and published on the Releases page automatically whenever they or the version in `package.json` change on `main`.

The token is passed in the URL fragment (`#token=`), which is never sent to a server or written to a proxy log.

**Kiosk mode:** no navigation or edit controls, board rotation, wake lock, automatic reconnect, reload after a server update, burn-in protection, night dimming, and a critical incident takes over the screen until someone acknowledges it.

## Integrations

Each integration is one folder in `server/src/plugins/<service>/` with `collect()`, `mock()`, `actions` and its widgets.

| Service | Reads | Actions |
| --- | --- | --- |
| Proxmox VE | Host, LXC and VM resources, storage, last backup per guest, snapshots, last vzdump task | Start, shut down, reboot, stop (separate token) |
| Radarr / Sonarr | Queue with progress, calendar, missing, health, disk | Search missing, RSS sync, refresh downloads, remove from queue |
| Bazarr | Missing subtitles, providers, history, health | Reset provider throttle |
| Prowlarr | Indexer state, queries, grabs | Test all indexers |
| Seerr | Requests and counts | Approve, decline |
| qBittorrent (4.x and 5.x) | Live speeds, active torrents, free space | Pause or resume all or one |
| AdGuard Home | Queries, blocked share, top lists | Pause or enable protection |
| MikroTik (RouterOS 7 REST) | CPU, RAM, traffic per interface, WAN, DHCP, WireGuard | — |
| Pangolin | Sites and resources | — |
| Vaultwarden | `/alive`, response time, version, certificate expiry | — |
| WHM / cPanel | Load, services, accounts, disk, bandwidth, domains, SSL, mailboxes | — |
| Immich | Photos, videos, usage, job queues | — |
| Streamero, Mediarr | Your own `/api/stats` (see [docs/integrations](docs/integrations)) | — |
| Generic | HTTP/JSON, Prometheus, Docker | Restart container |

Things that affect setup:

- **Proxmox** exposes no temperature. Use the Prometheus widget with node_exporter.
- **Proxmox** pending updates need `Sys.Modify`; the backup list needs `Datastore.AllocateSpace` + `VM.Backup`. With PVEAuditor alone those two items are simply empty.
- **Mock mode:** every integration has one (per service, or `SCYDE_MOCK=1` for the whole Hub). *Settings → Backup & system → Load demo* creates a complete mock homelab.
- **Failure isolation:** a failing integration only marks itself as down. Its widget shows the error and the last known state.

## Monitoring and alerts

- **Checks:** ping, TCP, HTTP (status and keyword), SSL expiry, DNS. Latency goes into history; uptime is shown for 24 h, 7 and 30 days.
- **Rules:** service offline, check failing, metric above or below a threshold, certificate expiring, warnings a service reports about itself.
- **Channels:** ntfy, Gotify, Telegram, Discord, e-mail.
- **Incidents:** start, duration, acknowledgement. Maintenance mode mutes notifications.
- **External heartbeat:** if the Hub lives on the Proxmox host it watches, it dies with it. Set a heartbeat URL in *Settings → Backup & system*, or run [deploy/heartbeat/hub-watch.sh](deploy/heartbeat/hub-watch.sh) from cron on another machine.

## Security

The Hub holds the keys to everything else, so it is built on the assumption that a session or a device can be stolen.

**Sign-in**

- Passwords are hashed with scrypt.
- Two-factor sign-in (TOTP). A code cannot be used twice, and there are ten one-time recovery codes.
- Five failed attempts per address or ten per account block sign-in for 15 minutes.
- The first-run setup code is 10 characters and is replaced after five wrong tries.
- Sessions end after 7 idle days or 30 days in total. *Settings → Security* lists them and can sign out any of them.

**Stored credentials**

- Secrets are encrypted with AES-256-GCM and never sent back to the browser.
- Each ciphertext is bound to its service and field, so it cannot be copied into another service to be decrypted there.
- A stored secret is never sent to a new address. If you change a service URL you must type its key again.
- Integrations can only call paths on the host you configured.

**Password re-confirmation**

These actions ask for your password again (once per 10 minutes):

- adding a service, changing its connection settings or testing them;
- adding or changing a notification channel;
- destructive actions such as stopping a VM;
- creating a kiosk token;
- exporting or restoring a backup;
- changing the heartbeat or public URL;
- enabling 2FA or regenerating recovery codes.

**Kiosk devices**

- A kiosk token can read state and, optionally, acknowledge incidents. Nothing else.
- It never sees service configuration, check definitions or the heartbeat URL.
- Revoking a token, signing out or changing the password closes that device's live connection at once.

**Browser and network**

- Every state-changing request needs a custom header, which a cross-site page cannot send.
- The live WebSocket checks the page origin.
- A strict Content-Security-Policy allows no inline scripts and no third-party connections. Weather is fetched by the Hub, not by the browser.
- Only the same host and Docker networks are trusted as reverse proxies by default, so a LAN client cannot spoof its address.
- Every request body is validated; bad input returns a 400 and cannot crash the server or corrupt stored layouts.

**Container**

- Runs as a non-root user with a read-only filesystem, all capabilities dropped, and memory and process limits.
- The Hub container receives only its own variables; the tunnel token stays out of it.

**Audit log**

Sign-ins, failed attempts, actions and configuration changes are recorded with user, address and result. Secret-looking values are redacted.

**What you should still do**

- Turn on 2FA.
- Use read-only tokens for services: Proxmox PVEAuditor plus a separate `VM.PowerMgmt` token for actions, a WHM token with minimal ACLs, a MikroTik user in a read group.
- If you use Cloudflare Access in front of the domain, connect TVs and tablets to the LAN address instead, because kiosk apps cannot pass the Access sign-in.

## Development

```bash
npm install
```

```bash
SCYDE_MOCK=1 SCYDE_ADMIN_PASSWORD=admin12345 npm run dev -w server
```

```bash
npm run dev -w web
```

The Vite dev server (`:5173`) proxies `/api` and the WebSocket to the backend (`:8484`).

```bash
npm test
```

```bash
npm run typecheck
```

```
server/            Fastify backend
  src/plugins/     one folder per integration
  src/monitoring/  ping/TCP/HTTP/SSL/DNS checks, uptime
  src/alerts/      rules, incidents, channels
  src/routes/      REST API, WebSocket + SSE
  src/settings.ts  every customizable setting and its validation
web/               React PWA (widgets in src/widgets, 3D background in src/components/Backdrop.tsx)
android/           Android TV / Android shell (Kotlin)
ios/app/           Capacitor iOS shell
deploy/            nginx template, certbot script, external heartbeat
```

## What was tested, and how

| Area | How | Result |
| --- | --- | --- |
| Backend | `npm test`: encryption and tamper detection, scrypt, TOTP against RFC 6238 vectors, downsampling, all 19 plugin mocks, secrets bound to instance and URL, settings validation (types, ranges, enums), path confinement, board templates, per-service TLS against a real self-signed server, PromQL field parsing, JSON expectations, redirect handling in checks | 16/16 pass |
| Types | `tsc` for server and web | clean |
| Security, live | 22 requests against a running server: CSRF header, password re-confirmation, refusing to send a stored key to a new URL, kiosk role limits, token not accepted from the URL, input validation, lockout after failed sign-ins | all behave as designed |
| WebSocket | Cross-site origin refused, kiosk token through the sub-protocol, connection closed on token revoke and on sign-out | all behave as designed |
| UI | Chromium at 1600×1000, iPhone 13 and TV kiosk: sign-in, boards, edit mode, Customize, light theme, security page | no JavaScript errors |
| Templates | The built-in template imported through the UI into an empty Hub; a test checks that it contains every widget, that nothing overlaps and that everything fits the grid | 7 boards, 62 widgets, no errors |
| Free placement | A widget dragged into empty space stays there and survives a reload | works |
| End to end | 28 steps through the real UI against a fake Proxmox host with a self-signed certificate: template import, connecting a service, a power action, a check, a notification, kiosk token and revocation, backup and restore, 2FA and recovery codes | 28/28 pass |
| Android | `./gradlew assembleRelease` | builds |
| Docker | The runtime image started through the hardened `docker-compose.yml`: the `init` step fixed the ownership of `./data`, the Hub ran as uid 1000 with no capabilities, a read-only filesystem and no tunnel token in its environment | healthy, sign-in works |

Not tested:

- **Real services.** This environment has no access to a homelab; integrations follow the official API documentation. Use **Test connection** in the service form.
- **The iOS shell on a device.** It now shows the Hub inside a frame. That works over HTTPS; a plain `http://` LAN address may be blocked by iOS inside the frame.
- **The full image build in this environment.** Its package step is blocked by the sandbox network here, so the runtime stage was tested with artifacts built on the host. The complete build runs in GitHub Actions.

One residual risk: a backup file made before version 0.2 holds secrets that are not yet bound to their service. Restoring such a file requires your password; delete old backup files once you have made a new one.
