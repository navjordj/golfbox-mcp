import assert from "node:assert/strict";
import { test } from "bun:test";
import { MockGolfBoxClient } from "./mock-client.js";

test("mock client returns filtered tee times", async () => {
  const client = new MockGolfBoxClient();

  const slots = await client.searchTeeTimes({
    clubId: "oslo-gk",
    date: "2026-06-01",
    players: 2,
    earliestTime: "08:00",
    latestTime: "09:00"
  });

  assert.equal(slots.length, 2);
  assert.ok(slots.every((slot) => slot.clubId === "oslo-gk"));
});

test("mock client flags impossible booking drafts", async () => {
  const client = new MockGolfBoxClient();

  const preparation = await client.prepareBooking({
    slotId: "slot-1",
    players: []
  });

  assert.equal(preparation.ready, false);
  assert.equal(preparation.warnings.length, 1);
});

test("mock client returns tournaments", async () => {
  const client = new MockGolfBoxClient();

  const tournaments = await client.listTournaments();

  assert.equal(tournaments.length, 2);
  assert.deepEqual(Object.keys(tournaments[0]).sort(), ["endsAt", "name", "organizer", "startsAt", "tournamentId"]);
});

test("mock client returns upcoming private tee times", async () => {
  const client = new MockGolfBoxClient();

  const teeTimes = await client.listUpcomingTeeTimes({ fromDate: "2026-06-01", daysAhead: 90 });

  assert.equal(teeTimes.length, 2);
  assert.equal(teeTimes[0].source, "teeTimesForPlayer");
  assert.equal(teeTimes[0].players[0].isCurrentUser, true);
});
