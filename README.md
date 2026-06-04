# GolfBox MCP

Dette er et startpunkt for en MCP-server som lar agenter finne, forberede, booke og kansellere tee-times via en kontrollert GolfBox-adapter.

Status per 27. mai 2026: Jeg fant ikke en publisert OpenAPI/Swagger-kontrakt, men GolfBox Android-appen bruker et MobileHub-API under `https://app.golfbox.dk/`. Den uoffisielle kontrakten ligger i `docs/golfbox-mobilehub-contract.md`. Den lokale offisielle adapteren støtter nå auth, klubb-listing, tee-time search, booking via `tryEditTeeTime`/`saveTeeTime` og kansellering med booking-ID-en adapteren returnerer. Write-verktøy bør fortsatt ikke aktiveres uten dokumentasjon/tilgang fra GolfBox eller en golfklubb.

## Kom i gang

```bash
bun install
bun run build
bun run dev
```

Denne repoen bruker Bun som dev-runtime, pakkebehandler og test runner. Den bygde MCP-serveren er Node-kompatibel for distribusjon. Den er også satt opp som lokal Codex MCP med navnet `golfbox`. Codex starter `scripts/run-mcp.mjs`, som leser lokale credentials fra `.env.local` og deretter starter `dist/index.js`.

## Privat deling

Lag en privat pakke for venner slik:

```bash
npm run build:private-release
```

Scriptet lager `release/golfbox-mcp-private-v0.1.0.zip` med:

- `GolfBox MCP.mcpb` for Claude Desktop.
- `golfbox-mcp-codex-plugin.zip` for Codex.
- `INSTALL.md` med korte sluttbrukerinstruksjoner.

Artefaktene kjører lokalt hos brukeren. GolfBox-credentials legges inn på brukerens egen maskin, og booking/kansellering er av som standard.

Serveren bruker stdio-transport og kan legges inn i en MCP-kompatibel agentklient etter build:

```json
{
  "mcpServers": {
    "golfbox": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/golfbox-mcp/dist/index.js"],
      "env": {
        "GOLFBOX_PROVIDER": "mock",
        "GOLFBOX_ENABLE_WRITE_TOOLS": "false"
      }
    }
  }
}
```

Bytt `/ABSOLUTE/PATH/TO/golfbox-mcp` med denne mappen.

## Verktøy

- `golfbox_authenticate`: henter token og validerer det med GolfBox `profile/member`-login.
- `golfbox_list_clubs`: viser klubber adapteren kjenner til.
- `golfbox_search_tee_times`: finner ledige starttider via `resourcesForClub` og `teeTimesForDay`.
- `golfbox_list_bookings`: viser innlogget brukers tee-time-bookinger via `teeTimesForPlayer`.
- `golfbox_prepare_booking`: validerer og oppsummerer en ønsket booking uten å opprette den.
- `golfbox_create_booking`: oppretter booking når write-verktøy er aktivert. Første spiller er den innloggede brukeren; ekstra GolfBox-medlemmer krever `golfId`/medlemsnummer.
- `golfbox_cancel_booking`: kansellerer booking når write-verktøy er aktivert og `bookingId` kommer fra `golfbox_create_booking`.

## Auth mot GolfBox MobileHub

Den offisielle adapteren kan nå hente et MobileHub-token med GolfBox-brukernavn/passord og validere tokenet med `POST /profile/member?methodName=login&country=NO`. Tokenet caches bare i minnet mens MCP-serveren kjører.

Sett hemmeligheter som miljøvariabler i MCP-klienten eller en lokal `.env`-flyt. Ikke lim inn GolfBox-passord i agentchat.

For Codex-oppsettet i denne mappen kan du lagre credentials lokalt slik:

```bash
bun run set-credentials
```

Scriptet spør etter brukernavn og passord i terminalen, skjuler passordet, skriver `.env.local` og setter filrettigheter til `600`.

```json
{
  "mcpServers": {
    "golfbox": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/golfbox-mcp/dist/index.js"],
      "env": {
        "GOLFBOX_PROVIDER": "official",
        "GOLFBOX_USERNAME": "din-bruker",
        "GOLFBOX_PASSWORD": "din-passordhemmelighet",
        "GOLFBOX_COUNTRY": "NO",
        "GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS": "20000",
        "GOLFBOX_REQUEST_TIMEOUT_MS": "15000",
        "GOLFBOX_WEB_REQUEST_TIMEOUT_MS": "15000",
        "GOLFBOX_ALLOW_UNTRUSTED_URLS": "false",
        "GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS": "false",
        "GOLFBOX_ENABLE_WRITE_TOOLS": "false"
      }
    }
  }
}
```

Hvis du allerede har et gyldig MobileHub-token, kan `GOLFBOX_API_TOKEN` brukes i stedet for brukernavn/passord. `golfbox_authenticate` vil da validere tokenet via login-kallet.

## Sikkerhetsmodell

Booking og kansellering er avskrudd som standard med `GOLFBOX_ENABLE_WRITE_TOOLS=false`. Selv når write-verktøy aktiveres, krever booking `confirmedByUser=true`, en eksplisitt bekreftelsestekst og en `idempotencyKey`, slik at agenter ikke utilsiktet sender flere bookinger.

Den offisielle adapteren lagrer idempotency bare i minnet mens MCP-serveren kjører. Hvis booking feiler etter at GolfBox har åpnet en booking-session, prøver adapteren å rydde opp med `deleteSession` og deretter `deleteLock`. Feil fra GolfBox viser nå også hvilket endpoint som feilet, men redakterer `sessionKey`.

Adapteren krever HTTPS og kjente GolfBox-hosts for API/web som standard. `.test`-hoster kan bare brukes med `GOLFBOX_ALLOW_UNTRUSTED_URLS=true` for test/dev. Vanlige API- og webkall har 15 sekunders timeout som standard, styrt av `GOLFBOX_REQUEST_TIMEOUT_MS` og `GOLFBOX_WEB_REQUEST_TIMEOUT_MS`. Respons-body fra feil inkluderes ikke i feilmeldinger som standard; `GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS=true` bør bare brukes ved lokal debugging, og kjente hemmeligheter redakteres fortsatt.

Ved søk bruker adapteren nå `Ressource_GUID` fra `teeTimesForDay` sin XML-`Setup` i `slotId`. Android-klienten bruker samme verdi når den kaller `tryEditTeeTime`, og dette kan være en annen guid enn ressurset som ble brukt for å hente dagvisningen.

Noen tider er åpne i portalgridet selv om GolfBox markerer dem med `touchClosed=1` eller `isTooFarAheadTouch=1`. Søket viser disse tidene, men `golfbox_create_booking` hopper da over MobileHub-låsen og bruker web-portalens `window.asp`-flyt for den innloggede spilleren. Når GolfBox tar imot lagringen og returnerer til starttidsgridet, rapporterer adapteren bookingen som `confirmed`, selv om `teeTimesForPlayer` ikke har rukket å speile bookingen ennå. Ekstra spillere i web-fallbacken er ikke mappet ennå.

`saveTeeTime` har en egen timeout, styrt av `GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS` og satt til 20 sekunder som standard. Adapteren leser save-responsen som rå tekst, slik Android-klienten gjør, og sjekker `teeTimesForPlayer` etterpå. Finner den bookingen der, returneres den som bekreftet; hvis save-kallet ikke svarer tydelig og bookingen heller ikke finnes i listen, returneres `pending` med beskjed om å verifisere i GolfBox før nytt forsøk.

Gjester uten GolfBox-medlemsnummer og betalingsflyt er ikke automatisert ennå. Hvis GolfBox-responsen sier at tee-tiden krever forskuddsbetaling som bekrefter bookingen, stopper adapteren før `saveTeeTime` og rydder opp i tidslåsen. Slike bookinger må håndteres manuelt til betalingskontrakten er avklart.

## Neste steg for ekte GolfBox-integrasjon

1. Skaff offisiell API-dokumentasjon, partneravtale eller teknisk kontakt hos GolfBox/klubb.
2. Avklar autentisering, klubb-/bane-ID-er, rate limits, bookingvinduer, betaling, kanselleringsregler og personvern.
3. Avklar gjeste-booking, handicap-/kjønnsfelter og betaling før disse flytene automatiseres.
4. Kjør en kontrollert test med `GOLFBOX_ENABLE_WRITE_TOOLS=false` for search/prepare, deretter aktiver write-verktøy kun for en eksplisitt testbooking.
