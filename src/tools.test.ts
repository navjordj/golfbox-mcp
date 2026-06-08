import assert from "node:assert/strict";
import { test } from "bun:test";
import type { AppConfig } from "./config.js";
import { registerGolfBoxTools } from "./tools.js";
import type { GolfBoxClient } from "./golfbox/types.js";

test("registerGolfBoxTools exposes upcoming tee-time input schema", () => {
  const tools = new Map<string, { inputSchema: Record<string, { parse: (value: unknown) => unknown }> }>();
  const server = {
    registerTool(
      name: string,
      definition: { inputSchema: Record<string, { parse: (value: unknown) => unknown }> },
      _handler: unknown
    ) {
      tools.set(name, definition);
    }
  };
  const client = {
    authenticate: async () => ({
      provider: "mock",
      authenticated: true,
      tokenSource: "mock"
    }),
    listClubs: async () => [],
    searchTeeTimes: async () => [],
    searchTeeTimePlayers: async () => [],
    listBookings: async () => [],
    listUpcomingTeeTimes: async () => [],
    listTournaments: async () => [],
    prepareBooking: async (draft) => ({ ready: true, summary: "", warnings: [], draft }),
    createBooking: async (request) => ({
      bookingId: request.slotId,
      status: "confirmed",
      slotId: request.slotId,
      summary: ""
    }),
    cancelBooking: async (request) => ({
      bookingId: request.bookingId,
      status: "cancelled",
      slotId: request.bookingId,
      summary: ""
    })
  } satisfies GolfBoxClient;
  const config = {
    enableWriteTools: false,
    requireConfirmation: true
  } as AppConfig;

  registerGolfBoxTools(server as never, client, config);

  const upcomingTool = tools.get("golfbox_list_upcoming_tee_times");
  assert.ok(upcomingTool);
  const playerSearchTool = tools.get("golfbox_search_tee_time_players");
  assert.ok(playerSearchTool);
  assert.deepEqual(Object.keys(playerSearchTool.inputSchema).sort(), [
    "clubId",
    "date",
    "earliestTime",
    "latestTime",
    "query"
  ]);
  assert.equal(playerSearchTool.inputSchema.query.parse("Fagermo"), "Fagermo");
  assert.throws(() => playerSearchTool.inputSchema.query.parse(""));

  assert.deepEqual(Object.keys(upcomingTool.inputSchema).sort(), ["clubId", "clubIds", "daysAhead", "fromDate"]);
  assert.equal(upcomingTool.inputSchema.fromDate.parse("2026-06-07"), "2026-06-07");
  assert.equal(upcomingTool.inputSchema.daysAhead.parse(90), 90);
  assert.equal(upcomingTool.inputSchema.clubId.parse("club-guid"), "club-guid");
  assert.deepEqual(upcomingTool.inputSchema.clubIds.parse(["club-guid", "other-club-guid"]), [
    "club-guid",
    "other-club-guid"
  ]);
  assert.throws(() => upcomingTool.inputSchema.fromDate.parse("07.06.2026"));
  assert.throws(() => upcomingTool.inputSchema.daysAhead.parse(181));
  assert.throws(() => upcomingTool.inputSchema.clubIds.parse(Array.from({ length: 21 }, (_, index) => `club-${index}`)));
});
