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
  prepareBooking(draft: BookingDraft): Promise<BookingPreparation>;
  createBooking(request: CreateBookingRequest): Promise<Booking>;
  cancelBooking(request: CancelBookingRequest): Promise<Booking>;
}
