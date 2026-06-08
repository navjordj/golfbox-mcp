import assert from "node:assert/strict";
import { test } from "bun:test";
import { OfficialGolfBoxClient } from "./official-client.js";

interface RecordedFetchRequest {
  method: string;
  url: string;
  headers: Headers;
  body?: string;
}

type FetchHandler = (
  url: URL,
  init: RequestInit,
  headers: Headers,
  body?: string
) => Response | Promise<Response>;

async function withMockFetch(
  handler: FetchHandler,
  run: (requests: RecordedFetchRequest[]) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: RecordedFetchRequest[] = [];

  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : undefined;

    requests.push({
      method: init.method ?? "GET",
      url: url.toString(),
      headers,
      body
    });

    return handler(url, init, headers, body);
  }) as typeof fetch;

  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function textResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/plain" }
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" }
  });
}

function webMineTiderCard(input: {
  date: string;
  time: string;
  club: string;
  course: string;
  resourceGuid: string;
  bookingStart: string;
  players: string[];
}): string {
  return `
    <div class="border border-success bg-selected rounded p-3">
      <div class="d-flex">
        <div class="d-flex justify-content-between flex-column flex-sm-row flex-grow-1">
          <div class="d-flex flex-column w-100">
            <div class="d-flex align-items-center text-capitalize"><div><svg></svg></div>${input.date}</div>
            <div class="d-flex align-items-center mt-3"><div><svg></svg></div>${input.time}</div>
          </div>
          <div class="d-flex flex-column w-100">
            <div class="d-flex align-items-center mt-3 mt-sm-0"><div><svg></svg></div>${input.club}</div>
            <div class="d-flex align-items-center mt-3"><div><svg></svg></div>${input.course}</div>
          </div>
        </div>
        <a href="/site/ressources/booking/grid.asp?makeWindowPop=1&Ressource_GUID=${input.resourceGuid}&Booking_Start=${input.bookingStart}">Gå til tiden</a>
      </div>
      <div class="mt-3">
        ${input.players.map((player) => `<div class="px-2 py-1">${player}</div>`).join("")}
      </div>
    </div>
  `;
}

function responseAfterAbort(signal: RequestInit["signal"]): Promise<Response> {
  const abortSignal = signal as AbortSignal | undefined;
  if (!abortSignal) {
    return Promise.reject(new Error("Expected request to include an AbortSignal."));
  }

  return new Promise((_resolve, reject) => {
    abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

test("official client authenticates and validates token with login", async () => {
  await withMockFetch(
    (url, _init, headers, body) => {
      if (url.pathname === "/authentication") {
        assert.equal(url.searchParams.get("methodName"), "authenticate");
        assert.equal(url.searchParams.get("country"), "NO");
        assert.equal(headers.get("Accept"), "text/plain");
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(body ?? "{}"), {
          Username: "member@example.com",
          Password: "secret"
        });

        return textResponse("token-123456");
      }

      if (url.pathname === "/profile/member") {
        assert.equal(headers.get("Authorization"), "token-123456");
        assert.equal(url.searchParams.get("methodName"), "login");
        assert.equal(url.searchParams.get("country"), "NO");
        return jsonResponse({
          Guid: "user-guid",
          FirstName: "Ada",
          LastName: "Lovelace",
          ClubGuid: "club-guid",
          ClubName: "Oslo Golfklubb",
          MemberNumber: "12345",
          CountryIsoCode: "NO",
          HasAccessToBooking: true,
          UseNewApp: true,
          NewAppSSOToken: "11111111-2222-3333-4444-555555555555"
        });
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "no"
      });

      const status = await client.authenticate();

      assert.equal(status.provider, "official");
      assert.equal(status.authenticated, true);
      assert.equal(status.country, "NO");
      assert.equal(status.tokenSource, "credentials");
      assert.equal(status.tokenPreview, "token-...3456");
      assert.equal(status.tokenLength, "token-123456".length);
      assert.equal(status.validatedWithLogin, true);
      assert.equal(status.user?.guid, "user-guid");
      assert.equal(status.user?.fullName, "Ada Lovelace");
      assert.equal(status.user?.hasAccessToBooking, true);
      assert.equal("newAppSsoToken" in (status.user ?? {}), false);

      assert.equal(requests[0]?.method, "POST");
      assert.match(requests[0]?.url ?? "", /^https:\/\/example\.test\/authentication/);
      assert.match(requests[0]?.headers.get("Client-User-Agent") ?? "", /AppCountry:DK;/);
      assert.match(requests[0]?.headers.get("Client-User-Agent") ?? "", /AppUserCountryNO;/);
      assert.match(requests[0]?.headers.get("Client-User-Agent") ?? "", /AppVersion:2\.7\.003;/);
    }
  );
});

test("official client lists clubs with an authenticated request", async () => {
  await withMockFetch(
    (url, _init, headers) => {
      if (url.pathname === "/authentication") {
        return textResponse("club-token");
      }

      if (url.pathname === "/teeTime/booking") {
        assert.equal(headers.get("Authorization"), "club-token");
        assert.equal(url.searchParams.get("methodName"), "clubsForCountry");
        return jsonResponse([
          {
            Guid: "oslo-guid",
            Name: "Oslo Golfklubb",
            Country: "NO"
          },
          {
            Guid: "baerum-guid",
            Name: "Baerum Golfklubb",
            Country: "NO",
            Region: "Akershus"
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const clubs = await client.listClubs();

      assert.deepEqual(clubs, [
        {
          id: "oslo-guid",
          name: "Oslo Golfklubb",
          country: "NO"
        },
        {
          id: "baerum-guid",
          name: "Baerum Golfklubb",
          country: "NO",
          region: "Akershus"
        }
      ]);
    }
  );
});

test("official client searches tee times from resource day XML", async () => {
  await withMockFetch(
    (url, _init, headers) => {
      if (url.pathname === "/authentication") {
        return textResponse("search-token");
      }

      if (url.pathname === "/profile/member") {
        assert.equal(headers.get("Authorization"), "search-token");
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        assert.equal(headers.get("Authorization"), "search-token");
        assert.equal(url.searchParams.get("clubGuid"), "club-guid");
        return jsonResponse([
          {
            Guid: "resource-1",
            Name: "Hovedbanen"
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        assert.equal(headers.get("Authorization"), "search-token");
        assert.equal(headers.get("Accept"), "application/xml");
        assert.equal(url.searchParams.get("resourceGuid"), "resource-1");
        assert.equal(url.searchParams.get("teeTime"), "20260601");
        assert.equal(url.searchParams.get("memberclubguid"), "member-club-guid");

        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="booking-resource-1" Ressource_Name="Hovedbanen" />
            <slot time="07:50" expired="false" portalClosed="false" touchClosed="false" isBlank="false" ymPrice="750">
              <slotnode BookingGuid="booking-1" MemberName="Booked Player" />
            </slot>
            <slot time="08:10" portalClosed="true" />
            <slot time="08:30" isBlank="false">
              <slotnode BookingGuid="booking-2" />
              <slotnode BookingGuid="booking-3" />
              <slotnode BookingGuid="booking-4" />
            </slot>
            <slot time="09:20" isBlank="false" />
          </root>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const slots = await client.searchTeeTimes({
        clubId: "club-guid",
        date: "2026-06-01",
        players: 2,
        earliestTime: "07:00",
        latestTime: "09:00"
      });

      assert.deepEqual(slots, [
        {
          slotId: "booking-resource-1|20260601T075000|member-club-guid",
          clubId: "club-guid",
          courseName: "Hovedbanen",
          startsAt: "2026-06-01T07:50:00+02:00",
          holes: 18,
          availableSpots: 3,
          priceNok: 750
        }
      ]);
    }
  );
});

test("official client searches tee-sheet player names from resource day XML", async () => {
  await withMockFetch(
    (url, _init, headers) => {
      if (url.pathname === "/authentication") {
        return textResponse("player-search-token");
      }

      if (url.pathname === "/profile/member") {
        assert.equal(headers.get("Authorization"), "player-search-token");
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        assert.equal(headers.get("Authorization"), "player-search-token");
        return jsonResponse([
          {
            Guid: "resource-1",
            Name: "Grini Golfbane"
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        assert.equal(headers.get("Authorization"), "player-search-token");
        assert.equal(headers.get("Accept"), "application/xml");
        assert.equal(url.searchParams.get("resourceGuid"), "resource-1");
        assert.equal(url.searchParams.get("teeTime"), "20260609");
        assert.equal(url.searchParams.get("memberclubguid"), "member-club-guid");

        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="booking-resource-1" Ressource_Name="Grini Golfbane" />
            <slot time="08:10">
              <slotnode BookingGuid="booking-1" MemberName="Other Player" />
            </slot>
            <slot time="16:40">
              <slotnode BookingGuid="booking-2" MemberName="Jonas Fagermo" />
            </slot>
          </root>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const matches = await client.searchTeeTimePlayers({
        clubId: "club-guid",
        date: "2026-06-09",
        query: "fagermo"
      });

      assert.deepEqual(matches, [
        {
          slotId: "booking-resource-1|20260609T164000|member-club-guid",
          clubId: "club-guid",
          courseName: "Grini Golfbane",
          startsAt: "2026-06-09T16:40:00+02:00",
          playerName: "Jonas Fagermo",
          matchedText: "Jonas Fagermo booking-2",
          source: "teeTimesForDay"
        }
      ]);
    }
  );
});

test("official client falls back to web tee-sheet player search when MobileHub hides names", async () => {
  await withMockFetch(
    (url, _init, headers, body) => {
      if (url.hostname === "example.test" && url.pathname === "/authentication") {
        return textResponse("player-web-token");
      }

      if (url.hostname === "example.test" && url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "resourcesForClub"
      ) {
        return jsonResponse([
          {
            Guid: "resource-mobile",
            Name: "Grini Golfbane"
          }
        ]);
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "teeTimesForDay"
      ) {
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="resource-mobile" Ressource_Name="Grini Golfbane" />
            <slot time="16:40">
              <slotnode BookingGuid="booking-2" Description="Private booking" />
            </slot>
          </root>
        `);
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return textResponse("<html>Login</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp") {
        return new Response("", {
          status: 302,
          headers: {
            Location: "/site/ressources/booking/grid.asp",
            "Set-Cookie": "ASPUniqueID=session-1; path=/"
          }
        });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Logged in</html>");
      }

      if (
        url.hostname === "web.example.test" &&
        url.pathname === "/site/my_golfbox/ressources/booking/grid.asp" &&
        _init.method !== "POST"
      ) {
        return textResponse(`
          <input type="hidden" name="command" value="" />
          <input type="hidden" name="commandValue" value="" />
          <select name="ddlClub">
            <option value="">Velg klubb</option>
            <option value="club-guid">Grini Golfklubb</option>
          </select>
          <input name="BookingDate" value="08.06.2026" />
        `);
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/my_golfbox/ressources/booking/grid.asp") {
        const params = new URLSearchParams(body ?? "");
        if (params.get("command") === "getClub") {
          assert.equal(params.get("ddlClub"), "club-guid");
          return textResponse(`
            <input type="hidden" name="command" value="" />
            <input type="hidden" name="commandValue" value="" />
            <select name="ddlClub"><option value="club-guid" selected>Grini Golfklubb</option></select>
            <select name="ddlRessource_GUID">
              <option value="{resource-web}" selected>Grini Golfklubb - Grini Golfbane</option>
            </select>
            <input name="BookingDate" value="08.06.2026" />
          `);
        }

        if (params.get("command") === "changeRessource") {
          return textResponse(`
            <input type="hidden" name="command" value="" />
            <input type="hidden" name="commandValue" value="" />
            <select name="ddlClub"><option value="club-guid" selected>Grini Golfklubb</option></select>
            <select name="ddlRessource_GUID">
              <option value="{resource-web}" selected>Grini Golfklubb - Grini Golfbane</option>
            </select>
            <input name="BookingDate" value="08.06.2026" />
          `);
        }

        if (params.get("command") === "calendar1_select") {
          assert.equal(params.get("commandValue"), "20260609T000000");
          assert.equal(params.get("BookingDate"), "09.06.2026");
          assert.equal(params.get("chkShow_Names"), "1");
          return textResponse(`
            <div class="d-flex list-row hour full">
              <div class="timecell">16:40</div>
              <div onclick="showWindow('20260609T164000', '0','0')" class="time-players flex-grow-1 pointer">
                <div class="fw-bold">Jonas Fagermo</div>
              </div>
            </div>
          `);
        }
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const matches = await client.searchTeeTimePlayers({
        clubId: "club-guid",
        date: "2026-06-09",
        query: "Fagermo"
      });

      assert.deepEqual(matches, [
        {
          slotId: "resource-web|20260609T164000|member-club-guid",
          clubId: "club-guid",
          courseName: "Grini Golfklubb - Grini Golfbane",
          startsAt: "2026-06-09T16:40:00+02:00",
          playerName: "Jonas Fagermo",
          matchedText: "Jonas Fagermo",
          source: "webPortal"
        }
      ]);
    }
  );
});

test("official client falls back to web resource selection and keeps mobile-open slots", async () => {
  await withMockFetch(
    (url, _init, headers, body) => {
      if (url.hostname === "example.test" && url.pathname === "/authentication") {
        return textResponse("fallback-token");
      }

      if (url.hostname === "example.test" && url.pathname === "/profile/member") {
        assert.equal(headers.get("Authorization"), "fallback-token");
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "resourcesForClub"
      ) {
        return jsonResponse([]);
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return textResponse("<html>Login</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp") {
        assert.equal(_init.method, "POST");
        assert.match(body ?? "", /loginform\.username=member%40example\.com/);
        assert.match(body ?? "", /loginform\.password=secret/);
        return new Response("", {
          status: 302,
          headers: {
            Location: "/site/ressources/booking/grid.asp",
            "Set-Cookie": "ASPUniqueID=session-1; path=/"
          }
        });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Logged in</html>");
      }

      if (
        url.hostname === "web.example.test" &&
        url.pathname === "/site/my_golfbox/ressources/booking/grid.asp"
      ) {
        assert.equal(url.searchParams.get("Club_GUID"), "{CLUB-GUID}");
        return textResponse(`
          <select name="ddlRessource_GUID">
            <option value="x">Velg fasilitet</option>
            <option value="{resource-web}" selected="selected">Fallback Course</option>
          </select>
        `);
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "teeTimesForDay"
      ) {
        assert.equal(url.searchParams.get("resourceGuid"), "resource-web");
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_Name="Fallback Course" />
            <slot
              time="10:20"
              portalClosed="0"
              touchClosed="0"
              expired="0"
              isTooFarAheadPortal="0"
              isTooFarAheadTouch="0"
              isBlank="false"
              ymPrice="795"
            />
          </root>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const slots = await client.searchTeeTimes({
        clubId: "club-guid",
        date: "2026-06-01",
        players: 4
      });

      assert.deepEqual(slots, [
        {
          slotId: "resource-web|20260601T102000|member-club-guid",
          clubId: "club-guid",
          courseName: "Fallback Course",
          startsAt: "2026-06-01T10:20:00+02:00",
          holes: 18,
          availableSpots: 4,
          priceNok: 795
        }
      ]);
    }
  );
});

test("official client keeps portal-open slots even when touch flags are set", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("search-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        return jsonResponse([
          {
            Guid: "resource-1",
            Name: "Hovedbanen"
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="resource-1" Ressource_Name="Hovedbanen" />
            <slot time="20260601T145700" portalClosed="0" touchClosed="0" isTooFarAheadPortal="0" isTooFarAheadTouch="1" isBlank="false" />
            <slot time="20260601T150600" portalClosed="0" touchClosed="1" isTooFarAheadPortal="0" isTooFarAheadTouch="0" isBlank="false" />
            <slot time="20260601T151500" portalClosed="0" touchClosed="0" isTooFarAheadPortal="0" isTooFarAheadTouch="0" isBlank="false" />
          </root>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const slots = await client.searchTeeTimes({
        clubId: "club-guid",
        date: "2026-06-01",
        players: 1,
        earliestTime: "14:00",
        latestTime: "16:00"
      });

      assert.deepEqual(slots.map((slot) => slot.startsAt), [
        "2026-06-01T14:57:00+02:00",
        "2026-06-01T15:06:00+02:00",
        "2026-06-01T15:15:00+02:00"
      ]);
    }
  );
});

test("official client keeps future slots that GolfBox lists before portal booking opens", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("search-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        return jsonResponse([
          {
            Guid: "resource-1",
            Name: "Hovedbanen"
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="resource-1" Ressource_Name="Hovedbanen" />
            <slot time="20260620T070000" portalClosed="0" touchClosed="0" isTooFarAheadPortal="1" isTooFarAheadTouch="1" isBlank="false" ymPrice="845" />
            <slot time="20260620T070900" portalClosed="1" touchClosed="0" isTooFarAheadPortal="0" isTooFarAheadTouch="0" isBlank="false" />
          </root>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const slots = await client.searchTeeTimes({
        clubId: "club-guid",
        date: "2026-06-20",
        players: 1,
        earliestTime: "07:00",
        latestTime: "08:00"
      });

      assert.deepEqual(slots, [
        {
          slotId: "resource-1|20260620T070000|member-club-guid",
          clubId: "club-guid",
          courseName: "Hovedbanen",
          startsAt: "2026-06-20T07:00:00+02:00",
          holes: 18,
          availableSpots: 4,
          priceNok: 845,
          notes: ["GolfBox lists this future tee time, but portal booking is not open yet."]
        }
      ]);
    }
  );
});

test("official client lists authenticated player bookings", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            ResourceGuid: "resource-1",
            ResourceName: "Hovedbanen",
            TeeTime: "20260601T081000",
            BookingGroupGuid: "group-1",
            Players: [
              {
                BookingGuid: "booking-1",
                Confirmable: true,
                Confirmed: false
              }
            ]
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const bookings = await client.listBookings();

      assert.deepEqual(bookings, [
        {
          bookingId: "resource-1|20260601T081000|member-club-guid",
          status: "pending",
          slotId: "resource-1|20260601T081000|member-club-guid",
          summary: "Hovedbanen: 2026-06-01 08:10 for 1 player. GolfBox reference: group-1."
        }
      ]);
    }
  );
});

test("official client maps lower-camel player bookings", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            resourceGuid: "resource-1",
            resourceName: "Hovedbanen",
            teeTime: "2026-06-01T08:10:00",
            bookingGroupGuid: "group-1",
            players: [
              {
                bookingGuid: "booking-1",
                confirmable: true,
                confirmed: false
              }
            ]
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const bookings = await client.listBookings();

      assert.deepEqual(bookings, [
        {
          bookingId: "resource-1|20260601T081000|member-club-guid",
          status: "pending",
          slotId: "resource-1|20260601T081000|member-club-guid",
          summary: "Hovedbanen: 2026-06-01 08:10 for 1 player. GolfBox reference: group-1."
        }
      ]);
    }
  );
});

test("official client maps upcoming tee times from lower-camel teeTimesForPlayer across clubs", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Ada Lovelace",
          ClubGuid: "member-club-guid",
          ClubName: "Onsøy Golfklubb",
          MemberNumber: "20-11297",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            clubGuid: "baerum-club-guid",
            clubName: "Bærum Golfklubb",
            resourceGuid: "baerum-resource",
            resourceName: "Bærum Golfbane 18 hull",
            teeTime: "2026-06-07T09:00:00",
            players: [
              {
                memberGuid: "other-player-guid",
                memberNumber: "102-14007",
                firstName: "Adrian",
                lastName: "Moksness",
                clubName: "Preikestolen Golfklubb",
                confirmed: true
              },
              {
                memberGuid: "user-guid",
                memberNumber: "20-11297",
                firstName: "Ada",
                lastName: "Lovelace",
                clubName: "Onsøy Golfklubb",
                confirmable: true,
                confirmed: false
              }
            ]
          },
          {
            clubGuid: "onsoy-club-guid",
            clubName: "Onsøy Golfklubb",
            resourceGuid: "onsoy-resource",
            resourceName: "18 hulls banen",
            teeTime: "20260618T195400",
            players: [
              {
                memberGuid: "user-guid",
                memberNumber: "20-11297",
                fullName: "Ada Lovelace",
                clubName: "Onsøy Golfklubb",
                confirmed: true
              }
            ]
          },
          {
            clubGuid: "old-club-guid",
            clubName: "Old Golfklubb",
            resourceGuid: "old-resource",
            resourceName: "Old Course",
            teeTime: "20260501T090000",
            players: []
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        throw new Error("resourcesForClub should not be called when teeTimesForPlayer returns upcoming tee times.");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const teeTimes = await client.listUpcomingTeeTimes({ fromDate: "2026-06-04" });

      assert.deepEqual(
        teeTimes.map((teeTime) => ({
          slotId: teeTime.slotId,
          startsAt: teeTime.startsAt,
          clubName: teeTime.clubName,
          courseName: teeTime.courseName,
          source: teeTime.source,
          playerCount: teeTime.playerCount,
          currentUser: teeTime.players.find((player) => player.isCurrentUser)?.name
        })),
        [
          {
            slotId: "baerum-resource|20260607T090000|member-club-guid",
            startsAt: "2026-06-07T09:00:00+02:00",
            clubName: "Bærum Golfklubb",
            courseName: "Bærum Golfbane 18 hull",
            source: "teeTimesForPlayer",
            playerCount: 2,
            currentUser: "Ada Lovelace"
          },
          {
            slotId: "onsoy-resource|20260618T195400|member-club-guid",
            startsAt: "2026-06-18T19:54:00+02:00",
            clubName: "Onsøy Golfklubb",
            courseName: "18 hulls banen",
            source: "teeTimesForPlayer",
            playerCount: 1,
            currentUser: "Ada Lovelace"
          }
        ]
      );
    }
  );
});

test("official client treats upcoming club IDs as filters, not day-grid scan hints", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Ada Lovelace",
          ClubGuid: "member-club-guid",
          ClubName: "Onsøy Golfklubb",
          MemberNumber: "20-11297",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            clubGuid: "baerum-club-guid",
            clubName: "Bærum Golfklubb",
            resourceGuid: "baerum-resource",
            resourceName: "Bærum Golfbane 18 hull",
            teeTime: "20260607T090000",
            players: [{ memberGuid: "user-guid", memberNumber: "20-11297", fullName: "Ada Lovelace" }]
          },
          {
            clubGuid: "onsoy-club-guid",
            clubName: "Onsøy Golfklubb",
            resourceGuid: "onsoy-resource",
            resourceName: "18 hulls banen",
            teeTime: "20260618T195400",
            players: [{ memberGuid: "user-guid", memberNumber: "20-11297", fullName: "Ada Lovelace" }]
          }
        ]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        throw new Error("resourcesForClub should not be called by the upcoming private tee-times tool.");
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        throw new Error("teeTimesForDay should not be called by the upcoming private tee-times tool.");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const teeTimes = await client.listUpcomingTeeTimes({
        fromDate: "2026-06-04",
        clubIds: ["baerum-club-guid"]
      });

      assert.deepEqual(teeTimes.map((teeTime) => teeTime.clubName), ["Bærum Golfklubb"]);
    }
  );
});

test("official client returns empty when teeTimesForPlayer has no upcoming private tee times", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Ada Lovelace",
          ClubGuid: "member-club-guid",
          MemberNumber: "20-11297",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "resourcesForClub") {
        throw new Error("resourcesForClub should not be called by the upcoming private tee-times tool.");
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        throw new Error("teeTimesForDay should not be called by the upcoming private tee-times tool.");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      assert.deepEqual(await client.listUpcomingTeeTimes({ fromDate: "2026-06-07", daysAhead: 1 }), []);
    }
  );
});

test("official client does not silently return empty upcoming tee times for useNewApp accounts", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          MemberNumber: "20-11297",
          HasAccessToBooking: true,
          UseNewApp: true,
          NewAppSSOToken: "11111111-2222-3333-4444-555555555555"
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/appLogic" && url.searchParams.get("methodName") === "validateClientv3") {
        return jsonResponse({
          ClientIsValid: true,
          FrontPageURL: "http://www.golfbox.no//external/internationalLogin/receiveSSO.asp?token=(tokenGuid)",
          TeeTimeURL:
            "http://www.golfbox.no//external/internationalLogin/receiveSSO.asp?token=(tokenGuid)&rURL=/site/my_golfbox/ressources/booking/grid.asp?Ressource_GUID=(resourceGuid)&Booking_Start=(teeTime)"
        });
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      await assert.rejects(
        () => client.listUpcomingTeeTimes({ fromDate: "2026-06-07", daysAhead: 1 }),
        /Gimmie\/new-app API support is required/
      );
    }
  );
});

test("official client maps upcoming tee times from authenticated Gimmie new-app flow", async () => {
  await withMockFetch(
    (url, init, headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Ada Lovelace",
          ClubGuid: "member-club-guid",
          MemberNumber: "20-11297",
          HasAccessToBooking: true,
          UseNewApp: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/appLogic" && url.searchParams.get("methodName") === "validateClientv3") {
        return jsonResponse({
          ClientIsValid: true,
          FrontPageURL: "http://www.golfbox.no//external/internationalLogin/receiveSSO.asp?token=(tokenGuid)"
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/graphql") {
        const payload = JSON.parse(body ?? "{}") as { query?: string };
        if (payload.query?.includes("initGolfboxOauth")) {
          return jsonResponse({
            data: {
              initGolfboxOauth: "https://auth.golfbox.io/connect/authorize?client_id=GLFR_no"
            }
          });
        }

        if (payload.query?.includes("continueWithAuth")) {
          return jsonResponse({
            data: {
              continueWithAuth: {
                id: "gimmie-user",
                otp: "gimmie-otp"
              }
            }
          });
        }

        if (payload.query?.includes("authMe")) {
          return jsonResponse({
            data: {
              AuthQueries: {
                authMe: {
                  token: "gimmie-token"
                }
              }
            }
          });
        }

        if (payload.query?.includes("teeTimesWithProviders")) {
          assert.equal(headers.get("x-auth-token"), "gimmie-token");
          return jsonResponse({
            data: {
              teeTimesWithProviders: [
                {
                  bookingId: "booking-1",
                  teeTime: "2026-06-07T09:00:00+02:00",
                  clubName: "Bærum Golfklubb",
                  guideName: "Bærum Golfbane 18 hull",
                  org: "NGF",
                  players: [{ memberId: "20-11297", name: "Ada Lovelace" }]
                }
              ]
            }
          });
        }
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/Login?ReturnUrl=%2Fconnect%2Fauthorize%2Fcallback" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "GET") {
        return new Response(
          '<form method="post"><input name="ReturnUrl" value="/connect/authorize/callback?x=1&amp;y=2"><input name="__RequestVerificationToken" value="csrf"></form>',
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/connect/authorize/callback?code=oauth-code" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize/callback") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://be.glfr.com/oauth/golfbox?code=oauth-code" }
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/oauth/golfbox") {
        return new Response("", {
          status: 303,
          headers: { Location: "com.glfr.ngf://NGF/provider-token" }
        });
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const teeTimes = await client.listUpcomingTeeTimes({ fromDate: "2026-06-05", daysAhead: 28 });
      assert.deepEqual(teeTimes, [
        {
          slotId: "gimmie|NGF|booking-1",
          startsAt: "2026-06-07T09:00:00+02:00",
          clubName: "Bærum Golfklubb",
          courseName: "Bærum Golfbane 18 hull",
          status: "pending",
          playerCount: 1,
          players: [{ name: "Ada Lovelace", memberNumber: "20-11297", isCurrentUser: true }],
          source: "gimmie",
          summary: "Bærum Golfbane 18 hull: 2026-06-07T09:00:00+02:00 for 1 player."
        }
      ]);
    }
  );
});

test("official client falls back to web Mine tider when UseNewApp MobileHub and Gimmie are empty", async () => {
  await withMockFetch(
    (url, init, headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Christoffer Jahren",
          ClubGuid: "member-club-guid",
          MemberNumber: "20-11297",
          HasAccessToBooking: true,
          UseNewApp: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/appLogic" && url.searchParams.get("methodName") === "validateClientv3") {
        return jsonResponse({
          ClientIsValid: true,
          FrontPageURL: "http://www.golfbox.no//external/internationalLogin/receiveSSO.asp?token=(tokenGuid)"
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/graphql") {
        const payload = JSON.parse(body ?? "{}") as { query?: string };
        if (payload.query?.includes("initGolfboxOauth")) {
          return jsonResponse({
            data: {
              initGolfboxOauth: "https://auth.golfbox.io/connect/authorize?client_id=GLFR_no"
            }
          });
        }

        if (payload.query?.includes("continueWithAuth")) {
          return jsonResponse({
            data: {
              continueWithAuth: {
                id: "gimmie-user",
                otp: "gimmie-otp"
              }
            }
          });
        }

        if (payload.query?.includes("authMe")) {
          return jsonResponse({
            data: {
              AuthQueries: {
                authMe: {
                  token: "gimmie-token"
                }
              }
            }
          });
        }

        if (payload.query?.includes("teeTimesWithProviders")) {
          assert.equal(headers.get("x-auth-token"), "gimmie-token");
          return jsonResponse({
            data: {
              teeTimesWithProviders: []
            }
          });
        }
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/Login?ReturnUrl=%2Fconnect%2Fauthorize%2Fcallback" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "GET") {
        return new Response(
          '<form method="post"><input name="ReturnUrl" value="/connect/authorize/callback?x=1&amp;y=2"><input name="__RequestVerificationToken" value="csrf"></form>',
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/connect/authorize/callback?code=oauth-code" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize/callback") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://be.glfr.com/oauth/golfbox?code=oauth-code" }
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/oauth/golfbox") {
        return new Response("", {
          status: 303,
          headers: { Location: "com.glfr.ngf://NGF/provider-token" }
        });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return new Response("", {
          status: 302,
          headers: { Location: "/login.asp" }
        });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp" && init.method === "POST") {
        return textResponse("<html>Logged in</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Grid</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/my_golfbox/ressources/booking/grid.asp") {
        return textResponse(`
          <a href="/site/ressources/booking/autoselect_ressource.asp">Starttidsbestilling</a>
          <a title="Mine tider" href="/site/my_golfBox/myTimes/myTimes.asp?selected={317B9D5E-1D76-4330-8BAC-2D3966D8D0EB}">Mine tider</a>
        `);
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/my_golfBox/myTimes/myTimes.asp") {
        return textResponse(`
          <form name="frmPageForm">
            <div class="card mb-4">
              <div class="card-header"><h3>Mine tider</h3></div>
              <div class="card-body border-bottom">
                ${webMineTiderCard({
                  date: "lørdag 06.06.2026",
                  time: "08:03",
                  club: "Onsøy Golfklubb",
                  course: "18 hulls banen",
                  resourceGuid: "{884D570B-7F66-4ECD-88E2-215E3B386422}",
                  bookingStart: "20260606T080300",
                  players: [
                    "1 Christoffer Jahren 20-11297 Onsøy Golfklubb +1,2 bestilt",
                    "2 Stian Knudsen 20-11218 Onsøy Golfklubb 3,7 bestilt"
                  ]
                })}
                ${webMineTiderCard({
                  date: "søndag 07.06.2026",
                  time: "09:00",
                  club: "Bærum Golfklubb",
                  course: "Bærum Golfbane 18 hull",
                  resourceGuid: "{BAERUM-RESOURCE}",
                  bookingStart: "20260607T090000",
                  players: [
                    "1 Adrian Moksness 102-14007 Preikestolen Golfklubb 7,5 bestilt",
                    "2 Andreas Aardal Hanssen 8-1558 Bærum Golfklubb 23,2 bestilt"
                  ]
                })}
              </div>
            </div>
            <div class="card mb-4">
              <div class="card-header"><h3>Mine turneringer</h3></div>
              <div class="card-body">
                ${webMineTiderCard({
                  date: "lørdag 20.06.2026",
                  time: "10:00",
                  club: "Romerike GK",
                  course: "Østlandstour 4",
                  resourceGuid: "{TOURNAMENT-RESOURCE}",
                  bookingStart: "20260620T100000",
                  players: []
                })}
              </div>
            </div>
          </form>
        `);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const teeTimes = await client.listUpcomingTeeTimes({ fromDate: "2026-06-05", daysAhead: 21 });

      assert.deepEqual(teeTimes.map((teeTime) => teeTime.startsAt), [
        "2026-06-06T08:03:00+02:00",
        "2026-06-07T09:00:00+02:00"
      ]);
      assert.deepEqual(teeTimes[0], {
        slotId: "884D570B-7F66-4ECD-88E2-215E3B386422|20260606T080300|member-club-guid",
        startsAt: "2026-06-06T08:03:00+02:00",
        clubName: "Onsøy Golfklubb",
        courseName: "18 hulls banen",
        status: "confirmed",
        playerCount: 2,
        players: [
          { name: "Christoffer Jahren", memberNumber: "20-11297", clubName: "Onsøy Golfklubb", confirmed: true, isCurrentUser: true },
          { name: "Stian Knudsen", memberNumber: "20-11218", clubName: "Onsøy Golfklubb", confirmed: true }
        ],
        source: "webPortal",
        summary: "18 hulls banen: 2026-06-06T08:03:00+02:00 for 2 players."
      });
      assert.equal(teeTimes.some((teeTime) => teeTime.courseName === "Østlandstour 4"), false);
    }
  );
});

test("official client reports web portal fallback failure for empty UseNewApp lookups", async () => {
  await withMockFetch(
    (url, init, _headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("upcoming-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          FullName: "Christoffer Jahren",
          ClubGuid: "member-club-guid",
          MemberNumber: "20-11297",
          HasAccessToBooking: true,
          UseNewApp: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/appLogic" && url.searchParams.get("methodName") === "validateClientv3") {
        return jsonResponse({
          ClientIsValid: true,
          FrontPageURL: "http://www.golfbox.no//external/internationalLogin/receiveSSO.asp?token=(tokenGuid)"
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/graphql") {
        const payload = JSON.parse(body ?? "{}") as { query?: string };
        if (payload.query?.includes("initGolfboxOauth")) {
          return jsonResponse({ data: { initGolfboxOauth: "https://auth.golfbox.io/connect/authorize?client_id=GLFR_no" } });
        }
        if (payload.query?.includes("continueWithAuth")) {
          return jsonResponse({ data: { continueWithAuth: { id: "gimmie-user", otp: "gimmie-otp" } } });
        }
        if (payload.query?.includes("authMe")) {
          return jsonResponse({ data: { AuthQueries: { authMe: { token: "gimmie-token" } } } });
        }
        if (payload.query?.includes("teeTimesWithProviders")) {
          return jsonResponse({ data: { teeTimesWithProviders: [] } });
        }
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/Login?ReturnUrl=%2Fconnect%2Fauthorize%2Fcallback" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "GET") {
        return new Response(
          '<form method="post"><input name="ReturnUrl" value="/connect/authorize/callback"><input name="__RequestVerificationToken" value="csrf"></form>',
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/Login" && init.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://auth.golfbox.io/connect/authorize/callback?code=oauth-code" }
        });
      }

      if (url.hostname === "auth.golfbox.io" && url.pathname === "/connect/authorize/callback") {
        return new Response("", {
          status: 302,
          headers: { Location: "https://be.glfr.com/oauth/golfbox?code=oauth-code" }
        });
      }

      if (url.hostname === "be.glfr.com" && url.pathname === "/oauth/golfbox") {
        return new Response("", {
          status: 303,
          headers: { Location: "com.glfr.ngf://NGF/provider-token" }
        });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return new Response("", { status: 302, headers: { Location: "/login.asp" } });
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp" && init.method === "POST") {
        return textResponse("<html>Logged in</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Grid</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/my_golfbox/ressources/booking/grid.asp") {
        return textResponse("<html>No my times link</html>");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      await assert.rejects(
        () => client.listUpcomingTeeTimes({ fromDate: "2026-06-05", daysAhead: 21 }),
        /Web portal fallback failed: GolfBox web portal did not expose a Mine tider link/
      );
    }
  );
});

test("official client uses a 90-day default upcoming window capped at 180 days", async () => {
  async function listVisibleTimes(daysAhead?: number): Promise<string[]> {
    let playerRequests = 0;
    let visibleStartsAt: string[] = [];

    await withMockFetch(
      (url) => {
        if (url.pathname === "/authentication") {
          return textResponse("upcoming-token");
        }

        if (url.pathname === "/profile/member") {
          return jsonResponse({
            Guid: "user-guid",
            ClubGuid: "member-club-guid",
            MemberNumber: "20-11297",
            HasAccessToBooking: true
          });
        }

        if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
          playerRequests += 1;
          return jsonResponse([
            {
              clubGuid: "member-club-guid",
              clubName: "Onsøy Golfklubb",
              resourceGuid: "resource-1",
              resourceName: "Hovedbanen",
              teeTime: "20260829T090000",
              players: [{ memberGuid: "user-guid" }]
            },
            {
              clubGuid: "member-club-guid",
              clubName: "Onsøy Golfklubb",
              resourceGuid: "resource-2",
              resourceName: "Hovedbanen",
              teeTime: "20260905T090000",
              players: [{ memberGuid: "user-guid" }]
            },
            {
              clubGuid: "member-club-guid",
              clubName: "Onsøy Golfklubb",
              resourceGuid: "resource-3",
              resourceName: "Hovedbanen",
              teeTime: "20261201T090000",
              players: [{ memberGuid: "user-guid" }]
            }
          ]);
        }

        return new Response("", { status: 404 });
      },
      async () => {
        const client = new OfficialGolfBoxClient({
          apiBaseUrl: "https://example.test/",
          allowUntrustedGolfBoxUrls: true,
          username: "member@example.com",
          password: "secret",
          country: "NO"
        });

        const teeTimes = await client.listUpcomingTeeTimes({ fromDate: "2026-06-01", daysAhead });
        assert.equal(playerRequests, 1);
        visibleStartsAt = teeTimes.map((teeTime) => teeTime.startsAt);
      }
    );

    return visibleStartsAt;
  }

  assert.deepEqual(await listVisibleTimes(), ["2026-08-29T09:00:00+02:00"]);
  assert.deepEqual(await listVisibleTimes(999), [
    "2026-08-29T09:00:00+02:00",
    "2026-09-05T09:00:00+02:00"
  ]);
});

test("official client lists authenticated player tournaments", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("tournament-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/tournament" && url.searchParams.get("methodName") === "tournamentsForPlayer") {
        return jsonResponse({
          SearchFrom: "20250604T073105",
          SearchTo: "20270604T073105",
          Tournaments: [
            {
              CompetitionId: 5329410,
              CustomerName: "Norwegian Golf Federation",
              EndDate: "20260614T000000",
              Name: "Summer Cup",
              StartDate: "20260613T000000"
            }
          ]
        });
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const tournaments = await client.listTournaments();

      assert.deepEqual(tournaments, [
        {
          tournamentId: "5329410",
          name: "Summer Cup",
          organizer: "Norwegian Golf Federation",
          startsAt: "2026-06-13T00:00:00+02:00",
          endsAt: "2026-06-14T00:00:00+02:00"
        }
      ]);
    }
  );
});

test("official client creates booking via try-edit and save", async () => {
  const slotId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url, _init, headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        assert.equal(headers.get("Authorization"), "booking-token");
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        assert.equal(_init.method, "POST");
        assert.equal(headers.get("Authorization"), "booking-token");
        assert.deepEqual(JSON.parse(body ?? "{}"), {
          ResourceGuid: "resource-1",
          TeeTime: "20260601T081000",
          MemberClubGuid: "member-club-guid"
        });

        return jsonResponse({
          SessionKey: "session-1",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        assert.equal(_init.method, "GET");
        assert.equal(url.searchParams.get("sessionKey"), "session-1");
        return textResponse("");
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            ResourceGuid: "resource-1",
            ResourceName: "Hovedbanen",
            TeeTime: "20260601T081000",
            BookingGroupGuid: "group-1",
            Players: [
              {
                BookingGuid: "booking-1",
                Confirmable: false,
                Confirmed: true
              }
            ]
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const request = {
        slotId,
        players: [{ name: "Ada Lovelace" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "booking-key-1"
      };

      const booking = await client.createBooking(request);
      const replayedBooking = await client.createBooking(request);

      assert.deepEqual(booking, {
        bookingId: slotId,
        status: "confirmed",
        slotId,
        summary: "GolfBox booking saved for 1 player at 2026-06-01 08:10. GolfBox reference: group-1."
      });
      assert.deepEqual(replayedBooking, booking);
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "tryEditTeeTime")
          .length,
        1
      );
    }
  );
});

test("official client refuses booking when listed future slot is not open in the portal yet", async () => {
  const slotId = "resource-1|20260620T070000|member-club-guid";

  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="resource-1" Ressource_Name="Hovedbanen" />
            <slot time="20260620T070000" portalClosed="0" touchClosed="0" isTooFarAheadPortal="1" isTooFarAheadTouch="1" isBlank="false" />
          </root>
        `);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        throw new Error("tryEditTeeTime should not be called for portal-too-far-ahead slots.");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      await assert.rejects(
        () =>
          client.createBooking({
            slotId,
            players: [{ name: "Ada Lovelace" }],
            confirmedByUser: true,
            confirmationText: "Book this tee time",
            idempotencyKey: "booking-key-future"
          }),
        /booking is not open yet/
      );
    }
  );
});

test("official client confirms web portal booking when GolfBox returns to the grid", async () => {
  const slotId = "resource-1|20260601T145700|member-club-guid";

  await withMockFetch(
    (url, _init, _headers, body) => {
      if (url.hostname === "example.test" && url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.hostname === "example.test" && url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "teeTimesForDay"
      ) {
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="resource-1" Club_GUID="club-guid" Ressource_Name="Hovedbanen" />
            <slot time="20260601T145700" portalClosed="0" touchClosed="0" isTooFarAheadPortal="0" isTooFarAheadTouch="1" isBlank="false" />
          </root>
        `);
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return textResponse("");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp") {
        assert.equal(_init.method, "POST");
        assert.match(body ?? "", /loginform\.password=secret/);
        return textResponse("");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Logged in</html>");
      }

      if (
        url.hostname === "web.example.test" &&
        url.pathname === "/site/my_golfbox/ressources/booking/window.asp"
      ) {
        if (_init.method === "POST") {
          const params = new URLSearchParams(body);
          assert.equal(params.get("command"), "next");
          assert.equal(params.get("commandValue"), "");
          assert.equal(params.get("guid_0"), "{user-guid}");
          return textResponse("<div id=\"bookingGridv3\">Grid</div>");
        }

        assert.equal(url.searchParams.get("Ressource_GUID"), "{RESOURCE-1}");
        assert.equal(url.searchParams.get("Booking_Start"), "20260601T145700");
        assert.equal(url.searchParams.get("club_GUID"), "{CLUB-GUID}");
        return textResponse(`
          <form name="frmPageForm" method="post">
            <h3>Bestill starttid</h3>
            <input type="hidden" name="command" value="" />
            <input type="hidden" name="commandValue" value="" />
            <input type="hidden" name="guid_0" value="{user-guid}" />
            <input type="text" name="txt_MemberClubID_1" value="" />
            <button type="button" onclick="cmdSubmit_Click(false, 99)" id="cmdSubmit">Lagre</button>
            <script>function cmdSubmit_Click(search, index) {}</script>
          </form>
        `);
      }

      if (
        url.hostname === "example.test" &&
        url.pathname === "/teeTime/booking" &&
        url.searchParams.get("methodName") === "teeTimesForPlayer"
      ) {
        return jsonResponse([]);
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const booking = await client.createBooking({
        slotId,
        players: [{ name: "Ada Lovelace" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "web-booking-key-1"
      });

      assert.deepEqual(booking, {
        bookingId: slotId,
        status: "confirmed",
        slotId,
        summary:
          "GolfBox web portal confirmed booking for 1 player at 2026-06-01 14:57. The booking was accepted and GolfBox returned to the start-time grid."
      });
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "tryEditTeeTime")
          .length,
        0
      );
    }
  );
});

test("official client uses day-grid booking resource ids before try-edit", async () => {
  const slotId = "display-resource|20260601T081000|member-club-guid";
  const tryEditBodies: unknown[] = [];

  await withMockFetch(
    (url, _init, _headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        const parsedBody = JSON.parse(body ?? "{}");
        tryEditBodies.push(parsedBody);

        assert.equal(parsedBody.ResourceGuid, "booking-resource");
        return jsonResponse({
          SessionKey: "session-repaired",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForDay") {
        assert.equal(url.searchParams.get("resourceGuid"), "display-resource");
        assert.equal(url.searchParams.get("teeTime"), "20260601");
        assert.equal(url.searchParams.get("memberclubguid"), "member-club-guid");
        return xmlResponse(`
          <root>
            <Setup MaxNumberOfPlayers="4" Ressource_GUID="booking-resource" Ressource_Name="Hovedbanen" />
            <slot time="20260601T081000" isBlank="false" />
          </root>
        `);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        assert.equal(url.searchParams.get("sessionKey"), "session-repaired");
        return textResponse("");
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            ResourceGuid: "booking-resource",
            ResourceName: "Hovedbanen",
            TeeTime: "20260601T081000",
            BookingGroupGuid: "group-repaired",
            Players: [
              {
                BookingGuid: "booking-repaired",
                Confirmable: false,
                Confirmed: true
              }
            ]
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const booking = await client.createBooking({
        slotId,
        players: [{ name: "Ada Lovelace" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "booking-repaired-key-1"
      });

      assert.deepEqual(tryEditBodies, [
        {
          ResourceGuid: "booking-resource",
          TeeTime: "20260601T081000",
          MemberClubGuid: "member-club-guid"
        }
      ]);
      assert.deepEqual(booking, {
        bookingId: "booking-resource|20260601T081000|member-club-guid",
        status: "confirmed",
        slotId: "booking-resource|20260601T081000|member-club-guid",
        summary: "GolfBox booking saved for 1 player at 2026-06-01 08:10. GolfBox reference: group-repaired."
      });
    }
  );
});

test("official client reconciles save timeout with player tee times", async () => {
  const slotId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url, _init) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "session-timeout",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        return responseAfterAbort(_init.signal);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([
          {
            ResourceGuid: "resource-1",
            TeeTime: "20260601T081000",
            BookingGroupGuid: "group-timeout",
            Players: [
              {
                BookingGuid: "booking-timeout",
                Confirmable: false,
                Confirmed: true
              }
            ]
          }
        ]);
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO",
        saveTeeTimeTimeoutMs: 5,
        saveReconciliationDelaysMs: [0]
      });

      const booking = await client.createBooking({
        slotId,
        players: [{ name: "Ada Lovelace" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "booking-timeout-key-1"
      });

      assert.equal(booking.status, "confirmed");
      assert.equal(booking.bookingId, slotId);
      assert.match(booking.summary, /Verified in GolfBox/);
      assert.match(booking.summary, /group-timeout/);
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "deleteSession")
          .length,
        0
      );
    }
  );
});

test("official client stops before save when advance payment is required", async () => {
  const slotId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "payment-session",
          IsReadOnly: false,
          ResourceSettings: {
            HasInternetPayment: true,
            ForceInAdvancePayment: true,
            PaymentConfirmsTeeTime: true
          },
          Players: [
            {
              BookingIsPaid: false,
              Items: [
                {
                  Price: "795",
                  Paid: false
                }
              ]
            }
          ]
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "deleteSession") {
        assert.equal(url.searchParams.get("sessionKey"), "payment-session");
        return textResponse("");
      }

      if (url.pathname === "/teeTime/locks" && url.searchParams.get("methodName") === "deleteLock") {
        return textResponse("");
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      await assert.rejects(
        () =>
          client.createBooking({
            slotId,
            players: [{ name: "Ada Lovelace" }],
            confirmedByUser: true,
            confirmationText: "Book this tee time",
            idempotencyKey: "booking-payment-key-1"
          }),
        /requires advance payment/
      );

      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "saveTeeTime")
          .length,
        0
      );
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "deleteSession")
          .length,
        1
      );
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "deleteLock")
          .length,
        1
      );
    }
  );
});

test("official client annotates GolfBox errors with a redacted endpoint", async () => {
  const slotId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "session-secret",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        return new Response("Ugyldig session.", {
          status: 500,
          statusText: "Internal Server Error",
          headers: {
            "GolfBox-API-Error-Code": "NO_VALID_SESSION_FOUND",
            "GolfBox-API-Error-Message": "Ugyldig session."
          }
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "deleteSession") {
        return textResponse("");
      }

      if (url.pathname === "/teeTime/locks" && url.searchParams.get("methodName") === "deleteLock") {
        return textResponse("");
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO",
        saveReconciliationDelaysMs: [0]
      });

      await assert.rejects(
        () =>
          client.createBooking({
            slotId,
            players: [{ name: "Ada Lovelace" }],
            confirmedByUser: true,
            confirmationText: "Book this tee time",
            idempotencyKey: "booking-error-key-1"
          }),
        (error) => {
          assert(error instanceof Error);
          assert.match(error.message, /GET \/teeTime\/booking\?methodName=saveTeeTime&sessionKey=redacted/);
          assert.match(error.message, /Do not retry the same slot immediately/);
          assert.doesNotMatch(error.message, /session-secret/);
          return true;
        }
      );
    }
  );
});

test("official client returns pending when save timeout cannot be reconciled", async () => {
  const slotId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url, _init) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "session-timeout",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        return responseAfterAbort(_init.signal);
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "teeTimesForPlayer") {
        return jsonResponse([]);
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO",
        saveTeeTimeTimeoutMs: 5,
        saveReconciliationDelaysMs: [0]
      });

      const booking = await client.createBooking({
        slotId,
        players: [{ name: "Ada Lovelace" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "booking-timeout-key-2"
      });

      assert.deepEqual(booking, {
        bookingId: slotId,
        status: "pending",
        slotId,
        summary:
          "GolfBox saveTeeTime timed out for 2026-06-01 08:10, and the tee time was not visible in teeTimesForPlayer yet. Verify in GolfBox before retrying."
      });
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "deleteSession")
          .length,
        0
      );
    }
  );
});

test("official client adds an extra member before saving booking", async () => {
  await withMockFetch(
    (url, _init, headers, body) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          ClubName: "Oslo Golfklubb",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "session-2",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "searchPlayerForTeeTime") {
        assert.equal(headers.get("Authorization"), "booking-token");
        assert.equal(url.searchParams.get("sessionKey"), "session-2");
        assert.equal(url.searchParams.get("searchInCountry"), "NO");
        assert.equal(url.searchParams.get("name"), "Grace Hopper");
        assert.equal(url.searchParams.get("memberNumber"), "12345");
        assert.equal(url.searchParams.get("club"), "Oslo Golfklubb");

        return jsonResponse({
          Players: [
            {
              MemberGuid: "player-guid",
              ClubGuid: "other-club-guid",
              MemberNumber: "12345",
              FirstName: "Grace",
              LastName: "Hopper"
            }
          ]
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "addPlayerToTeeTime") {
        assert.equal(_init.method, "POST");
        assert.deepEqual(JSON.parse(body ?? "{}"), {
          SessionGuid: "session-2",
          PlayerGuid: "player-guid",
          ClubGuid: "other-club-guid",
          ConfirmBy: "TeeTime",
          ConfirmableByApp: true,
          ConfirmationWindowOpen: true
        });

        return jsonResponse({});
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "saveTeeTime") {
        return jsonResponse({
          BookingGroupGuid: "group-2"
        });
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const booking = await client.createBooking({
        slotId: "resource-1|20260601T081000|member-club-guid",
        players: [{ name: "Ada Lovelace" }, { name: "Grace Hopper", golfId: "12345" }],
        confirmedByUser: true,
        confirmationText: "Book this tee time",
        idempotencyKey: "booking-key-2"
      });

      assert.equal(booking.status, "confirmed");
      assert.match(booking.summary, /2 players/);
    }
  );
});

test("official client releases booking session when create fails before save", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "tryEditTeeTime") {
        return jsonResponse({
          SessionKey: "session-to-delete",
          IsReadOnly: false
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "searchPlayerForTeeTime") {
        return jsonResponse({
          Players: []
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "deleteSession") {
        assert.equal(url.searchParams.get("sessionKey"), "session-to-delete");
        return jsonResponse({});
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      await assert.rejects(
        () =>
          client.createBooking({
            slotId: "resource-1|20260601T081000|member-club-guid",
            players: [{ name: "Ada Lovelace" }, { name: "Guest Player", golfId: "99999" }],
            confirmedByUser: true,
            confirmationText: "Book this tee time",
            idempotencyKey: "booking-key-3"
          }),
        /Could not find GolfBox member/
      );

      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "deleteSession")
          .length,
        1
      );
      assert.equal(
        requests.filter((request) => new URL(request.url).searchParams.get("methodName") === "saveTeeTime")
          .length,
        0
      );
    }
  );
});

test("official client cancels a booking using the returned booking id", async () => {
  const bookingId = "resource-1|20260601T081000|member-club-guid";

  await withMockFetch(
    (url, _init) => {
      if (url.pathname === "/authentication") {
        return textResponse("booking-token");
      }

      if (url.pathname === "/profile/member") {
        return jsonResponse({
          Guid: "user-guid",
          ClubGuid: "member-club-guid",
          HasAccessToBooking: true
        });
      }

      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "deleteTeeTime") {
        assert.equal(_init.method, "DELETE");
        assert.equal(url.searchParams.get("resourceGuid"), "resource-1");
        assert.equal(url.searchParams.get("teeTime"), "20260601T081000");
        assert.equal(url.searchParams.get("memberclubguid"), "member-club-guid");
        return jsonResponse({});
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        country: "NO"
      });

      const cancelled = await client.cancelBooking({
        bookingId,
        confirmedByUser: true
      });

      assert.deepEqual(cancelled, {
        bookingId,
        status: "cancelled",
        slotId: bookingId,
        summary: "GolfBox tee time at 2026-06-01 08:10 cancelled."
      });
    }
  );
});

test("official client does not send web-login credentials in the URL", async () => {
  await withMockFetch(
    (url, _init, _headers, body) => {
      assert.doesNotMatch(url.toString(), /secret|testLogin/);

      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return textResponse("<html>Login</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp") {
        assert.equal(_init.method, "POST");
        assert.match(body ?? "", /loginform\.username=member%40example\.com/);
        assert.match(body ?? "", /loginform\.password=secret/);
        return textResponse("<html>Logged in</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/site/ressources/booking/grid.asp") {
        return textResponse("<html>Logged in</html>");
      }

      return new Response("", { status: 404 });
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret"
      });

      await (client as unknown as { createWebSession(): Promise<unknown> }).createWebSession();

      assert.equal(requests.some((request) => request.url.includes("testLogin.asp")), false);
      assert.equal(requests.some((request) => request.url.includes("secret")), false);
    }
  );
});

test("official client rejects cross-origin web redirects before sending cookies", async () => {
  await withMockFetch(
    (url) => {
      if (url.hostname === "web.example.test" && url.pathname === "/site/system/redirect.asp") {
        return textResponse("<html>Login</html>");
      }

      if (url.hostname === "web.example.test" && url.pathname === "/login.asp") {
        return new Response("", {
          status: 302,
          headers: {
            Location: "https://evil.test/steal",
            "Set-Cookie": "ASPUniqueID=session-1; path=/"
          }
        });
      }

      return textResponse("should not be requested");
    },
    async (requests) => {
      const client = new OfficialGolfBoxClient({
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret"
      });

      await assert.rejects(
        () => (client as unknown as { createWebSession(): Promise<unknown> }).createWebSession(),
        /redirect left the trusted origin/
      );

      assert.equal(requests.some((request) => new URL(request.url).hostname === "evil.test"), false);
    }
  );
});

test("official client validates GolfBox base URLs by default", () => {
  assert.throws(() => new OfficialGolfBoxClient({ apiBaseUrl: "http://app.golfbox.dk/" }), /must use https/);
  assert.throws(() => new OfficialGolfBoxClient({ apiBaseUrl: "https://example.test/" }), /not trusted/);
  assert.throws(
    () => new OfficialGolfBoxClient({ webBaseUrl: "https://web.example.test/" }),
    /not trusted/
  );
  assert.doesNotThrow(
    () =>
      new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true
      })
  );
});

test("official client applies the default API request timeout", async () => {
  await withMockFetch(
    (_url, init) => responseAfterAbort(init.signal),
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        apiToken: "token",
        requestTimeoutMs: 5
      });

      await assert.rejects(() => client.listClubs(), /timed out after 5 ms/);
    }
  );
});

test("official client applies the default web request timeout", async () => {
  await withMockFetch(
    (_url, init) => responseAfterAbort(init.signal),
    async () => {
      const client = new OfficialGolfBoxClient({
        webBaseUrl: "https://web.example.test/",
        allowUntrustedGolfBoxUrls: true,
        username: "member@example.com",
        password: "secret",
        webRequestTimeoutMs: 5
      });

      await assert.rejects(
        () => (client as unknown as { createWebSession(): Promise<unknown> }).createWebSession(),
        /timed out after 5 ms/
      );
    }
  );
});

test("official client redacts sensitive response body snippets when enabled", async () => {
  await withMockFetch(
    (url) => {
      if (url.pathname === "/teeTime/booking" && url.searchParams.get("methodName") === "clubsForCountry") {
        return new Response(
          "member@example.com password=secret token=abc123 sessionKey=session-secret Authorization: bearer-token",
          {
            status: 500,
            statusText: "Internal Server Error"
          }
        );
      }

      return new Response("", { status: 404 });
    },
    async () => {
      const client = new OfficialGolfBoxClient({
        apiBaseUrl: "https://example.test/",
        allowUntrustedGolfBoxUrls: true,
        apiToken: "token",
        includeErrorBodySnippets: true
      });

      await assert.rejects(
        () => client.listClubs(),
        (error) => {
          assert(error instanceof Error);
          assert.doesNotMatch(error.message, /member@example\.com|secret|abc123|session-secret|bearer-token/);
          assert.match(error.message, /redacted-email/);
          return true;
        }
      );
    }
  );
});
