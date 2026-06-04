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
  TeeTimeSlot,
  Tournament
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
