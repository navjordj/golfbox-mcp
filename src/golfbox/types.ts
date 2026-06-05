export type HoleCount = 9 | 18;

export interface Club {
  id: string;
  name: string;
  country: string;
  region?: string;
}

export interface TeeTimeSearch {
  clubId: string;
  date: string;
  players: number;
  holes?: HoleCount;
  earliestTime?: string;
  latestTime?: string;
}

export interface TeeTimeSlot {
  slotId: string;
  clubId: string;
  courseName: string;
  startsAt: string;
  holes: HoleCount;
  availableSpots: number;
  priceNok?: number;
  notes?: string[];
}

export interface Player {
  name: string;
  golfId?: string;
  email?: string;
}

export interface BookingDraft {
  slotId: string;
  players: Player[];
  holes?: HoleCount;
  notes?: string;
}

export interface BookingPreparation {
  ready: boolean;
  summary: string;
  warnings: string[];
  draft: BookingDraft;
}

export interface CreateBookingRequest extends BookingDraft {
  confirmedByUser: boolean;
  confirmationText: string;
  idempotencyKey: string;
}

export interface Booking {
  bookingId: string;
  status: "confirmed" | "cancelled" | "pending";
  slotId: string;
  summary: string;
}

export interface UpcomingTeeTimeSearch {
  fromDate?: string;
  daysAhead?: number;
  clubId?: string;
  clubIds?: string[];
}

export interface UpcomingTeeTimePlayer {
  name?: string;
  memberNumber?: string;
  clubName?: string;
  isCurrentUser?: boolean;
  confirmed?: boolean;
  confirmable?: boolean;
}

export interface UpcomingTeeTime {
  slotId: string;
  startsAt: string;
  clubName: string;
  courseName: string;
  status: "confirmed" | "pending";
  playerCount: number;
  players: UpcomingTeeTimePlayer[];
  source: "teeTimesForPlayer" | "gimmie" | "webPortal";
  summary: string;
}

export interface Tournament {
  tournamentId: string;
  name: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface CancelBookingRequest {
  bookingId: string;
  confirmedByUser: boolean;
  reason?: string;
}

export interface AuthenticatedUser {
  guid?: string;
  fullName?: string;
  clubGuid?: string;
  clubName?: string;
  memberNumber?: string;
  countryIsoCode?: string;
  hasAccessToBooking?: boolean;
  useNewApp?: boolean;
}

export interface AuthStatus {
  provider: "mock" | "official";
  baseUrl?: string;
  country?: string;
  authenticated: boolean;
  tokenSource: "mock" | "credentials" | "env-token";
  tokenPreview?: string;
  tokenLength?: number;
  validatedWithLogin?: boolean;
  user?: AuthenticatedUser;
  warnings?: string[];
}

export interface GolfBoxClient {
  authenticate(): Promise<AuthStatus>;
  listClubs(): Promise<Club[]>;
  searchTeeTimes(search: TeeTimeSearch): Promise<TeeTimeSlot[]>;
  listBookings(): Promise<Booking[]>;
  listUpcomingTeeTimes(search?: UpcomingTeeTimeSearch): Promise<UpcomingTeeTime[]>;
  listTournaments(): Promise<Tournament[]>;
  prepareBooking(draft: BookingDraft): Promise<BookingPreparation>;
  createBooking(request: CreateBookingRequest): Promise<Booking>;
  cancelBooking(request: CancelBookingRequest): Promise<Booking>;
}
