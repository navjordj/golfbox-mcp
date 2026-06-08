import type {
  AuthStatus,
  Booking,
  BookingDraft,
  BookingPreparation,
  CancelBookingRequest,
  Club,
  CreateBookingRequest,
  GolfBoxClient,
  TeeTimeSearch,
  TeeTimePlayerMatch,
  TeeTimePlayerSearch,
  TeeTimeSlot,
  Tournament,
  UpcomingTeeTime,
  UpcomingTeeTimeSearch
} from "./types.js";

const clubs: Club[] = [
  { id: "oslo-gk", name: "Oslo Golfklubb", country: "NO", region: "Oslo" },
  { id: "baerum-gk", name: "Baerum Golfklubb", country: "NO", region: "Akershus" },
  { id: "miklagard-golf", name: "Miklagard Golf", country: "NO", region: "Akershus" }
];

const tournaments: Tournament[] = [
  {
    tournamentId: "mock-competition-1",
    name: "Mock Club Championship",
    organizer: "Oslo Golfklubb",
    startsAt: "2026-06-13T00:00:00+02:00",
    endsAt: "2026-06-14T00:00:00+02:00"
  },
  {
    tournamentId: "mock-competition-2",
    name: "Mock Summer Open",
    organizer: "Baerum Golfklubb",
    startsAt: "2026-07-04T00:00:00+02:00",
    endsAt: "2026-07-04T00:00:00+02:00"
  }
];

function toDateTime(date: string, time: string): string {
  return `${date}T${time}:00+02:00`;
}

function withinTimeWindow(time: string, earliestTime?: string, latestTime?: string): boolean {
  if (earliestTime && time < earliestTime) {
    return false;
  }

  if (latestTime && time > latestTime) {
    return false;
  }

  return true;
}

export class MockGolfBoxClient implements GolfBoxClient {
  private readonly bookings = new Map<string, Booking>();

  async authenticate(): Promise<AuthStatus> {
    return {
      provider: "mock",
      country: "NO",
      authenticated: true,
      tokenSource: "mock",
      tokenPreview: "mock-token",
      tokenLength: "mock-token".length,
      validatedWithLogin: true,
      user: {
        guid: "mock-user",
        fullName: "Mock GolfBox User",
        clubGuid: "oslo-gk",
        clubName: "Oslo Golfklubb",
        memberNumber: "000000",
        countryIsoCode: "NO",
        hasAccessToBooking: true,
        useNewApp: true
      },
      warnings: ["Mock adapter does not contact GolfBox."]
    };
  }

  async listClubs(): Promise<Club[]> {
    return clubs;
  }

  async searchTeeTimes(search: TeeTimeSearch): Promise<TeeTimeSlot[]> {
    const club = clubs.find((candidate) => candidate.id === search.clubId);
    if (!club) {
      return [];
    }

    const holes = search.holes ?? 18;
    const times = ["07:50", "08:10", "08:30", "09:20", "10:40", "14:10", "16:30"];

    return times
      .filter((time) => withinTimeWindow(time, search.earliestTime, search.latestTime))
      .map((time, index) => ({
        slotId: `${club.id}-${search.date}-${time.replace(":", "")}`,
        clubId: club.id,
        courseName: `${club.name} hovedbane`,
        startsAt: toDateTime(search.date, time),
        holes,
        availableSpots: Math.max(search.players, 4 - (index % 3)),
        priceNok: holes === 18 ? 850 : 500,
        notes: index === 1 ? ["Mock-data: bekreft ekte tilgjengelighet i offisiell adapter."] : []
      }));
  }

  async searchTeeTimePlayers(search: TeeTimePlayerSearch): Promise<TeeTimePlayerMatch[]> {
    const club = clubs.find((candidate) => candidate.id === search.clubId);
    if (!club) {
      return [];
    }

    const players = [
      { time: "08:10", name: "Booked Player" },
      { time: "16:40", name: "Jonas Fagermo" }
    ];
    const normalizedQuery = search.query.trim().toLowerCase();

    return players
      .filter((player) => withinTimeWindow(player.time, search.earliestTime, search.latestTime))
      .filter((player) => player.name.toLowerCase().includes(normalizedQuery))
      .map((player) => ({
        slotId: `${club.id}-${search.date}-${player.time.replace(":", "")}`,
        clubId: club.id,
        courseName: `${club.name} hovedbane`,
        startsAt: toDateTime(search.date, player.time),
        playerName: player.name,
        matchedText: player.name,
        source: "teeTimesForDay"
      }));
  }

  async prepareBooking(draft: BookingDraft): Promise<BookingPreparation> {
    const warnings: string[] = [];
    if (draft.players.length === 0) {
      warnings.push("At least one player is required.");
    }

    if (draft.players.length > 4) {
      warnings.push("Most tee times allow at most four players.");
    }

    return {
      ready: warnings.length === 0,
      summary: `Prepare booking for ${draft.players.length} player(s) on slot ${draft.slotId}.`,
      warnings,
      draft
    };
  }

  async listBookings(): Promise<Booking[]> {
    return [...this.bookings.values()];
  }

  async listUpcomingTeeTimes(search: UpcomingTeeTimeSearch = {}): Promise<UpcomingTeeTime[]> {
    const fromDate = search.fromDate ?? "2026-06-01";
    const daysAhead = search.daysAhead ?? 90;
    const requestedClubIds = new Set(
      [search.clubId, ...(search.clubIds ?? [])].filter((clubId): clubId is string => Boolean(clubId))
    );
    const until = new Date(`${fromDate}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + daysAhead);

    const teeTimes = [
      {
        slotId: "mock-baerum-resource-1|20260607T090000|oslo-gk",
        startsAt: "2026-06-07T09:00:00+02:00",
        clubName: "Baerum Golfklubb",
        courseName: "Baerum Golfbane 18 hull",
        status: "confirmed",
        playerCount: 4,
        players: [
          {
            name: "Mock GolfBox User",
            memberNumber: "000000",
            clubName: "Oslo Golfklubb",
            isCurrentUser: true,
            confirmed: true
          }
        ],
        source: "teeTimesForPlayer",
        summary: "Baerum Golfbane 18 hull: 2026-06-07 09:00 for 4 players."
      },
      {
        slotId: "mock-resource-1|20260607T092000|oslo-gk",
        startsAt: "2026-06-07T09:20:00+02:00",
        clubName: "Oslo Golfklubb",
        courseName: "Mock Course",
        status: "confirmed",
        playerCount: 1,
        players: [
          {
            name: "Mock GolfBox User",
            memberNumber: "000000",
            clubName: "Oslo Golfklubb",
            isCurrentUser: true,
            confirmed: true
          }
        ],
        source: "teeTimesForPlayer",
        summary: "Mock Course: 2026-06-07 09:20 for 1 player."
      }
    ] satisfies UpcomingTeeTime[];

    return teeTimes.filter((teeTime) => {
      const startsAtDate = teeTime.startsAt.slice(0, 10);
      const matchesDateWindow = startsAtDate >= fromDate && new Date(`${startsAtDate}T00:00:00Z`) < until;
      const matchesClub =
        requestedClubIds.size === 0 ||
        [...requestedClubIds].some((clubId) => teeTime.slotId.includes(clubId) || teeTime.clubName.includes(clubId));
      return matchesDateWindow && matchesClub;
    });
  }

  async listTournaments(): Promise<Tournament[]> {
    return tournaments;
  }

  async createBooking(request: CreateBookingRequest): Promise<Booking> {
    const booking = {
      bookingId: `mock-${request.idempotencyKey}`,
      status: "confirmed",
      slotId: request.slotId,
      summary: `Mock booking confirmed for ${request.players.length} player(s).`
    } satisfies Booking;

    this.bookings.set(booking.bookingId, booking);
    return booking;
  }

  async cancelBooking(request: CancelBookingRequest): Promise<Booking> {
    const existing = this.bookings.get(request.bookingId);
    const booking = {
      bookingId: request.bookingId,
      status: "cancelled",
      slotId: existing?.slotId ?? "unknown",
      summary: `Mock booking ${request.bookingId} cancelled.`
    } satisfies Booking;

    this.bookings.set(booking.bookingId, booking);
    return booking;
  }
}
