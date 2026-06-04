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
          UseNewApp: true
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

      assert.equal(requests[0]?.method, "POST");
      assert.match(requests[0]?.url ?? "", /^https:\/\/example\.test\/authentication/);
      assert.match(requests[0]?.headers.get("Client-User-Agent") ?? "", /AppCountry:NO;/);
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
