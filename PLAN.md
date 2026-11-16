# SCYDE Hub — plan homelab dashboarda

Nov 16, 2026 · @SCYDE

## Cilj i opseg

SCYDE Hub (radni naziv) je jedan self-hosted dashboard koji na jednom ekranu pokazuje stanje cijelog homelaba i svih aplikacija, a radi na monitoru, Android TV-u i tabletu u kiosk modu.

Razlika prema Homarru i Homepageu: nije generički alat za svakoga, nego je skrojen točno za tvoj stack. Zato svaka integracija ide u dubinu (red čekanja, povijest, alerti, akcije), a ne samo link i tri broja.

U opsegu:

- Stanje i metrike svih servisa: Streamero, Radarr, Sonarr, Bazarr, Prowlarr, Seerr, Proxmox (host, LXC, VM), AdGuard Home, Mediarr/Immich, MikroTik VM, Vaultwarden, Pangolin, WHM i cPanel
- Vlastiti monitoring: uptime provjere, povijest metrika, alerti
- Tri klijenta iz istog koda: web, Android TV aplikacija, iOS .ipa za Feather
- Kiosk mode za stalni prikaz

Izvan opsega u prvoj verziji: multi-user i role, javno izdanje, zamjena za Zabbix/Grafanu na poslu.

## Arhitektura i stack

Jedan Docker Compose stack, isti obrazac kao Streamero i Mediarr: backend skuplja podatke od svih servisa, a klijenti dobivaju samo gotovo stanje.

&#91;embedded content: arhitektura · 3 klijenta, Hub, 6 grupa servisa\]

API ključevi nikad ne dolaze do browsera ni do TV-a. Kolektor je srce sustava: on poziva servise, pinga hostove, sprema povijest i okida alerte.

| Sloj | Prijedlog | Zašto |
| --- | --- | --- |
| Backend | Node.js + TypeScript (Fastify) | Jedan jezik s frontendom, laka plugin struktura |
| Integracije | Jedan plugin po servisu: `collect()`, `actions`, shema widgeta | Novi servis = nova mapa, bez diranja jezgre |
| Realtime | WebSocket, s fallbackom na SSE | Widgeti se osvježavaju bez reloada |
| Baza | SQLite: config, layouti, povijest metrika s downsamplingom | Jedan file, lagan backup, dovoljno za jednog korisnika |
| Frontend | React + Vite + Tailwind, PWA | Isti build ide u web, TV i iOS omotač |
| Deploy | `docker-compose.yml`, jedan kontejner + volume, u LXC-u na Proxmoxu | Kao ostale tvoje aplikacije |

Jedno ograničenje: ako Hub živi na Proxmoxu koji prati, pad hosta ruši i dashboard. Zato plan predviđa mali vanjski heartbeat (npr. s hosting servera) koji javlja kad je Hub nedostupan.

## Integracije

Svaki servis dobiva vlastiti plugin i vlastiti widget; tablica je popis onoga što Claude Code treba implementirati. API detalji su navedeni po sjećanju, pa ih Claude Code mora potvrditi u službenoj dokumentaciji prije implementacije.

| Servis | Kako se čita | Što widget prikazuje |
| --- | --- | --- |
| Proxmox host | REST API `/api2/json`, API token s ulogom PVEAuditor | CPU, RAM, load, temperatura, storage, uptime, verzija, dostupni updatei |
| Proxmox LXC i VM | `/cluster/resources` + RRD podaci | Lista svih gostiju: status, CPU, RAM, disk, mreža, zadnji backup, snapshoti |
| Streamero | Vlastiti API (dodati `/api/stats` ako ne postoji) | Aktivni streamovi, tko gleda što, transkodiranja, veličina biblioteke, nedavno dodano |
| Mediarr / Immich | Vlastiti API; Immich: server statistics + API ključ | Broj fotografija i videa, zauzeće, stanje job queuea, zadnji upload |
| Radarr, Sonarr | API v3, `X-Api-Key` | Queue s progresom, kalendar, missing/wanted, health upozorenja, disk |
| Bazarr | API, `X-API-KEY` | Titlovi koji nedostaju, zadnja preuzimanja, stanje providera |
| Prowlarr | API v1, `X-Api-Key` | Stanje indexera, neuspjeli indexeri, broj upita i grabova |
| Seerr | API v1, `X-Api-Key` | Zahtjevi na čekanju, odobreni, u obradi, dostupni; odobri/odbij |
| qBittorrent | Web API v2, prijava korisnikom i lozinkom | Brzina downloada i uploada uživo, aktivni torrenti s progresom i ETA, seeding, slobodan disk; pauziraj/nastavi |
| AdGuard Home | `/control/stats` i `/control/status` | Upiti, postotak blokiranih, top domene i klijenti, zaštita on/off |
| MikroTik VM | RouterOS v7 REST API (`/rest`) ili SNMP | CPU, RAM, promet po sučeljima uživo, WAN status, DHCP leaseovi, VPN peerovi |
| Vaultwarden | `/alive` health endpoint | Online/offline, vrijeme odziva, verzija, istek certifikata |
| Pangolin | Integration API (provjeriti da je uključen) | Siteovi online/offline, resursi, stanje tunela |
| WHM | WHM API 1, API token | Load, servisi, disk, broj računa, suspendirani računi, backup status |
| cPanel | UAPI, API token | Po računu: disk, bandwidth, domene, SSL istek, e-mail kvote |
| Bilo što drugo | Generički plugini: HTTP/JSON, ping, TCP port, Prometheus, Docker socket | Vlastiti widgeti bez pisanja koda |

Download klijent je qBittorrent: njegov widget stoji uz \*arr queue, tako da za svaki naslov vidiš i stanje u Radarru ili Sonarru i stvarni progres preuzimanja.

## Značajke dashboarda i UI/UX

Sučelje je premium i potpuno modularno: sve je widget, a svaki widget možeš dodati, maknuti, premjestiti i promijeniti mu veličinu.

### Modularni sustav widgeta

- Grid s drag-and-drop i resize; svaki widget ima veličine S, M, L i XL s različitom količinom detalja
- Galerija widgeta s pretragom; isti servis može imati više widgeta (npr. Proxmox: sažetak, lista gostiju, storage)
- Više stranica (boards): Pregled, Media, Infrastruktura, Mreža, Hosting, plus vlastite
- Zaseban layout po uređaju: monitor, TV i tablet pamte svoj raspored
- Edit mode odvojen od prikaza, tako da se u kiosku ništa ne može slučajno pomaknuti
- Klik na widget otvara detaljni panel s grafovima, poviješću i akcijama

### Status, ping i statistika

- Online/offline indikator na svakom servisu, s vremenom od zadnje promjene stanja
- Provjere: ICMP ping, TCP port, HTTP status i ključna riječ, istek SSL certifikata, DNS
- Latencija u ms sa sparklineom, uptime postotak za 24 h, 7 i 30 dana, traka povijesti ispada
- Status-wall widget: svi servisi kao pločice, zelene ili crvene, čitljivo s druge strane sobe
- Povijest metrika s grafovima (CPU, RAM, promet, queue) i odabirom raspona
- Globalni sažetak na vrhu: koliko servisa radi, aktivni alerti, aktivni streamovi, promet

### Alerti i akcije

- Pravila: servis offline, disk iznad praga, neuspjeli backup, indexer pao, certifikat ističe
- Kanali: push na telefon (ntfy ili Gotify), Telegram, Discord webhook, e-mail
- Incident log s početkom, trajanjem i potvrdom
- Akcije iz dashboarda uz potvrdu: start/stop/restart LXC i VM, odobri Seerr zahtjev, pauziraj AdGuard zaštitu, pokreni \*arr pretragu

### Vizualni smjer

- Tamna tema kao zadana, stakleni paneli, jedna akcentna boja koju možeš mijenjati; svijetla tema i OLED crna kao opcije
- Glatke animacije pri promjeni vrijednosti, skeleton loading, bez treperenja pri osvježavanju
- Prave ikone servisa, konzistentna tipografija, brojke u tabularnom fontu
- Command palette (Ctrl+K) za skok na servis, akciju ili stranicu
- Postavke i API ključevi uređuju se u sučelju, bez YAML-a
- Dodaci: kalendar izlazaka iz Sonarra i Radarra, sat, vrijeme, bilješke, iframe i bookmark widgeti

## Klijenti i kiosk mode

Sva tri klijenta prikazuju isti web frontend; nativni omotači dodaju samo ono što browser ne može.

| Klijent | Kako se gradi | Što omotač dodaje |
| --- | --- | --- |
| Monitor / desktop | Web PWA u browseru, `/kiosk` ruta | Fullscreen; opcionalno Chromium `--kiosk` na mini PC-u |
| Android TV | Tanka Kotlin aplikacija s WebViewom i Leanback launcherom, `.apk` iz GitHub Actionsa | Ikona na TV početnom zaslonu, D-pad navigacija, zaslon ostaje upaljen, opcionalni autostart nakon boota |
| iOS / iPadOS | Capacitor omotač, nepotpisani `.ipa` iz GitHub Actionsa (macOS runner), potpisivanje kroz Feather | Zaslon se ne gasi, fullscreen bez Safari trake, push notifikacije kasnije |

Pri prvom pokretanju aplikacija pita samo za URL Huba i kiosk token.

Kiosk mode:

- Bez navigacije, kursora i edit kontrola; samo sadržaj
- Automatska rotacija stranica s podešenim intervalom, uz pauzu na dodir ili tipku
- Poseban TV layout: veći font, manje gustoće, čitljivo s 3 m, fokus stanja za daljinski
- Wake lock, automatski reconnect i samostalni reload nakon nove verzije
- Zaštita od burn-ina: lagani pomak piksela i noćno zatamnjenje po rasporedu
- Alert preuzima ekran: kad nešto padne, kiosk prikazuje incident dok ga ne potvrdiš
- Na iPadu se kombinira s Guided Accessom da se aplikacija ne može napustiti

## Sigurnost

Hub drži ključeve za cijeli homelab, pa je to najosjetljivija aplikacija koju imaš i tako se mora tretirati.

- Read-only tokeni gdje god servis to podržava (Proxmox PVEAuditor, zaseban WHM token s minimalnim pravima); akcije koriste odvojeni token s užim pravima
- Tajne se spremaju šifrirano u bazi, s ključem iz env varijable; nikad u repozitoriju ni u frontendu
- Admin prijava s lozinkom i 2FA; kiosk token je zaseban, samo za čitanje i opoziv u jednom kliku
- Svaka akcija traži potvrdu i zapisuje se u audit log
- Pristup samo iz LAN-a ili kroz Pangolin; Hub se ne izlaže direktno na internet
- Self-signed certifikati servisa se prihvaćaju po servisu, ne globalnim isključivanjem TLS provjere

## Faze izrade za Claude Code

Sedam faza, svaka završava nečim što radi i što možeš otvoriti na ekranu. Svaku fazu pokreći kao zaseban Claude Code zadatak.

1. **Temelj.** Repo, `docker-compose.yml`, backend kostur, plugin sučelje za integracije, SQLite sheme, admin prijava, prazan grid s jednim demo widgetom.
2. **Design sustav i widget engine.** Tema, komponente, grid s drag-and-drop i resize, galerija widgeta, stranice, layout po uređaju, edit mode. Ovo ide rano jer sve ostalo sjeda na to.
3. **Monitoring jezgra.** Ping, TCP, HTTP i SSL provjere, online/offline, latencija, uptime, status-wall, povijest metrika s downsamplingom.
4. **Prve integracije.** Proxmox (host, LXC, VM), Radarr, Sonarr, Prowlarr, Bazarr, Seerr, qBittorrent, AdGuard Home. Uz svaku integraciju odmah idu i njezine akcije, kroz zajednički okvir s potvrdom i audit logom.
5. **Ostale integracije.** Streamero, Mediarr/Immich, MikroTik, Vaultwarden, Pangolin, WHM i cPanel, generički plugini. Akcije se dodaju uz svaku integraciju, na istom okviru.
6. **Kiosk i klijenti.** Kiosk ruta, TV layout i D-pad navigacija, Android TV `.apk`, iOS `.ipa`, GitHub Actions buildovi.
7. **Alerti i poliranje.** Pravila, notifikacije, incident log, command palette, backup i restore konfiguracije.

Pravila koja vrijede kroz sve faze:

- Svaka integracija ima mock način rada, tako da se UI može razvijati i testirati bez pristupa homelabu
- Pad jedne integracije ne smije srušiti ostale; widget tada pokazuje grešku i zadnje poznato stanje
- Svaka faza završava commitom, ažuriranim README-om i kratkim popisom što je testirano

## Početni prompt za Claude Code

Zalijepi ovo u novu Claude Code sesiju u praznom repozitoriju, zajedno s ovim dokumentom spremljenim kao `PLAN.md`.

```text
Gradimo SCYDE Hub: self-hosted homelab dashboard i monitoring sustav za jednog korisnika.
Cijeli plan je u PLAN.md. Pročitaj ga u cijelosti prije prvog koraka.

Stack: Node.js + TypeScript (Fastify) backend, React + Vite + Tailwind frontend (PWA),
SQLite, WebSocket, sve u jednom docker-compose.yml.

Pravila:
- Radi fazu po fazu prema PLAN.md. Sada radi samo Fazu 1 i stani kad je gotova.
- Integracije su plugini: jedna mapa po servisu, s collect(), actions i shemom widgeta.
- Svaka integracija ima mock način rada za razvoj bez pristupa homelabu.
- API ključevi ostaju na backendu, šifrirani; frontend ih nikad ne vidi.
- Prije implementacije svake integracije provjeri službenu API dokumentaciju servisa.
- UI mora biti premium i modularan: sve je widget, tamna tema, glatke animacije.
- Na kraju faze: commit, ažuriran README i popis onoga što si testirao i kako.

Prije pisanja koda predloži strukturu repozitorija i plugin sučelje i pričekaj moju potvrdu.
```

## Otvorene odluke

- [ ] Naziv: SCYDE Hub je radni naziv
- [ ] Stack: Node.js + TypeScript je prijedlog; ako su Streamero i Mediarr na nečemu drugom, bolje je ostati na istome
- [ ] Akcije: odlučeno, idu odmah uz svaku integraciju (faze 4 i 5)
- [ ] Ostali servisi koji stoje iza „itd.“
- [ ] Kanal za alerte: ntfy, Telegram, Discord ili e-mail
- [ ] Gdje Hub živi: LXC na Proxmoxu ili zaseban uređaj koji preživi pad hosta
