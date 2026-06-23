import type {
  AuthenticatedUser,
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
  UpcomingTeeTimePlayer,
  UpcomingTeeTimeSearch
} from "./types.js";
import {
  fetchWithTimeout,
  GolfBoxHttpError,
  GolfBoxRequestTimeoutError,
  redactSensitiveText,
  sanitizeErrorPath,
  validateGolfBoxBaseUrl
} from "./http-utils.js";
import { WebCookieJar } from "./web-cookie-jar.js";

export interface OfficialGolfBoxClientOptions {
  apiBaseUrl?: string;
  webBaseUrl?: string;
  apiToken?: string;
  username?: string;
  password?: string;
  country?: string;
  appLanguage?: string;
  appVersion?: string;
  saveTeeTimeTimeoutMs?: number;
  saveReconciliationDelaysMs?: number[];
  requestTimeoutMs?: number;
  webRequestTimeoutMs?: number;
  allowUntrustedGolfBoxUrls?: boolean;
  includeErrorBodySnippets?: boolean;
}

type TokenSource = "credentials" | "env-token";

interface AuthToken {
  token: string;
  source: TokenSource;
}

interface MobileHubUserResponse {
  Guid?: unknown;
  guid?: unknown;
  FirstName?: unknown;
  firstName?: unknown;
  LastName?: unknown;
  lastName?: unknown;
  FullName?: unknown;
  fullName?: unknown;
  Name?: unknown;
  name?: unknown;
  ClubGuid?: unknown;
  clubGuid?: unknown;
  ClubName?: unknown;
  clubName?: unknown;
  MemberNumber?: unknown;
  memberNumber?: unknown;
  CountryIsoCode?: unknown;
  countryIsoCode?: unknown;
  HasAccessToBooking?: unknown;
  hasAccessToBooking?: unknown;
  UseNewApp?: unknown;
  useNewApp?: unknown;
  NewAppSSOToken?: unknown;
  newAppSSOToken?: unknown;
}

type AuthenticatedGolfBoxUser = AuthenticatedUser & {
  newAppSsoToken?: string;
};

interface ValidateClientResponse {
  FrontPageURL?: unknown;
  frontPageURL?: unknown;
  TeeTimeURL?: unknown;
  teeTimeURL?: unknown;
}

interface GimmieGraphqlResponse<T> {
  data?: T;
  errors?: { message?: unknown }[];
}

interface GimmieContinueWithAuthResponse {
  continueWithAuth?: {
    id?: unknown;
    otp?: unknown;
  };
}

interface GimmieAuthMeResponse {
  AuthQueries?: {
    authMe?: {
      token?: unknown;
    };
  };
}

interface GimmieTeeTimesResponse {
  teeTimesWithProviders?: GimmieTeeTimeResponse[];
}

interface GimmieTeeTimeResponse {
  bookingId?: unknown;
  teeTime?: unknown;
  clubName?: unknown;
  guideName?: unknown;
  org?: unknown;
  confirmedSkeletonId?: unknown;
  players?: GimmieTeeTimePlayerResponse[];
}

interface GimmieTeeTimePlayerResponse {
  memberId?: unknown;
  name?: unknown;
}

interface TeeClubResponse {
  Guid?: unknown;
  ID?: unknown;
  Name?: unknown;
  Country?: unknown;
  Region?: unknown;
}

interface TeeResourceResponse {
  Guid?: unknown;
  ResourceGuid?: unknown;
  ID?: unknown;
  Name?: unknown;
  ResourceName?: unknown;
  ClubGuid?: unknown;
}

interface TeeResource {
  guid: string;
  name: string;
  clubGuid?: string;
}

interface SlotKey {
  resourceGuid: string;
  teeTime: string;
  memberClubGuid: string;
}

interface SlotDayGridDetail {
  slot: SlotKey;
  attrs: Record<string, string>;
  clubGuid?: string;
}

interface TeeTimePlayerResponse {
  BookingGuid?: unknown;
  bookingGuid?: unknown;
  BookingGroupGuid?: unknown;
  bookingGroupGuid?: unknown;
  MemberGuid?: unknown;
  memberGuid?: unknown;
  MemberNumber?: unknown;
  memberNumber?: unknown;
  FirstName?: unknown;
  firstName?: unknown;
  LastName?: unknown;
  lastName?: unknown;
  FullName?: unknown;
  fullName?: unknown;
  Name?: unknown;
  name?: unknown;
  ClubGuid?: unknown;
  clubGuid?: unknown;
  ClubName?: unknown;
  clubName?: unknown;
  BookingIsPaid?: unknown;
  bookingIsPaid?: unknown;
  Confirmable?: unknown;
  confirmable?: unknown;
  Confirmed?: unknown;
  confirmed?: unknown;
  IsEditable?: unknown;
  isEditable?: unknown;
  Items?: unknown;
  items?: unknown;
}

interface TeeTimeResourceSettingsResponse {
  HasInternetPayment?: unknown;
  hasInternetPayment?: unknown;
  ForceInAdvancePayment?: unknown;
  forceInAdvancePayment?: unknown;
  PaymentConfirmsTeeTime?: unknown;
  paymentConfirmsTeeTime?: unknown;
}

interface WebUpcomingTeeTimeCard {
  date: string;
  timeOfDay: string;
  clubName: string;
  courseName: string;
  resourceGuid: string;
  bookingStart: string;
  players: UpcomingTeeTimePlayer[];
}

interface TeeTimeBookingItemResponse {
  Price?: unknown;
  price?: unknown;
  Paid?: unknown;
  paid?: unknown;
}

interface TeeTimeResponse {
  BookingGuid?: unknown;
  bookingGuid?: unknown;
  BookingGroupGuid?: unknown;
  bookingGroupGuid?: unknown;
  ClubGuid?: unknown;
  clubGuid?: unknown;
  ClubName?: unknown;
  clubName?: unknown;
  ResourceGuid?: unknown;
  resourceGuid?: unknown;
  ResourceName?: unknown;
  resourceName?: unknown;
  TeeTime?: unknown;
  teeTime?: unknown;
  SessionKey?: unknown;
  sessionKey?: unknown;
  SessionGuid?: unknown;
  sessionGuid?: unknown;
  LockGuid?: unknown;
  lockGuid?: unknown;
  IsReadOnly?: unknown;
  isReadOnly?: unknown;
  ReadOnlyReason?: unknown;
  readOnlyReason?: unknown;
  ConfirmationWindowOpen?: unknown;
  confirmationWindowOpen?: unknown;
  ResourceSettings?: unknown;
  resourceSettings?: unknown;
  Players?: TeeTimePlayerResponse[];
  players?: TeeTimePlayerResponse[];
}

interface TournamentPlayerResponse {
  CompetitionId?: unknown;
  CustomerName?: unknown;
  EndDate?: unknown;
  Name?: unknown;
  StartDate?: unknown;
}

interface PlayerSearchResponse {
  Guid?: unknown;
  PlayerGuid?: unknown;
  MemberGuid?: unknown;
  ClubGuid?: unknown;
  MemberNumber?: unknown;
  FirstName?: unknown;
  LastName?: unknown;
  FullName?: unknown;
  Name?: unknown;
}

interface ResolvedPlayer {
  playerGuid: string;
  clubGuid: string;
  name?: string;
  memberNumber?: string;
}

interface XmlTag {
  attrs: Record<string, string>;
  body: string;
}

interface WebTextResponse {
  url: string;
  text: string;
}

const WEB_BOOKING_GRID_PATH = "/site/my_golfbox/ressources/booking/grid.asp";
const WEB_SESSION_TTL_MS = 8 * 60 * 1000;

export class OfficialGolfBoxClient implements GolfBoxClient {
  private static readonly gimmieGraphqlUrl = "https://be.glfr.com/graphql";
  private readonly baseUrl: string;
  private readonly webBaseUrl: string;
  private readonly country: string;
  private readonly appCountry: string;
  private readonly appLanguage: string;
  private readonly appVersion: string;
  private readonly clientUserAgent: string;
  private readonly saveTeeTimeTimeoutMs: number;
  private readonly saveReconciliationDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly webRequestTimeoutMs: number;
  private readonly includeErrorBodySnippets: boolean;
  private cachedToken?: AuthToken;
  private cachedUser?: AuthenticatedGolfBoxUser;
  private cachedWebSession?: WebCookieJar;
  private cachedWebSessionAt?: number;
  private readonly bookingsByIdempotencyKey = new Map<string, Promise<Booking>>();
  private readonly responseContexts = new WeakMap<Response, { method: string; path: string }>();

  constructor(private readonly options: OfficialGolfBoxClientOptions) {
    this.country = (options.country ?? "NO").toUpperCase();
    // The Android app package is Danish; the logged-in user's country stays in AppUserCountry.
    this.appCountry = "DK";
    this.baseUrl = validateGolfBoxBaseUrl(
      options.apiBaseUrl ?? "https://app.golfbox.dk/",
      "api",
      options.allowUntrustedGolfBoxUrls ?? false
    );
    this.webBaseUrl = validateGolfBoxBaseUrl(
      options.webBaseUrl ?? defaultWebBaseUrl(this.country),
      "web",
      options.allowUntrustedGolfBoxUrls ?? false
    );
    this.appLanguage = options.appLanguage ?? "en";
    this.appVersion = options.appVersion ?? "2.7.003";
    this.saveTeeTimeTimeoutMs = options.saveTeeTimeTimeoutMs ?? 20_000;
    this.saveReconciliationDelaysMs = options.saveReconciliationDelaysMs ?? [0, 1_500, 3_000, 5_000];
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.webRequestTimeoutMs = options.webRequestTimeoutMs ?? 15_000;
    this.includeErrorBodySnippets = options.includeErrorBodySnippets ?? false;
    this.clientUserAgent =
      `AppCountry:${this.appCountry};` +
      `AppUserCountry${this.country};` +
      `AppLanguage:${this.appLanguage};` +
      `AppVersion:${this.appVersion};` +
      "Model:Codex MCP;OS:node;";

    const apiToken = options.apiToken?.trim();
    if (apiToken) {
      this.cachedToken = { token: apiToken, source: "env-token" };
    }
  }

  async authenticate(): Promise<AuthStatus> {
    let authToken = await this.getToken();

    try {
      const user = await this.loginWithToken(authToken.token);
      return this.toAuthStatus(authToken, user);
    } catch (error) {
      if (error instanceof GolfBoxHttpError && error.status === 401 && this.hasCredentials()) {
        authToken = await this.getToken({ forceRefresh: true });
        const user = await this.loginWithToken(authToken.token);
        return this.toAuthStatus(authToken, user);
      }

      throw error;
    }
  }

  async listClubs(): Promise<Club[]> {
    const response = await this.authorizedJsonRequest<TeeClubResponse[] | { Clubs?: TeeClubResponse[] }>(
      "/teeTime/booking?methodName=clubsForCountry",
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );

    const clubs = Array.isArray(response) ? response : Array.isArray(response.Clubs) ? response.Clubs : [];

    return clubs
      .map((club) => {
        const id = toOptionalString(club.Guid ?? club.ID);
        const name = toOptionalString(club.Name);
        if (!id || !name) {
          return undefined;
        }

        const mapped: Club = {
          id,
          name,
          country: toOptionalString(club.Country) ?? this.country
        };
        const region = toOptionalString(club.Region);
        if (region) {
          mapped.region = region;
        }

        return mapped;
      })
      .filter((club): club is Club => club !== undefined);
  }

  async searchTeeTimes(search: TeeTimeSearch): Promise<TeeTimeSlot[]> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    const memberClubGuid = user.clubGuid ?? search.clubId;
    const mobileHubResources = await this.listResourcesForClub(search.clubId);
    const slots: TeeTimeSlot[] = [];

    for (const resource of mobileHubResources) {
      const xml = await this.authorizedTextRequest(
        `/teeTime/booking?methodName=teeTimesForDay&resourceGuid=${encodeURIComponent(resource.guid)}` +
          `&teeTime=${encodeURIComponent(toGolfBoxDate(search.date))}` +
          `&memberclubguid=${encodeURIComponent(memberClubGuid)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/xml"
          }
        }
      );

      slots.push(...parseTeeTimeXml(xml, search, resource, memberClubGuid));
    }

    // useNewApp / NGF accounts expose no MobileHub resources or day grid, so the
    // MobileHub query above yields nothing. The authenticated web booking grid is the
    // only availability source for these accounts, so surface its errors rather than
    // masking a transient login throttle as an empty (misleading) result.
    if (slots.length === 0 && this.hasCredentials()) {
      slots.push(...(await this.searchWebTeeTimes(search, memberClubGuid)));
    }

    return slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async searchTeeTimePlayers(search: TeeTimePlayerSearch): Promise<TeeTimePlayerMatch[]> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    const query = search.query.trim();
    if (!query) {
      return [];
    }

    const mobileHubResources = await this.listResourcesForClub(search.clubId);
    const resources =
      mobileHubResources.length > 0 ? mobileHubResources : await this.listWebResourcesForClub(search.clubId);
    const memberClubGuid = user.clubGuid ?? search.clubId;
    const matches: TeeTimePlayerMatch[] = [];

    for (const resource of resources) {
      const xml = await this.authorizedTextRequest(
        `/teeTime/booking?methodName=teeTimesForDay&resourceGuid=${encodeURIComponent(resource.guid)}` +
          `&teeTime=${encodeURIComponent(toGolfBoxDate(search.date))}` +
          `&memberclubguid=${encodeURIComponent(memberClubGuid)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/xml"
          }
        }
      );

      matches.push(...parseTeeTimePlayerMatchesXml(xml, search, resource, memberClubGuid));
    }

    if (this.hasCredentials()) {
      try {
        matches.push(...(await this.searchWebTeeTimePlayers(search, memberClubGuid)));
      } catch {
        // MobileHub results are still useful. Web grid lookup is a read-only fallback for names hidden in MobileHub.
      }
    }

    return dedupeTeeTimePlayerMatches(matches).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async listBookings(): Promise<Booking[]> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    const teeTimes = await this.listPlayerTeeTimes();
    return teeTimes
      .map((teeTime) => mapBookingListItem(teeTime, user))
      .filter((booking): booking is Booking => booking !== undefined);
  }

  async listUpcomingTeeTimes(search: UpcomingTeeTimeSearch = {}): Promise<UpcomingTeeTime[]> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    const fromDate = search.fromDate ?? todayNorwayDate();
    const daysAhead = normalizeDaysAhead(search.daysAhead);
    const untilDate = addDays(fromDate, daysAhead);
    const clubFilters = upcomingClubFilters(search);

    const upcoming = (await this.listPlayerTeeTimes())
      .map((teeTime) => mapUpcomingTeeTimeFromPlayerResponse(teeTime, user, fromDate, untilDate, clubFilters))
      .filter((teeTime): teeTime is UpcomingTeeTime => teeTime !== undefined)
      .sort(compareUpcomingTeeTimes);

    if (upcoming.length === 0 && user.useNewApp === true) {
      const routeHint = await this.readNewAppRouteHint();
      const gimmieUpcoming = await this.listGimmieUpcomingTeeTimes(user, fromDate, untilDate).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(buildEmptyUseNewAppTeeTimesError(routeHint, `Gimmie/new-app lookup failed: ${message}`));
      });
      if (gimmieUpcoming.length > 0) {
        return gimmieUpcoming.sort(compareUpcomingTeeTimes);
      }

      const webUpcoming = await this.listWebPortalUpcomingTeeTimes(user, fromDate, untilDate).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          buildEmptyUseNewAppTeeTimesError(
            routeHint,
            `Gimmie teeTimesWithProviders was authenticated but returned an empty list. Web portal fallback failed: ${message}`
          )
        );
      });
      if (webUpcoming.length > 0) {
        return webUpcoming.sort(compareUpcomingTeeTimes);
      }

      throw new Error(
        buildEmptyUseNewAppTeeTimesError(
          routeHint,
          "Gimmie teeTimesWithProviders was authenticated but returned an empty list, and the web portal Mine tider fallback returned no upcoming tee times."
        )
      );
    }

    return upcoming;
  }

  async listTournaments(): Promise<Tournament[]> {
    await this.getAuthenticatedUser();

    const response = await this.authorizedJsonRequest<unknown>("/tournament?methodName=tournamentsForPlayer", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    return parseTournamentResponses(response)
      .map(mapTournamentListItem)
      .filter((tournament): tournament is Tournament => tournament !== undefined);
  }

  async prepareBooking(draft: BookingDraft): Promise<BookingPreparation> {
    const warnings: string[] = [];
    const slot = parseSlotId(draft.slotId);

    if (!slot) {
      warnings.push("slotId must come from golfbox_search_tee_times for the official adapter.");
    }

    if (draft.players.length === 0) {
      warnings.push("At least one player is required.");
    }

    if (draft.players.length > 4) {
      warnings.push("Most tee times allow at most four players.");
    }

    const extraPlayersWithoutGolfId = draft.players.slice(1).filter((player) => !player.golfId?.trim());
    if (extraPlayersWithoutGolfId.length > 0) {
      warnings.push(
        "Additional players need golfId/member number for the official MobileHub booking flow. Guest booking is not mapped yet."
      );
    }

    if (draft.notes?.trim()) {
      warnings.push("Notes are retained by the MCP caller; the mapped MobileHub booking call does not send notes.");
    }

    return {
      ready: warnings.length === 0,
      summary: slot
        ? `Ready to book ${draft.players.length} player(s) at ${formatGolfBoxDateTime(slot.teeTime)}.`
        : `Cannot prepare booking for malformed slot ${draft.slotId}.`,
      warnings,
      draft
    };
  }

  async createBooking(request: CreateBookingRequest): Promise<Booking> {
    const existing = this.bookingsByIdempotencyKey.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }

    const bookingPromise = this.createBookingOnce(request);
    this.bookingsByIdempotencyKey.set(request.idempotencyKey, bookingPromise);

    try {
      return await bookingPromise;
    } catch (error) {
      this.bookingsByIdempotencyKey.delete(request.idempotencyKey);
      throw error;
    }
  }

  async cancelBooking(request: CancelBookingRequest): Promise<Booking> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    const slot = parseSlotId(request.bookingId);
    if (!slot) {
      throw new Error(
        "Official GolfBox cancellation requires a bookingId returned by golfbox_create_booking for this adapter."
      );
    }

    await this.authorizedJsonRequest<unknown>(
      `/teeTime/booking?methodName=deleteTeeTime&resourceGuid=${encodeURIComponent(slot.resourceGuid)}` +
        `&teeTime=${encodeURIComponent(slot.teeTime)}` +
        `&memberclubguid=${encodeURIComponent(slot.memberClubGuid)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json"
        }
      }
    );

    return {
      bookingId: request.bookingId,
      status: "cancelled",
      slotId: request.bookingId,
      summary: `GolfBox tee time at ${formatGolfBoxDateTime(slot.teeTime)} cancelled.`
    };
  }

  private async createBookingOnce(request: CreateBookingRequest): Promise<Booking> {
    const user = await this.getAuthenticatedUser();
    if (user.hasAccessToBooking === false) {
      throw new Error("Authenticated GolfBox user does not have booking access.");
    }

    let slot = parseSlotId(request.slotId);
    if (!slot) {
      throw new Error("slotId must come from golfbox_search_tee_times for the official adapter.");
    }

    if (request.players.length === 0) {
      throw new Error("At least one player is required.");
    }

    if (request.players.length > 4) {
      throw new Error("Most tee times allow at most four players.");
    }

    const extraPlayerWithoutGolfId = request.players.slice(1).find((player) => !player.golfId?.trim());
    if (extraPlayerWithoutGolfId) {
      throw new Error(
        `Cannot add ${extraPlayerWithoutGolfId.name} without golfId/member number. Guest booking is not mapped for the official adapter yet.`
      );
    }

    let effectiveRequest = request;
    const slotDetail = await this.loadSlotFromDayGrid(slot).catch(() => undefined);
    if (slotDetail && normalizeGuid(slotDetail.slot.resourceGuid) !== normalizeGuid(slot.resourceGuid)) {
      slot = slotDetail.slot;
      effectiveRequest = {
        ...request,
        slotId: slotIdFromSlot(slot)
      };
    }

    if (slotDetail && isTruthy(readAttr(slotDetail.attrs, "isTooFarAheadPortal"))) {
      throw new Error(
        `GolfBox lists this tee time at ${formatGolfBoxDateTime(slot.teeTime)}, but booking is not open yet. Try again closer to the start date.`
      );
    }

    // NGF / useNewApp accounts expose no MobileHub day grid, so loadSlotFromDayGrid returns
    // nothing and the MobileHub booking session below can never be opened. For these accounts
    // the authenticated web booking grid is the only way to reserve a tee time.
    if (!slotDetail && this.hasCredentials()) {
      const webDetail: SlotDayGridDetail = { slot, attrs: {}, clubGuid: slot.memberClubGuid };
      return this.createBookingViaWebPortal(slot, effectiveRequest, webDetail);
    }

    if (slotDetail && shouldUseWebPortalBooking(slotDetail.attrs)) {
      return this.createBookingViaWebPortal(slot, effectiveRequest, slotDetail);
    }

    let session: TeeTimeResponse;
    try {
      session = await this.tryEditTeeTime(slot);
    } catch (error) {
      const refreshedSlot = await this.refreshSlotAfterTryEditFailure(slot, error);
      if (!refreshedSlot) {
        throw error;
      }

      slot = refreshedSlot;
      effectiveRequest = {
        ...request,
        slotId: slotIdFromSlot(slot)
      };
      session = await this.tryEditTeeTime(slot);
    }

    const sessionKey = readSessionKey(session);
    if (!sessionKey) {
      throw new Error("GolfBox did not return a booking session key.");
    }

    let saveWasAttempted = false;
    try {
      if (toOptionalBoolean(session.IsReadOnly ?? session.isReadOnly)) {
        const reason = toOptionalString(session.ReadOnlyReason ?? session.readOnlyReason) ?? "no reason supplied";
        throw new Error(`GolfBox opened this tee time as read-only: ${reason}`);
      }

      await this.addRequestedPlayers(sessionKey, slot, user, request.players);
      ensureBookingCanBeSavedWithoutPayment(session);
      await this.loadWarningsForTeeTime(slot);
      saveWasAttempted = true;
      await this.saveTeeTime(sessionKey);

      const saved = await this.findPlayerTeeTimeForSlot(slot, this.saveReconciliationDelaysMs);
      if (saved) {
        return mapBookingFromTeeTime(saved, effectiveRequest, slot);
      }

      return mapAcceptedSaveWithoutVerification(effectiveRequest, slot);
    } catch (error) {
      if (saveWasAttempted) {
        const reconciled = await this.reconcileSaveFailure(slot, effectiveRequest, error);
        if (reconciled) {
          return reconciled;
        }

        if (!(error instanceof GolfBoxRequestTimeoutError)) {
          await this.releaseBookingSession(slot, sessionKey);
        }

        throw error;
      }

      await this.releaseBookingSession(slot, sessionKey);
      throw error;
    }
  }

  private async refreshSlotAfterTryEditFailure(slot: SlotKey, error: unknown): Promise<SlotKey | undefined> {
    if (!(error instanceof GolfBoxHttpError) || error.apiCode !== "NO_VALID_SESSION_FOUND") {
      return undefined;
    }

    let refreshedSlot: SlotKey | undefined;
    try {
      refreshedSlot = await this.refreshSlotFromDayGrid(slot);
    } catch {
      // Preserve the original tryEditTeeTime error; this fallback is only a repair attempt for stale slot ids.
      return undefined;
    }

    if (refreshedSlot && normalizeGuid(refreshedSlot.resourceGuid) !== normalizeGuid(slot.resourceGuid)) {
      return refreshedSlot;
    }

    return undefined;
  }

  private async refreshSlotFromDayGrid(slot: SlotKey): Promise<SlotKey | undefined> {
    return (await this.loadSlotFromDayGrid(slot))?.slot;
  }

  private async loadSlotFromDayGrid(slot: SlotKey): Promise<SlotDayGridDetail | undefined> {
    const date = golfBoxDateTimeToIsoDate(slot.teeTime);
    const timeOfDay = golfBoxDateTimeToTimeOfDay(slot.teeTime);
    const xml = await this.authorizedTextRequest(
      `/teeTime/booking?methodName=teeTimesForDay&resourceGuid=${encodeURIComponent(slot.resourceGuid)}` +
        `&teeTime=${encodeURIComponent(toGolfBoxDate(date))}` +
        `&memberclubguid=${encodeURIComponent(slot.memberClubGuid)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/xml"
        }
      }
    );

    const setup = findFirstXmlTag(xml, "Setup")?.attrs ?? {};
    const bookingResourceGuid =
      readAttr(setup, "Ressource_GUID", "Resource_GUID", "ResourceGuid", "ResourceGUID") ?? slot.resourceGuid;
    const clubGuid = readAttr(setup, "Club_GUID", "ClubGuid", "ClubGUID");
    const matchingSlot = findXmlTags(xml, "slot").find((candidate) => readSlotTime(candidate.attrs) === timeOfDay);
    if (!matchingSlot) {
      return undefined;
    }

    const detail: SlotDayGridDetail = {
      slot: {
        resourceGuid: stripGuidBraces(bookingResourceGuid),
        teeTime: slot.teeTime,
        memberClubGuid: slot.memberClubGuid
      },
      attrs: matchingSlot.attrs
    };
    if (clubGuid) {
      detail.clubGuid = stripGuidBraces(clubGuid);
    }

    return detail;
  }

  private async createBookingViaWebPortal(
    slot: SlotKey,
    request: CreateBookingRequest,
    detail: SlotDayGridDetail
  ): Promise<Booking> {
    if (!this.hasCredentials()) {
      throw new Error(
        "This tee time is only open in the GolfBox web portal, but web booking requires username/password credentials."
      );
    }

    if (request.players.length > 4) {
      throw new Error("GolfBox supports at most 4 players per tee-time booking.");
    }
    const additionalPlayers = request.players.slice(1);
    for (const player of additionalPlayers) {
      if (!player.golfId?.trim()) {
        throw new Error(
          `Cannot add ${player.name} to the booking without a GolfBox member number (golfId).`
        );
      }
    }

    const session = await this.getWebSession();
    const clubGuid = detail.clubGuid ?? slot.memberClubGuid;
    const windowPath =
      `/site/my_golfbox/ressources/booking/window.asp?Ressource_GUID=${encodeURIComponent(toWebGuid(slot.resourceGuid))}` +
      `&Booking_Start=${encodeURIComponent(slot.teeTime)}` +
      `&club_GUID=${encodeURIComponent(toWebGuid(clubGuid))}`;
    const page = await this.webTextRequest(session, windowPath, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });

    if (isWebLockedPage(page.url, page.text)) {
      throw new Error(
        "GolfBox web portal says this tee time is currently locked or another booking window is already open for this user. Wait for the lock to expire before retrying."
      );
    }

    if (!isWebBookingWindow(page.text)) {
      throw new Error("GolfBox web portal did not open a booking window for this tee time.");
    }

    // Phase 1: resolve each additional player by member number using a "search only"
    // postback. This mirrors the per-row search button in the GolfBox UI
    // (cmdSubmit_Click(true, rowIndex) -> activates txtSearchAble_N, sets chkSearchOnly,
    // posts command=next). The server re-renders the form with guid_N / txt_Name_N
    // populated when it finds the member, or leaves guid_N empty when the number is unknown.
    let currentPage = page;
    for (let i = 0; i < additionalPlayers.length; i++) {
      const rowIndex = i + 1;
      const player = additionalPlayers[i];
      const memberNumber = player.golfId!.trim();

      const searchForm = parseWebFormFields(currentPage.text);
      searchForm.set(`txt_MemberClubID_${rowIndex}`, memberNumber);
      searchForm.set(`GBDropDown_SelectedOption_ddlUnion_${rowIndex}`, "NO");
      searchForm.delete("txtSearchAble");
      searchForm.append("txtSearchAble", String(rowIndex));
      searchForm.set("chkSearchOnly", "on");
      searchForm.set("command", "next");
      searchForm.set("commandValue", "");

      try {
        currentPage = await this.webTextRequest(session, page.url, {
          method: "POST",
          headers: {
            Accept: "text/html",
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: page.url
          },
          body: searchForm.toString()
        });
      } catch (error) {
        await this.cancelWebBookingWindow(session, page.url, currentPage.text);
        throw error;
      }

      const resolved = parseWebFormFields(currentPage.text);
      const resolvedGuid = resolved.get(`guid_${rowIndex}`)?.trim();
      if (!resolvedGuid) {
        const lookupError = readWebPortalError(currentPage.text);
        await this.cancelWebBookingWindow(session, page.url, currentPage.text);
        throw new Error(
          `GolfBox could not find member "${memberNumber}" (${player.name}) to add to this booking.` +
            (lookupError ? ` ${lookupError}` : "")
        );
      }
    }

    // Phase 2: confirm the booking for the booker + all resolved players. Mirrors the
    // approve button (cmdSubmit_Click(false, 99) -> activate all player rows, no
    // chkSearchOnly, post command=next).
    const form = parseWebFormFields(currentPage.text);
    form.delete("txtSearchAble");
    for (let i = 0; i < additionalPlayers.length; i++) {
      form.append("txtSearchAble", String(i + 1));
    }
    form.delete("chkSearchOnly");
    form.set("command", "next");
    form.set("commandValue", "");

    let submitPage: WebTextResponse;
    try {
      submitPage = await this.webTextRequest(session, page.url, {
        method: "POST",
        headers: {
          Accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: page.url
        },
        body: form.toString()
      });
    } catch (error) {
      await this.cancelWebBookingWindow(session, page.url, currentPage.text);
      throw error;
    }

    const portalError = readWebPortalError(submitPage.text);
    if (portalError) {
      throw new Error(`GolfBox web portal did not confirm the booking: ${portalError}`);
    }

    if (isWebLockedPage(submitPage.url, submitPage.text)) {
      throw new Error(
        "GolfBox web portal says this tee time is currently locked or another booking window is already open for this user."
      );
    }

    const portalAccepted = isWebBookingAcceptedPage(submitPage.url, submitPage.text);
    const saved = await this.findPlayerTeeTimeForSlot(slot, portalAccepted ? [0, 1_500] : this.saveReconciliationDelaysMs);
    if (saved) {
      return mapBookingFromTeeTime(saved, request, slot, "Saved through the GolfBox web portal.");
    }

    if (portalAccepted) {
      return mapConfirmedWebPortalSubmission(request, slot);
    }

    return mapPendingWebPortalSubmission(request, slot);
  }

  private async cancelWebBookingWindow(session: WebCookieJar, pageUrl: string, pageText: string): Promise<void> {
    try {
      const form = parseWebFormFields(pageText);
      form.set("command", "cancel");
      form.set("commandValue", "");
      await this.webTextRequest(session, pageUrl, {
        method: "POST",
        headers: {
          Accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: pageUrl
        },
        body: form.toString()
      });
    } catch {
      // Keep the original booking error. GolfBox will also expire abandoned web locks.
    }
  }

  private async tryEditTeeTime(slot: SlotKey): Promise<TeeTimeResponse> {
    const response = await this.authorizedJsonRequest<unknown>("/teeTime/booking?methodName=tryEditTeeTime", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ResourceGuid: slot.resourceGuid,
        TeeTime: slot.teeTime,
        MemberClubGuid: slot.memberClubGuid
      })
    });

    return parseTeeTimeResponse(response);
  }

  private async addRequestedPlayers(
    sessionKey: string,
    slot: SlotKey,
    user: AuthenticatedUser,
    players: CreateBookingRequest["players"]
  ): Promise<void> {
    const additionalPlayers = players.slice(1);
    for (const player of additionalPlayers) {
      if (!player.golfId?.trim()) {
        throw new Error(
          `Cannot add ${player.name} without golfId/member number. Guest booking is not mapped for the official adapter yet.`
        );
      }

      const resolvedPlayer = await this.resolvePlayerForSession(sessionKey, slot, user, player);
      await this.addPlayerToTeeTime(sessionKey, resolvedPlayer);
    }
  }

  private async resolvePlayerForSession(
    sessionKey: string,
    slot: SlotKey,
    user: AuthenticatedUser,
    player: CreateBookingRequest["players"][number]
  ): Promise<ResolvedPlayer> {
    const golfId = player.golfId?.trim();
    if (!golfId) {
      throw new Error(`Cannot resolve ${player.name} without golfId/member number.`);
    }

    if (looksLikeGuid(golfId)) {
      return {
        playerGuid: stripGuidBraces(golfId),
        clubGuid: user.clubGuid ?? slot.memberClubGuid,
        name: player.name
      };
    }

    const params = new URLSearchParams({
      methodName: "searchPlayerForTeeTime",
      sessionKey,
      searchInCountry: this.country,
      name: player.name,
      memberNumber: golfId,
      club: user.clubName ?? ""
    });
    const response = await this.authorizedJsonRequest<unknown>(`/teeTime/booking?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const matches = parsePlayerSearchResults(response);
    const selected = selectPlayerSearchMatch(matches, player);
    if (!selected) {
      throw new Error(`Could not find GolfBox member ${player.name} (${golfId}) for this tee time.`);
    }

    return {
      ...selected,
      clubGuid: selected.clubGuid || user.clubGuid || slot.memberClubGuid
    };
  }

  private async addPlayerToTeeTime(sessionKey: string, player: ResolvedPlayer): Promise<void> {
    await this.authorizedJsonRequest<unknown>("/teeTime/booking?methodName=addPlayerToTeeTime", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        SessionGuid: sessionKey,
        PlayerGuid: player.playerGuid,
        ClubGuid: player.clubGuid,
        ConfirmBy: "TeeTime",
        ConfirmableByApp: true,
        ConfirmationWindowOpen: true
      })
    });
  }

  private async loadWarningsForTeeTime(slot: SlotKey): Promise<void> {
    try {
      await this.authorizedTextRequest(
        `/teeTime/booking?methodName=warningsForTeeTimeOnResource&resourceGuid=${encodeURIComponent(slot.resourceGuid)}` +
          `&teeTime=${encodeURIComponent(slot.teeTime)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        }
      );
    } catch {
      // Android loads warnings before saving, but warnings are advisory and should not block booking.
    }
  }

  private async saveTeeTime(sessionKey: string): Promise<void> {
    await this.authorizedTextRequest(
      `/teeTime/booking?methodName=saveTeeTime&sessionKey=${encodeURIComponent(sessionKey)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      },
      { timeoutMs: this.saveTeeTimeTimeoutMs }
    );
  }

  private async reconcileSaveFailure(
    slot: SlotKey,
    request: CreateBookingRequest,
    error: unknown
  ): Promise<Booking | undefined> {
    const existingBooking = await this.findPlayerTeeTimeForSlot(slot, this.saveReconciliationDelaysMs);
    if (existingBooking) {
      return mapBookingFromTeeTime(existingBooking, request, slot, "Verified in GolfBox after saveTeeTime returned an unclear result.");
    }

    if (error instanceof GolfBoxRequestTimeoutError) {
      return {
        bookingId: request.slotId,
        status: "pending",
        slotId: request.slotId,
        summary:
          `GolfBox saveTeeTime timed out for ${formatGolfBoxDateTime(slot.teeTime)}, ` +
          "and the tee time was not visible in teeTimesForPlayer yet. Verify in GolfBox before retrying."
      };
    }

    return undefined;
  }

  private async findPlayerTeeTimeForSlot(
    slot: SlotKey,
    delaysMs: readonly number[] = [0]
  ): Promise<TeeTimeResponse | undefined> {
    for (const delayMs of delaysMs) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      try {
        const teeTimes = await this.listPlayerTeeTimes();
        const match = findTeeTimeForSlot(teeTimes, slot);
        if (match) {
          return match;
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async listPlayerTeeTimes(): Promise<TeeTimeResponse[]> {
    const response = await this.authorizedJsonRequest<unknown>("/teeTime/booking?methodName=teeTimesForPlayer", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    return parseTeeTimeResponses(response);
  }

  private async releaseBookingSession(slot: SlotKey, sessionKey: string): Promise<void> {
    try {
      await this.authorizedJsonRequest<unknown>(
        `/teeTime/booking?methodName=deleteSession&sessionKey=${encodeURIComponent(sessionKey)}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json"
          }
        }
      );
    } catch {
      // Continue to the explicit lock endpoint; cleanup should not mask the original booking error.
    }

    try {
      await this.authorizedJsonRequest<unknown>("/teeTime/locks?methodName=deleteLock", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          LockGuid: sessionKey,
          ResourceGuid: slot.resourceGuid,
          TeeTime: slot.teeTime
        })
      });
    } catch {
      // Nothing more to do; the original error remains the actionable one.
    }
  }

  private async authorizedJsonRequest<T>(
    path: string,
    init: RequestInit,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    return this.authorizedRequest((token) => this.jsonRequest<T>(path, init, token, options));
  }

  private async authorizedTextRequest(
    path: string,
    init: RequestInit,
    options: { timeoutMs?: number } = {}
  ): Promise<string> {
    return this.authorizedRequest(async (token) => {
      const response = await this.request(path, init, token, options);
      return this.textResponse(response);
    });
  }

  private async authorizedRequest<T>(requester: (token: string) => Promise<T>): Promise<T> {
    let authToken = await this.getToken();

    try {
      return await requester(authToken.token);
    } catch (error) {
      if (error instanceof GolfBoxHttpError && error.status === 401 && this.hasCredentials()) {
        authToken = await this.getToken({ forceRefresh: true });
        return await requester(authToken.token);
      }

      throw error;
    }
  }

  private async getToken(options: { forceRefresh?: boolean } = {}): Promise<AuthToken> {
    if (!options.forceRefresh && this.cachedToken) {
      return this.cachedToken;
    }

    if (!this.hasCredentials()) {
      throw new Error(
        "GolfBox authentication is not configured. Set GOLFBOX_USERNAME and GOLFBOX_PASSWORD, or provide GOLFBOX_API_TOKEN."
      );
    }

    const token = await this.requestAuthenticationToken();
    this.cachedToken = {
      token,
      source: "credentials"
    };

    return this.cachedToken;
  }

  private hasCredentials(): boolean {
    return Boolean(this.options.username?.trim() && this.options.password?.trim());
  }

  private async requestAuthenticationToken(): Promise<string> {
    const username = this.options.username?.trim();
    const password = this.options.password?.trim();
    if (!username || !password) {
      throw new Error("GolfBox username/password is required to request a fresh authentication token.");
    }

    const response = await this.request(
      `/authentication?methodName=authenticate&country=${encodeURIComponent(this.country)}`,
      {
        method: "POST",
        headers: {
          Accept: "text/plain",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          Username: username,
          Password: password
        })
      }
    );

    const token = (await this.textResponse(response)).trim();
    if (!token) {
      throw new Error("GolfBox authentication returned an empty token.");
    }

    return token;
  }

  private async loginWithToken(token: string): Promise<AuthenticatedGolfBoxUser> {
    const response = await this.jsonRequest<MobileHubUserResponse>(
      `/profile/member?methodName=login&country=${encodeURIComponent(this.country)}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      },
      token
    );

    this.cachedUser = mapUser(response);
    return this.cachedUser;
  }

  private async getAuthenticatedUser(): Promise<AuthenticatedGolfBoxUser> {
    if (this.cachedUser) {
      return this.cachedUser;
    }

    await this.authenticate();
    return this.cachedUser ?? {};
  }

  private async readNewAppRouteHint(): Promise<string | undefined> {
    try {
      const response = await this.authorizedJsonRequest<ValidateClientResponse>(
        `/appLogic?methodName=validateClientv3&country=${encodeURIComponent(this.country)}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            OS: "Android",
            OSVersion: "14",
            AppVersion: this.appVersion
          })
        }
      );

      const frontPageUrl = toOptionalString(response.FrontPageURL ?? response.frontPageURL);
      if (!frontPageUrl) {
        return undefined;
      }

      if (/golfbox\.no/i.test(frontPageUrl)) {
        return "GolfBox validateClientv3 routes Norwegian useNewApp accounts through the Gimmie replacement flow.";
      }

      return `GolfBox validateClientv3 returned a new-app route on ${redactSensitiveText(frontPageUrl)}.`;
    } catch {
      return undefined;
    }
  }

  private async listGimmieUpcomingTeeTimes(
    user: AuthenticatedGolfBoxUser,
    fromDate: string,
    untilDate: string
  ): Promise<UpcomingTeeTime[]> {
    if (!this.hasCredentials()) {
      throw new Error(
        buildEmptyUseNewAppTeeTimesError(
          undefined,
          "Gimmie/new-app lookup needs GolfBox username/password because a MobileHub API token cannot complete the GolfBox OAuth flow."
        )
      );
    }

    const token = await this.authenticateWithGimmie();
    const response = await this.gimmieGraphql<GimmieTeeTimesResponse>(
      {
        query:
          "query NextTeeTime { teeTimesWithProviders { bookingId teeTime clubName guideName org confirmedSkeletonId players { memberId name } } }"
      },
      { "x-auth-token": token }
    );

    const teeTimes = Array.isArray(response.teeTimesWithProviders) ? response.teeTimesWithProviders : [];
    return teeTimes
      .map((teeTime) => mapUpcomingTeeTimeFromGimmie(teeTime, user, fromDate, untilDate))
      .filter((teeTime): teeTime is UpcomingTeeTime => teeTime !== undefined);
  }

  private async listWebPortalUpcomingTeeTimes(
    user: AuthenticatedGolfBoxUser,
    fromDate: string,
    untilDate: string
  ): Promise<UpcomingTeeTime[]> {
    if (!this.hasCredentials()) {
      throw new Error("GolfBox username/password is required for web portal Mine tider lookup.");
    }

    const { session, gridPage } = await this.openWebBookingGrid();
    const myTimesPath = findWebMyTimesPath(gridPage.text);
    if (!myTimesPath) {
      throw new Error("GolfBox web portal did not expose a Mine tider link.");
    }

    const myTimesPage = await this.webTextRequest(session, myTimesPath, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });

    return parseWebUpcomingTeeTimes(myTimesPage.text, user, fromDate, untilDate);
  }

  private async authenticateWithGimmie(): Promise<string> {
    const username = this.options.username?.trim();
    const password = this.options.password?.trim();
    if (!username || !password) {
      throw new Error("GolfBox username/password is required for Gimmie authentication.");
    }

    const cookies = new Map<string, Map<string, string>>();
    const init = await this.gimmieGraphql<{ initGolfboxOauth?: unknown }>({
      query:
        "mutation initGolfboxAuthMutation($union: GBUnion!, $returnTo: String!) { initGolfboxOauth(union: $union, returnTo: $returnTo) }",
      variables: { union: "NGF", returnTo: "com.glfr.ngf://" }
    });
    const authorizeUrl = toOptionalString(init.initGolfboxOauth);
    if (!authorizeUrl) {
      throw new Error("Gimmie did not return a GolfBox OAuth URL.");
    }

    let response = await this.externalRequest(authorizeUrl, { method: "GET", headers: { Accept: "text/html,*/*" } }, cookies);
    let location = response.headers.get("location");
    if (!isRedirect(response) || !location) {
      throw new Error(`Gimmie GolfBox OAuth did not redirect to login (${response.status}).`);
    }

    const loginUrl = new URL(location, authorizeUrl).href;
    response = await this.externalRequest(loginUrl, { method: "GET", headers: { Accept: "text/html,*/*" } }, cookies);
    const loginHtml = await response.text();
    const antiForgeryToken = decodeHtmlAttribute(
      loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1]
    );
    const returnUrl = decodeHtmlAttribute(loginHtml.match(/name="ReturnUrl"[^>]*value="([^"]*)"/)?.[1]);
    if (!antiForgeryToken || !returnUrl) {
      throw new Error("GolfBox OAuth login form did not include expected anti-forgery fields.");
    }

    response = await this.externalRequest(
      loginUrl,
      {
        method: "POST",
        headers: {
          Accept: "text/html,*/*",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: new URL(loginUrl).origin,
          Referer: loginUrl
        },
        body: new URLSearchParams({
          ReturnUrl: returnUrl,
          username,
          password,
          __RequestVerificationToken: antiForgeryToken
        })
      },
      cookies
    );
    location = response.headers.get("location");
    if (!isRedirect(response) || !location) {
      throw new Error(`GolfBox OAuth login did not redirect (${response.status}).`);
    }

    response = await this.externalRequest(new URL(location, loginUrl).href, { method: "GET", headers: { Accept: "text/html,*/*" } }, cookies);
    location = response.headers.get("location");
    if (!isRedirect(response) || !location) {
      throw new Error(`GolfBox OAuth callback did not redirect (${response.status}).`);
    }

    response = await this.externalRequest(location, { method: "GET", headers: { Accept: "text/html,*/*" } }, cookies);
    location = response.headers.get("location");
    if (!isRedirect(response) || !location?.startsWith("com.glfr.ngf://")) {
      throw new Error(`Gimmie OAuth did not return the expected app redirect (${response.status}).`);
    }

    const deepLink = new URL(location);
    const providerToken = deepLink.pathname.split("/").filter(Boolean)[0] || deepLink.hostname;
    const continued = await this.gimmieGraphql<GimmieContinueWithAuthResponse>({
      query:
        "mutation continueWithGolfbox($token: ID!, $provider: AuthProvider!) { continueWithAuth(input: { provider: $provider, token: $token }) { id otp } }",
      variables: { token: providerToken, provider: "NGF" }
    });
    const gimmieUserId = toOptionalString(continued.continueWithAuth?.id);
    const otp = toOptionalString(continued.continueWithAuth?.otp);
    if (!gimmieUserId || !otp) {
      throw new Error("Gimmie continueWithAuth did not return a user id and OTP.");
    }

    const auth = await this.gimmieGraphql<GimmieAuthMeResponse>({
      query: "query Query($input: AuthMeInput!) { AuthQueries { authMe(input: $input) { token } } }",
      variables: { input: { username: gimmieUserId, password: otp, provider: "NGF" } }
    });
    const token = toOptionalString(auth.AuthQueries?.authMe?.token);
    if (!token) {
      throw new Error("Gimmie authMe did not return an access token.");
    }

    return token;
  }

  private async gimmieGraphql<T>(body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.externalRequest(OfficialGolfBoxClient.gimmieGraphqlUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed: GimmieGraphqlResponse<T>;
    try {
      parsed = JSON.parse(text) as GimmieGraphqlResponse<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gimmie returned invalid JSON: ${message}`);
    }

    if (!response.ok || parsed.errors?.length) {
      const message = parsed.errors?.map((item) => toOptionalString(item.message)).filter(Boolean).join("; ");
      throw new Error(`Gimmie GraphQL request failed (${response.status})${message ? `: ${message}` : ""}.`);
    }

    if (!parsed.data) {
      throw new Error("Gimmie GraphQL response did not include data.");
    }

    return parsed.data;
  }

  private async externalRequest(
    url: string,
    init: RequestInit,
    cookies?: Map<string, Map<string, string>>
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookies) {
      const cookie = readCookieHeader(cookies, url);
      if (cookie) {
        headers.set("Cookie", cookie);
      }
    }

    const { response, timedOut } = await fetchWithTimeout(
      new URL(url),
      {
        ...init,
        redirect: "manual",
        headers
      },
      this.requestTimeoutMs
    );
    if (timedOut) {
      throw new GolfBoxRequestTimeoutError(this.requestTimeoutMs, url);
    }

    if (cookies) {
      storeResponseCookies(cookies, url, response);
    }

    return response;
  }

  private async listResourcesForClub(clubGuid: string): Promise<TeeResource[]> {
    const response = await this.authorizedJsonRequest<
      TeeResourceResponse[] | { Resources?: TeeResourceResponse[]; TeeResources?: TeeResourceResponse[] }
    >(`/teeTime/booking?methodName=resourcesForClub&clubGuid=${encodeURIComponent(clubGuid)}`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const resources = Array.isArray(response)
      ? response
      : Array.isArray(response.Resources)
        ? response.Resources
        : Array.isArray(response.TeeResources)
          ? response.TeeResources
          : [];

    return resources
      .map((resource) => {
        const guid = toOptionalString(resource.Guid ?? resource.ResourceGuid ?? resource.ID);
        const name = toOptionalString(resource.Name ?? resource.ResourceName);
        if (!guid || !name) {
          return undefined;
        }

        const mapped: TeeResource = {
          guid,
          name
        };
        const resourceClubGuid = toOptionalString(resource.ClubGuid);
        if (resourceClubGuid) {
          mapped.clubGuid = resourceClubGuid;
        }

        return mapped;
      })
      .filter((resource): resource is TeeResource => resource !== undefined);
  }

  private async listWebResourcesForClub(clubGuid: string): Promise<TeeResource[]> {
    if (!this.hasCredentials()) {
      return [];
    }

    try {
      const session = await this.getWebSession();
      const clubGuidForWeb = toWebGuid(clubGuid);
      const page = await this.webTextRequest(
        session,
        `/site/my_golfbox/ressources/booking/grid.asp?Club_GUID=${encodeURIComponent(clubGuidForWeb)}`,
        {
          method: "GET",
          headers: {
            Accept: "text/html"
          }
        }
      );
      if (isWebGridBounce(page.text)) {
        this.cachedWebSession = undefined;
        this.cachedWebSessionAt = undefined;
        return [];
      }

      const resources = parseWebBookingResources(page.text, page.url);
      return resources.map((resource) => ({
        ...resource,
        clubGuid
      }));
    } catch {
      return [];
    }
  }

  private async searchWebTeeTimePlayers(
    search: TeeTimePlayerSearch,
    memberClubGuid: string
  ): Promise<TeeTimePlayerMatch[]> {
    const { session, gridPage } = await this.openWebBookingGrid();
    const clubPage = await this.postWebGridForm(session, gridPage, {
      command: "getClub",
      commandValue: "",
      fields: {
        ddlClub: stripGuidBraces(search.clubId)
      }
    });
    const resources = parseWebBookingResources(clubPage.text, clubPage.url);
    const selectedResources =
      resources.length > 0 ? resources : [{ guid: search.clubId, name: "GolfBox web grid" } satisfies TeeResource];
    const matches: TeeTimePlayerMatch[] = [];

    for (const resource of selectedResources) {
      const resourcePage = await this.postWebGridForm(session, clubPage, {
        command: "changeRessource",
        commandValue: "",
        fields: {
          ddlClub: stripGuidBraces(search.clubId),
          ddlRessource_GUID: toWebGuid(resource.guid)
        }
      });
      const datePage = await this.postWebGridForm(session, resourcePage, {
        command: "calendar1_select",
        commandValue: `${toGolfBoxDate(search.date)}T000000`,
        fields: {
          ddlClub: stripGuidBraces(search.clubId),
          ddlRessource_GUID: toWebGuid(resource.guid),
          BookingDate: toWebBookingDate(search.date),
          chkShow_Names: "1",
          chkShowPlayerDetails: "on"
        }
      });

      matches.push(...parseWebTeeTimePlayerMatches(datePage.text, search, resource, memberClubGuid));
    }

    return matches;
  }

  private async searchWebTeeTimes(search: TeeTimeSearch, memberClubGuid: string): Promise<TeeTimeSlot[]> {
    const { session, gridPage } = await this.openWebBookingGrid();
    const clubPage = await this.postWebGridForm(session, gridPage, {
      command: "getClub",
      commandValue: "",
      fields: {
        ddlClub: stripGuidBraces(search.clubId)
      }
    });
    const resources = parseWebBookingResources(clubPage.text, clubPage.url);
    const selectedResources =
      resources.length > 0 ? resources : [{ guid: search.clubId, name: "GolfBox web grid" } satisfies TeeResource];
    const slots: TeeTimeSlot[] = [];

    for (const resource of selectedResources) {
      const resourcePage = await this.postWebGridForm(session, clubPage, {
        command: "changeRessource",
        commandValue: "",
        fields: {
          ddlClub: stripGuidBraces(search.clubId),
          ddlRessource_GUID: toWebGuid(resource.guid)
        }
      });
      const datePage = await this.postWebGridForm(session, resourcePage, {
        command: "calendar1_select",
        commandValue: `${toGolfBoxDate(search.date)}T000000`,
        fields: {
          ddlClub: stripGuidBraces(search.clubId),
          ddlRessource_GUID: toWebGuid(resource.guid),
          BookingDate: toWebBookingDate(search.date),
          chkShow_Names: "1",
          chkShowPlayerDetails: "on"
        }
      });

      slots.push(...parseWebGridAvailability(datePage.text, search, resource, memberClubGuid));
    }

    return slots;
  }

  private async postWebGridForm(
    session: WebCookieJar,
    page: WebTextResponse,
    options: { command: string; commandValue: string; fields: Record<string, string> }
  ): Promise<WebTextResponse> {
    const form = parseWebFormFields(page.text);
    form.set("command", options.command);
    form.set("commandValue", options.commandValue);
    for (const [name, value] of Object.entries(options.fields)) {
      form.set(name, value);
    }

    return this.webTextRequest(session, page.url, {
      method: "POST",
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: page.url
      },
      body: form.toString()
    });
  }

  private async createWebSession(): Promise<WebCookieJar> {
    const session = new WebCookieJar();
    await this.webTextRequest(
      session,
      "/site/system/redirect.asp?locale=nb_NO&rUrl=%2Fsite%2Fressources%2Fbooking%2Fgrid.asp",
      {
        method: "GET",
        headers: {
          Accept: "text/html"
        }
      },
      { followRedirects: false }
    );

    const username = this.options.username?.trim();
    const password = this.options.password?.trim();
    if (!username || !password) {
      throw new Error("GolfBox username/password is required for web booking resource discovery.");
    }

    const rUrl = "/site/ressources/booking/grid.asp";
    const loginPage = await this.webTextRequest(
      session,
      `/login.asp?rUrl=${encodeURIComponent(rUrl)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: this.webBaseUrl.slice(0, -1),
          Referer: new URL(
            "/site/system/redirect.asp?locale=nb_NO&rUrl=%2Fsite%2Fressources%2Fbooking%2Fgrid.asp",
            this.webBaseUrl
          ).toString()
        },
        body: new URLSearchParams({
          "loginform.submitted": "true",
          command: "login",
          "loginform.rurl": rUrl,
          "loginform.username": username,
          "loginform.password": password
        }).toString()
      }
    );
    if (isWebLoginFailurePage(loginPage.text)) {
      throw new Error("GolfBox web login failed.");
    }

    const bookingPage = await this.webTextRequest(session, rUrl, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });
    if (isWebLoginFailurePage(bookingPage.text)) {
      throw new Error("GolfBox web login did not create an authenticated session.");
    }

    // Verify the actual booking-grid surface is reachable. A throttled/expired login still
    // returns a redirect-only session that bounces the grid to the public site.
    const gridPage = await this.webTextRequest(session, WEB_BOOKING_GRID_PATH, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });
    if (isWebGridBounce(gridPage.text)) {
      throw new Error("GolfBox web session was not authenticated (booking grid bounced to public site).");
    }

    return session;
  }

  private async getWebSession(forceNew = false): Promise<WebCookieJar> {
    const now = Date.now();
    if (
      !forceNew &&
      this.cachedWebSession &&
      this.cachedWebSessionAt !== undefined &&
      now - this.cachedWebSessionAt < WEB_SESSION_TTL_MS
    ) {
      return this.cachedWebSession;
    }

    this.cachedWebSession = undefined;
    this.cachedWebSessionAt = undefined;

    // Deliberately attempt the login only once. A bounced grid means GolfBox is
    // rate-limiting logins, and retrying immediately only deepens the throttle.
    const session = await this.createWebSession();
    this.cachedWebSession = session;
    this.cachedWebSessionAt = Date.now();
    return session;
  }

  private async openWebBookingGrid(): Promise<{ session: WebCookieJar; gridPage: WebTextResponse }> {
    // A freshly created session is grid-validated inside createWebSession, so a bounce
    // here can only come from a stale *cached* session. Re-login at most once.
    let session = await this.getWebSession();
    let gridPage = await this.webTextRequest(session, WEB_BOOKING_GRID_PATH, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });
    if (!isWebGridBounce(gridPage.text)) {
      return { session, gridPage };
    }

    this.cachedWebSession = undefined;
    this.cachedWebSessionAt = undefined;
    session = await this.getWebSession(true);
    gridPage = await this.webTextRequest(session, WEB_BOOKING_GRID_PATH, {
      method: "GET",
      headers: {
        Accept: "text/html"
      }
    });
    if (!isWebGridBounce(gridPage.text)) {
      return { session, gridPage };
    }

    throw new Error(
      "GolfBox web booking grid is currently unavailable (the session was bounced to the public site). " +
        "This usually means the GolfBox login is being temporarily rate-limited; wait a minute and try again."
    );
  }

  private async webTextRequest(
    session: WebCookieJar,
    path: string,
    init: RequestInit,
    options: { followRedirects?: boolean; remainingRedirects?: number } = {}
  ): Promise<WebTextResponse> {
    const followRedirects = options.followRedirects ?? true;
    const remainingRedirects = options.remainingRedirects ?? 8;
    const url = new URL(path, this.webBaseUrl);
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "Mozilla/5.0 CodexGolfBoxMCP");

    const cookie = session.header();
    if (cookie) {
      headers.set("Cookie", cookie);
    }

    const { response, timedOut } = await fetchWithTimeout(
      url,
      {
        ...init,
        redirect: "manual",
        headers
      },
      this.webRequestTimeoutMs
    );
    if (timedOut) {
      throw new GolfBoxRequestTimeoutError(this.webRequestTimeoutMs, url.pathname + url.search);
    }
    session.add(response);

    if (followRedirects && response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location && remainingRedirects > 0) {
        const redirectUrl = new URL(location, url);
        if (redirectUrl.origin !== new URL(this.webBaseUrl).origin) {
          throw new Error(`GolfBox web redirect left the trusted origin: ${redactSensitiveText(redirectUrl.toString())}`);
        }

        return this.webTextRequest(
          session,
          redirectUrl.toString(),
          {
            method: "GET",
            headers: {
              Accept: "text/html"
            }
          },
          {
            followRedirects,
            remainingRedirects: remainingRedirects - 1
          }
        );
      }
    }

    if (!response.ok && !(response.status >= 300 && response.status < 400)) {
      throw await this.toHttpError(response);
    }

    return {
      url: url.toString(),
      text: await response.text()
    };
  }

  private async jsonRequest<T>(
    path: string,
    init: RequestInit,
    token?: string,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    const response = await this.request(path, init, token, options);
    const text = await this.textResponse(response);
    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GolfBox returned invalid JSON: ${message}`);
    }
  }

  private async textResponse(response: Response): Promise<string> {
    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    return response.text();
  }

  private async request(
    path: string,
    init: RequestInit,
    token?: string,
    options: { timeoutMs?: number } = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Client-User-Agent", this.clientUserAgent);
    if (token) {
      headers.set("Authorization", token);
    }

    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

    try {
      const { response, timedOut } = await fetchWithTimeout(new URL(path, this.baseUrl), {
        ...init,
        headers
      }, timeoutMs);
      if (timedOut) {
        throw new GolfBoxRequestTimeoutError(timeoutMs, path);
      }

      this.responseContexts.set(response, {
        method: init.method ?? "GET",
        path
      });
      return response;
    } catch (error) {
      throw error;
    }
  }

  private async toHttpError(response: Response): Promise<GolfBoxHttpError> {
    const apiCode = response.headers.get("GolfBox-API-Error-Code");
    const apiMessage = response.headers.get("GolfBox-API-Error-Message");
    const mobileHubError = response.headers.get("MobileHub-Error");
    const body = this.includeErrorBodySnippets ? await response.text().catch(() => "") : "";
    const detail = apiMessage ?? mobileHubError;
    const context = this.responseContexts.get(response);
    const request = context ? ` for ${context.method} ${sanitizeErrorPath(context.path)}` : "";
    const code = apiCode ? ` code ${apiCode}` : "";
    const message = detail ? `: ${detail}` : "";
    const bodySnippet = body ? ` Body: ${redactSensitiveText(body).slice(0, 300)}` : "";
    const retryHint =
      apiCode === "NO_VALID_SESSION_FOUND" || apiCode === "TEETIME_ALREADY_LOCKED_BY_YOU"
        ? " Do not retry the same slot immediately; GolfBox may keep a temporary lock for this user."
        : "";

    return new GolfBoxHttpError(
      response.status,
      apiCode ?? undefined,
      `GolfBox request failed${request} (${response.status} ${response.statusText}${code})${message}.${bodySnippet}${retryHint}`
    );
  }

  private toAuthStatus(authToken: AuthToken, user: AuthenticatedUser): AuthStatus {
    const warnings: string[] = [];
    if (user.hasAccessToBooking === false) {
      warnings.push("Authenticated user does not have GolfBox booking access according to profile/member login.");
    }

    const { newAppSsoToken: _newAppSsoToken, ...safeUser } = user as AuthenticatedGolfBoxUser;

    return {
      provider: "official",
      baseUrl: this.baseUrl,
      country: this.country,
      authenticated: true,
      tokenSource: authToken.source,
      tokenPreview: redactToken(authToken.token),
      tokenLength: authToken.token.length,
      validatedWithLogin: true,
      user: safeUser,
      warnings
    };
  }

}

function defaultWebBaseUrl(country: string): string {
  return country.toUpperCase() === "NO" ? "https://www.golfbox.no/" : "https://www.golfbox.dk/";
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}


function toWebGuid(guid: string): string {
  const normalized = stripGuidBraces(guid).toUpperCase();
  return `{${normalized}}`;
}

function stripGuidBraces(guid: string): string {
  return guid.trim().replace(/^\{/, "").replace(/\}$/, "");
}

function parseSlotId(slotId: string): SlotKey | undefined {
  const parts = slotId.split("|");
  if (parts.length !== 3) {
    return undefined;
  }

  const [resourceGuid, teeTime, memberClubGuid] = parts.map((part) => part.trim());
  if (!resourceGuid || !/^\d{8}T\d{6}$/.test(teeTime) || !memberClubGuid) {
    return undefined;
  }

  return {
    resourceGuid: stripGuidBraces(resourceGuid),
    teeTime,
    memberClubGuid: stripGuidBraces(memberClubGuid)
  };
}

function slotIdFromSlot(slot: SlotKey): string {
  return `${slot.resourceGuid}|${slot.teeTime}|${slot.memberClubGuid}`;
}

function golfBoxDateTimeToIsoDate(teeTime: string): string {
  const normalized = normalizeGolfBoxDateTime(teeTime);
  if (normalized) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(teeTime)) {
    return teeTime.slice(0, 10);
  }

  return `${teeTime.slice(0, 4)}-${teeTime.slice(4, 6)}-${teeTime.slice(6, 8)}`;
}

function golfBoxDateTimeToTimeOfDay(teeTime: string): string {
  const normalized = normalizeGolfBoxDateTime(teeTime);
  if (normalized) {
    return `${normalized.slice(9, 11)}:${normalized.slice(11, 13)}`;
  }

  const isoTime = teeTime.match(/T(\d{2}):(\d{2})/);
  if (isoTime) {
    return `${isoTime[1]}:${isoTime[2]}`;
  }

  return `${teeTime.slice(9, 11)}:${teeTime.slice(11, 13)}`;
}

function formatGolfBoxDateTime(teeTime: string): string {
  if (!normalizeGolfBoxDateTime(teeTime) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(teeTime)) {
    return teeTime;
  }

  return `${golfBoxDateTimeToIsoDate(teeTime)} ${golfBoxDateTimeToTimeOfDay(teeTime)}`;
}

function normalizeGolfBoxDateTime(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }

  const compact = text.match(/^(\d{8})T(\d{6})$/);
  if (compact) {
    return `${compact[1]}T${compact[2]}`;
  }

  const isoLike = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoLike) {
    return `${isoLike[1]}${isoLike[2]}${isoLike[3]}T${isoLike[4]}${isoLike[5]}${isoLike[6] ?? "00"}`;
  }

  const microsoftDate = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (microsoftDate) {
    const timestamp = Number.parseInt(microsoftDate[1], 10);
    if (Number.isFinite(timestamp)) {
      return formatDateTimeInNorway(new Date(timestamp));
    }
  }

  return undefined;
}

function formatDateTimeInNorway(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}${values.get("month")}${values.get("day")}T${values.get("hour")}${values.get("minute")}${values.get("second")}`;
}

function todayNorwayDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function normalizeDaysAhead(daysAhead: number | undefined): number {
  if (daysAhead === undefined) {
    return 90;
  }

  return Math.min(Math.max(daysAhead, 1), 180);
}

function addDays(fromDate: string, days: number): string {
  const [year, month, day] = fromDate.split("-").map((part) => Number.parseInt(part, 10));
  const start = Date.UTC(year, month - 1, day);
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoDatePart(value: string): string | undefined {
  const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) {
    return isoDate[1];
  }

  const normalized = normalizeGolfBoxDateTime(value);
  return normalized ? golfBoxDateTimeToIsoDate(normalized) : undefined;
}

function normalizeIsoDateTime(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value;
  }

  return golfBoxDateTimeToIso(value);
}

function compareUpcomingTeeTimes(left: UpcomingTeeTime, right: UpcomingTeeTime): number {
  return left.startsAt.localeCompare(right.startsAt);
}

function upcomingClubFilters(search: Pick<UpcomingTeeTimeSearch, "clubId" | "clubIds">): Set<string> {
  return new Set(
    [search.clubId, ...(search.clubIds ?? [])]
      .map((clubId) => normalizeGuid(clubId))
      .filter((clubId) => clubId !== "")
  );
}

function golfBoxDateTimeToIso(value: unknown): string | undefined {
  const text = toOptionalString(value);
  const normalized = normalizeGolfBoxDateTime(text);
  if (!normalized) {
    return undefined;
  }

  const date = golfBoxDateTimeToIsoDate(normalized);
  return toNorwayLocalIso(date, golfBoxDateTimeToTimeOfDay(normalized));
}

function parseTeeTimeResponse(value: unknown): TeeTimeResponse {
  const record = pickRecord(value, "TeeTime", "Data", "Result");
  if (!record) {
    throw new Error("GolfBox returned an invalid tee-time booking response.");
  }

  return record as TeeTimeResponse;
}

function readSessionKey(response: TeeTimeResponse): string | undefined {
  return toOptionalString(
    response.SessionKey ??
      response.sessionKey ??
      response.SessionGuid ??
      response.sessionGuid ??
      response.LockGuid ??
      response.lockGuid
  );
}

function ensureBookingCanBeSavedWithoutPayment(response: TeeTimeResponse): void {
  const resourceSettingsValue = response.ResourceSettings ?? response.resourceSettings;
  const resourceSettings = isRecord(resourceSettingsValue)
    ? (resourceSettingsValue as TeeTimeResourceSettingsResponse)
    : undefined;
  const hasInternetPayment = toOptionalBoolean(resourceSettings?.HasInternetPayment ?? resourceSettings?.hasInternetPayment) === true;
  const forceInAdvancePayment =
    toOptionalBoolean(resourceSettings?.ForceInAdvancePayment ?? resourceSettings?.forceInAdvancePayment) === true;
  const paymentConfirmsTeeTime =
    toOptionalBoolean(resourceSettings?.PaymentConfirmsTeeTime ?? resourceSettings?.paymentConfirmsTeeTime) === true;

  if (hasInternetPayment && forceInAdvancePayment && paymentConfirmsTeeTime && teeTimeHasUnpaidItems(response)) {
    throw new Error(
      "GolfBox requires advance payment before this tee time can be booked. The MCP adapter does not automate payment yet, so this booking must be completed manually in GolfBox."
    );
  }
}

function teeTimeHasUnpaidItems(response: TeeTimeResponse): boolean {
  const players = readTeeTimePlayers(response);
  return players.some((player) => {
    if (toOptionalBoolean(player.BookingIsPaid ?? player.bookingIsPaid) === true) {
      return false;
    }

    const items = Array.isArray(player.Items) ? player.Items : Array.isArray(player.items) ? player.items : [];
    return items.some((item) => {
      if (!isRecord(item)) {
        return false;
      }

      const bookingItem = item as TeeTimeBookingItemResponse;
      if (toOptionalBoolean(bookingItem.Paid ?? bookingItem.paid) === true) {
        return false;
      }

      return readMoney(bookingItem.Price ?? bookingItem.price) > 0;
    });
  });
}

function readMoney(value: unknown): number {
  const text = toOptionalString(value);
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readTeeTimePlayers(response: TeeTimeResponse): TeeTimePlayerResponse[] {
  return Array.isArray(response.Players) ? response.Players : Array.isArray(response.players) ? response.players : [];
}

function readTeeTimeBookingReference(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.BookingGroupGuid ?? response.bookingGroupGuid ?? response.BookingGuid ?? response.bookingGuid);
}

function readPlayerBookingReference(player: TeeTimePlayerResponse): string | undefined {
  return toOptionalString(player.BookingGroupGuid ?? player.bookingGroupGuid ?? player.BookingGuid ?? player.bookingGuid);
}

function readTeeTimeClubGuid(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.ClubGuid ?? response.clubGuid);
}

function readTeeTimeClubName(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.ClubName ?? response.clubName);
}

function readTeeTimeResourceGuid(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.ResourceGuid ?? response.resourceGuid);
}

function readTeeTimeResourceName(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.ResourceName ?? response.resourceName);
}

function readTeeTimeValue(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.TeeTime ?? response.teeTime);
}

function readPlayerMemberGuid(player: TeeTimePlayerResponse): string | undefined {
  return toOptionalString(player.MemberGuid ?? player.memberGuid);
}

function readPlayerMemberNumber(player: TeeTimePlayerResponse): string | undefined {
  return toOptionalString(player.MemberNumber ?? player.memberNumber);
}

function readPlayerClubName(player: TeeTimePlayerResponse): string | undefined {
  return toOptionalString(player.ClubName ?? player.clubName);
}

function readPlayerConfirmed(player: TeeTimePlayerResponse): boolean | undefined {
  return toOptionalBoolean(player.Confirmed ?? player.confirmed);
}

function readPlayerConfirmable(player: TeeTimePlayerResponse): boolean | undefined {
  return toOptionalBoolean(player.Confirmable ?? player.confirmable);
}

function mapBookingFromTeeTime(
  response: TeeTimeResponse,
  request: CreateBookingRequest,
  slot: SlotKey,
  prefix?: string
): Booking {
  const players = readTeeTimePlayers(response);
  const golfBoxReference =
    readTeeTimeBookingReference(response) ?? players.map(readPlayerBookingReference).find((reference) => reference !== undefined);
  const needsConfirmation = players.some(
    (player) => readPlayerConfirmable(player) === true && readPlayerConfirmed(player) === false
  );
  const playerText = `${request.players.length} player${request.players.length === 1 ? "" : "s"}`;
  const prefixNote = prefix ? `${prefix} ` : "";
  const confirmationNote = needsConfirmation ? " Player confirmation may still be required in GolfBox." : "";
  const referenceNote = golfBoxReference ? ` GolfBox reference: ${golfBoxReference}.` : "";

  return {
    bookingId: request.slotId,
    status: needsConfirmation ? "pending" : "confirmed",
    slotId: request.slotId,
    summary: `${prefixNote}GolfBox booking saved for ${playerText} at ${formatGolfBoxDateTime(slot.teeTime)}.${confirmationNote}${referenceNote}`
  };
}

function mapAcceptedSaveWithoutVerification(request: CreateBookingRequest, slot: SlotKey): Booking {
  const playerText = `${request.players.length} player${request.players.length === 1 ? "" : "s"}`;

  return {
    bookingId: request.slotId,
    status: "confirmed",
    slotId: request.slotId,
    summary:
      `GolfBox accepted saveTeeTime for ${playerText} at ${formatGolfBoxDateTime(slot.teeTime)}, ` +
      "but teeTimesForPlayer did not return the booking immediately. Avoid retrying until GolfBox has been checked."
  };
}

function mapConfirmedWebPortalSubmission(request: CreateBookingRequest, slot: SlotKey): Booking {
  const playerText = `${request.players.length} player${request.players.length === 1 ? "" : "s"}`;

  return {
    bookingId: request.slotId,
    status: "confirmed",
    slotId: request.slotId,
    summary:
      `GolfBox web portal confirmed booking for ${playerText} at ${formatGolfBoxDateTime(slot.teeTime)}. ` +
      "The booking was accepted and GolfBox returned to the start-time grid."
  };
}

function mapPendingWebPortalSubmission(request: CreateBookingRequest, slot: SlotKey): Booking {
  const playerText = `${request.players.length} player${request.players.length === 1 ? "" : "s"}`;

  return {
    bookingId: request.slotId,
    status: "pending",
    slotId: request.slotId,
    summary:
      `GolfBox web portal save was submitted for ${playerText} at ${formatGolfBoxDateTime(slot.teeTime)}, ` +
      "but teeTimesForPlayer did not return the booking immediately. Verify in GolfBox before retrying."
  };
}

function mapBookingListItem(response: TeeTimeResponse, user: AuthenticatedUser): Booking | undefined {
  const resourceGuid = readTeeTimeResourceGuid(response);
  const teeTime = normalizeGolfBoxDateTime(readTeeTimeValue(response)) ?? readTeeTimeValue(response);
  const memberClubGuid = user.clubGuid ?? readTeeTimeClubGuid(response);
  if (!resourceGuid || !teeTime || !memberClubGuid) {
    return undefined;
  }

  const slotId = `${stripGuidBraces(resourceGuid)}|${teeTime}|${stripGuidBraces(memberClubGuid)}`;
  const players = readTeeTimePlayers(response);
  const needsConfirmation = players.some(
    (player) => readPlayerConfirmable(player) === true && readPlayerConfirmed(player) === false
  );
  const golfBoxReference =
    readTeeTimeBookingReference(response) ?? players.map(readPlayerBookingReference).find((reference) => reference !== undefined);
  const courseName = readTeeTimeResourceName(response) ?? "GolfBox";
  const playerText =
    players.length > 0 ? `${players.length} player${players.length === 1 ? "" : "s"}` : "unknown player count";
  const referenceNote = golfBoxReference ? ` GolfBox reference: ${golfBoxReference}.` : "";

  return {
    bookingId: slotId,
    status: needsConfirmation ? "pending" : "confirmed",
    slotId,
    summary: `${courseName}: ${formatGolfBoxDateTime(teeTime)} for ${playerText}.${referenceNote}`
  };
}

function mapUpcomingTeeTimeFromPlayerResponse(
  response: TeeTimeResponse,
  user: AuthenticatedUser,
  fromDate: string,
  untilDate: string,
  clubFilters: Set<string>
): UpcomingTeeTime | undefined {
  const resourceGuid = readTeeTimeResourceGuid(response);
  const teeTime = normalizeGolfBoxDateTime(readTeeTimeValue(response)) ?? readTeeTimeValue(response);
  const clubGuid = readTeeTimeClubGuid(response);
  const memberClubGuid = user.clubGuid ?? clubGuid;
  const date = teeTime ? golfBoxDateTimeToIsoDate(teeTime) : undefined;
  const normalizedClubGuid = normalizeGuid(clubGuid);
  if (
    !resourceGuid ||
    !teeTime ||
    !memberClubGuid ||
    !date ||
    date < fromDate ||
    date >= untilDate ||
    (clubFilters.size > 0 && (!normalizedClubGuid || !clubFilters.has(normalizedClubGuid)))
  ) {
    return undefined;
  }

  const players = mapUpcomingPlayers(readTeeTimePlayers(response), user);
  const status = readUpcomingStatus(players);
  const courseName = readTeeTimeResourceName(response) ?? "GolfBox";
  const clubName = readTeeTimeClubName(response) ?? user.clubName ?? "GolfBox";
  const slotId = `${stripGuidBraces(resourceGuid)}|${teeTime}|${stripGuidBraces(memberClubGuid)}`;
  const playerText = `${players.length || 0} player${players.length === 1 ? "" : "s"}`;

  return {
    slotId,
    startsAt: golfBoxDateTimeToIso(teeTime) ?? formatGolfBoxDateTime(teeTime),
    clubName,
    courseName,
    status,
    playerCount: players.length,
    players,
    source: "teeTimesForPlayer",
    summary: `${courseName}: ${formatGolfBoxDateTime(teeTime)} for ${playerText}.`
  };
}

function mapUpcomingTeeTimeFromGimmie(
  response: GimmieTeeTimeResponse,
  user: AuthenticatedUser,
  fromDate: string,
  untilDate: string
): UpcomingTeeTime | undefined {
  const bookingId = toOptionalString(response.bookingId);
  const teeTime = toOptionalString(response.teeTime);
  const date = teeTime ? isoDatePart(teeTime) : undefined;
  if (!bookingId || !teeTime || !date || date < fromDate || date >= untilDate) {
    return undefined;
  }

  const players = (Array.isArray(response.players) ? response.players : []).map((player) => {
    const mapped: UpcomingTeeTimePlayer = {};
    const name = toOptionalString(player.name);
    if (name) {
      mapped.name = name;
    }

    const memberNumber = toOptionalString(player.memberId);
    if (memberNumber) {
      mapped.memberNumber = memberNumber;
    }

    if (memberNumber && normalizeSearchText(memberNumber) === normalizeSearchText(user.guid)) {
      mapped.isCurrentUser = true;
    } else if (matchesCurrentUserName(name, user)) {
      mapped.isCurrentUser = true;
    }

    return mapped;
  });
  const courseName = toOptionalString(response.guideName) ?? "Gimmie";
  const clubName = toOptionalString(response.clubName) ?? "Gimmie";
  const startsAt = normalizeIsoDateTime(teeTime) ?? teeTime;
  const playerText = `${players.length || 0} player${players.length === 1 ? "" : "s"}`;

  return {
    slotId: `gimmie|${toOptionalString(response.org) ?? "NGF"}|${bookingId}`,
    startsAt,
    clubName,
    courseName,
    status: toOptionalString(response.confirmedSkeletonId) ? "confirmed" : "pending",
    playerCount: players.length,
    players,
    source: "gimmie",
    summary: `${courseName}: ${startsAt} for ${playerText}.`
  };
}

function mapUpcomingPlayers(players: TeeTimePlayerResponse[], user: AuthenticatedUser): UpcomingTeeTimePlayer[] {
  return players.map((player) => {
    const firstName = toOptionalString(player.FirstName ?? player.firstName);
    const lastName = toOptionalString(player.LastName ?? player.lastName);
    const derivedName = [firstName, lastName].filter(Boolean).join(" ");
    const mapped: UpcomingTeeTimePlayer = {};
    const name =
      toOptionalString(player.FullName ?? player.fullName) ?? toOptionalString(player.Name ?? player.name) ?? (derivedName || undefined);
    if (name) {
      mapped.name = name;
    }

    const memberNumber = readPlayerMemberNumber(player);
    if (memberNumber) {
      mapped.memberNumber = memberNumber;
    }

    const clubName = readPlayerClubName(player);
    if (clubName) {
      mapped.clubName = clubName;
    }

    const confirmed = readPlayerConfirmed(player);
    if (confirmed !== undefined) {
      mapped.confirmed = confirmed;
    }

    const confirmable = readPlayerConfirmable(player);
    if (confirmable !== undefined) {
      mapped.confirmable = confirmable;
    }

    if (isCurrentUserPlayerResponse(player, user)) {
      mapped.isCurrentUser = true;
    }

    return mapped;
  });
}

function readUpcomingStatus(players: UpcomingTeeTimePlayer[]): "confirmed" | "pending" {
  return players.some((player) => player.confirmed === false && player.confirmable !== false) ? "pending" : "confirmed";
}

function isCurrentUserPlayerResponse(player: TeeTimePlayerResponse, user: AuthenticatedUser): boolean {
  const userGuid = normalizeGuid(user.guid);
  if (userGuid) {
    const playerGuid = normalizeGuid(readPlayerMemberGuid(player));
    if (playerGuid && playerGuid === userGuid) {
      return true;
    }
  }

  const userMemberNumber = normalizeSearchText(user.memberNumber);
  if (userMemberNumber) {
    const playerMemberNumber = normalizeSearchText(readPlayerMemberNumber(player));
    if (playerMemberNumber && playerMemberNumber === userMemberNumber) {
      return true;
    }
  }

  return matchesCurrentUserName(readPlayerResponseName(player), user);
}

function readPlayerResponseName(player: TeeTimePlayerResponse): string | undefined {
  const firstName = toOptionalString(player.FirstName ?? player.firstName);
  const lastName = toOptionalString(player.LastName ?? player.lastName);
  const derivedName = [firstName, lastName].filter(Boolean).join(" ");
  return toOptionalString(player.FullName ?? player.fullName) ?? toOptionalString(player.Name ?? player.name) ?? (derivedName || undefined);
}

function matchesCurrentUserName(name: string | undefined, user: AuthenticatedUser): boolean {
  const userName = normalizeSearchText(user.fullName);
  const candidateName = normalizeSearchText(name);
  return Boolean(userName && candidateName && candidateName === userName);
}

function parseTeeTimeResponses(value: unknown): TeeTimeResponse[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as TeeTimeResponse[];
  }

  const values = pickArray(value, "TeeTimes", "teeTimes", "Times", "times", "Bookings", "bookings", "Items", "items", "Data", "data", "Result", "result");
  if (values.length > 0) {
    return values.filter(isRecord) as TeeTimeResponse[];
  }

  const single = pickRecord(value, "TeeTime", "teeTime", "Data", "data", "Result", "result");
  return single ? [single as TeeTimeResponse] : [];
}

function parseTournamentResponses(value: unknown): TournamentPlayerResponse[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as TournamentPlayerResponse[];
  }

  const values = pickArray(value, "Tournaments", "Competitions", "Items", "Data", "Result");
  if (values.length > 0) {
    return values.filter(isRecord) as TournamentPlayerResponse[];
  }

  const single = pickRecord(value, "Tournament", "Competition", "Data", "Result");
  return single ? [single as TournamentPlayerResponse] : [];
}

function mapTournamentListItem(response: TournamentPlayerResponse): Tournament | undefined {
  const tournamentId = toOptionalString(response.CompetitionId);
  const name = toOptionalString(response.Name);
  if (!tournamentId || !name) {
    return undefined;
  }

  const mapped: Tournament = {
    tournamentId,
    name
  };
  const organizer = toOptionalString(response.CustomerName);
  if (organizer) {
    mapped.organizer = organizer;
  }

  const startsAt = golfBoxDateTimeToIso(response.StartDate);
  if (startsAt) {
    mapped.startsAt = startsAt;
  }

  const endsAt = golfBoxDateTimeToIso(response.EndDate);
  if (endsAt) {
    mapped.endsAt = endsAt;
  }

  return mapped;
}

function findTeeTimeForSlot(teeTimes: TeeTimeResponse[], slot: SlotKey): TeeTimeResponse | undefined {
  const resourceGuid = normalizeGuid(slot.resourceGuid);

  return teeTimes.find((teeTime) => {
    const candidateResourceGuid = normalizeGuid(readTeeTimeResourceGuid(teeTime));
    const candidateTeeTime = readTeeTimeValue(teeTime);

    return candidateResourceGuid === resourceGuid && candidateTeeTime === slot.teeTime;
  });
}

function parsePlayerSearchResults(value: unknown): ResolvedPlayer[] {
  const values = pickArray(value, "Players", "Results", "Members", "Items");

  return values
    .map((candidate) => {
      if (!isRecord(candidate)) {
        return undefined;
      }

      const player = candidate as PlayerSearchResponse;
      const playerGuid = toOptionalString(player.PlayerGuid ?? player.MemberGuid ?? player.Guid);
      const clubGuid = toOptionalString(player.ClubGuid);
      if (!playerGuid || !clubGuid) {
        return undefined;
      }

      const firstName = toOptionalString(player.FirstName);
      const lastName = toOptionalString(player.LastName);
      const derivedName = [firstName, lastName].filter(Boolean).join(" ");
      const resolvedPlayer: ResolvedPlayer = {
        playerGuid,
        clubGuid
      };
      const memberNumber = toOptionalString(player.MemberNumber);
      if (memberNumber) {
        resolvedPlayer.memberNumber = memberNumber;
      }
      const name = toOptionalString(player.FullName) ?? toOptionalString(player.Name) ?? (derivedName || undefined);
      if (name) {
        resolvedPlayer.name = name;
      }

      return resolvedPlayer;
    })
    .filter((player): player is ResolvedPlayer => player !== undefined);
}

function selectPlayerSearchMatch(
  matches: ResolvedPlayer[],
  player: CreateBookingRequest["players"][number]
): ResolvedPlayer | undefined {
  if (matches.length === 0) {
    return undefined;
  }

  const requestedGolfId = normalizeSearchText(player.golfId);
  const exactMemberNumber = matches.find(
    (match) => requestedGolfId && normalizeSearchText(match.memberNumber) === requestedGolfId
  );
  if (exactMemberNumber) {
    return exactMemberNumber;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const requestedName = normalizeSearchText(player.name);
  return matches.find((match) => requestedName && normalizeSearchText(match.name).includes(requestedName));
}

function pickRecord(value: unknown, ...wrapperNames: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const name of wrapperNames) {
    const nested = value[name];
    if (isRecord(nested)) {
      return nested;
    }
  }

  return value;
}

function pickArray(value: unknown, ...wrapperNames: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const name of wrapperNames) {
    const nested = value[name];
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeGuid(value: string): boolean {
  return /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(value.trim());
}

function normalizeGuid(value: string | undefined): string {
  return value ? stripGuidBraces(value).toLowerCase() : "";
}

function normalizeSearchText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseWebBookingResources(html: string, pageUrl: string): TeeResource[] {
  const resourceSelect =
    html.match(/<select\b[^>]*(?:name|id)=["']ddlRessource_GUID["'][\s\S]*?<\/select>/i)?.[0] ?? "";
  const resources = [...resourceSelect.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => {
      const value = readHtmlAttr(match[1], "value");
      const guid = value ? stripGuidBraces(decodeXmlEntities(value)) : undefined;
      if (!guid || guid.toLowerCase() === "x") {
        return undefined;
      }

      return {
        guid,
        name: decodeXmlEntities(match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()) || guid
      };
    })
    .filter((resource): resource is TeeResource => resource !== undefined);

  if (resources.length > 0) {
    return resources;
  }

  const resourceGuid = new URL(pageUrl).searchParams.get("Ressource_GUID");
  if (!resourceGuid) {
    return [];
  }

  const guid = stripGuidBraces(resourceGuid);
  return [
    {
      guid,
      name: guid
    }
  ];
}

function findWebMyTimesPath(html: string): string | undefined {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? "";
    const text = htmlToPlainText(match[2] ?? "");
    const title = decodeXmlEntities(readHtmlAttr(attrs, "title") ?? "");
    if (!/^mine tider$/i.test(text) && !/^mine tider$/i.test(title)) {
      continue;
    }

    const href = decodeXmlEntities(readHtmlAttr(attrs, "href") ?? "");
    if (href) {
      return href;
    }
  }

  return undefined;
}

function parseWebUpcomingTeeTimes(
  html: string,
  user: AuthenticatedUser,
  fromDate: string,
  untilDate: string
): UpcomingTeeTime[] {
  const myTimesHtml = isolateWebMyTimesHtml(html);
  if (!myTimesHtml) {
    return [];
  }

  return [...myTimesHtml.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bborder\b[^"']*\bbg-selected\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass=["'][^"']*\bborder\b[^"']*\bbg-selected\b|<h3\b|<\/form>|$)/gi)]
    .map((match) => mapWebUpcomingTeeTimeCard(match[0], user, fromDate, untilDate))
    .filter((teeTime): teeTime is UpcomingTeeTime => teeTime !== undefined);
}

function isolateWebMyTimesHtml(html: string): string | undefined {
  const myTimesHeader = /<h3\b[^>]*>[\s\S]{0,500}?\bMine tider\b[\s\S]{0,500}?<\/h3>/i.exec(html);
  if (!myTimesHeader?.index) {
    return undefined;
  }

  const rest = html.slice(myTimesHeader.index);
  const tournamentIndex = rest.search(/<h3\b[^>]*>[\s\S]{0,500}?\bMine turneringer\b[\s\S]{0,500}?<\/h3>/i);
  return tournamentIndex >= 0 ? rest.slice(0, tournamentIndex) : rest;
}

function mapWebUpcomingTeeTimeCard(
  cardHtml: string,
  user: AuthenticatedUser,
  fromDate: string,
  untilDate: string
): UpcomingTeeTime | undefined {
  const card = readWebUpcomingTeeTimeCard(cardHtml);
  if (!card || card.date < fromDate || card.date >= untilDate) {
    return undefined;
  }

  const memberClubGuid = user.clubGuid;
  if (!memberClubGuid) {
    return undefined;
  }

  const startsAt = toNorwayLocalIso(card.date, card.timeOfDay);
  const slotId = `${stripGuidBraces(card.resourceGuid)}|${card.bookingStart}|${stripGuidBraces(memberClubGuid)}`;
  const players = card.players.map((player) => ({
    ...player,
    ...(isCurrentUserWebPlayer(player, user) ? { isCurrentUser: true } : {})
  }));
  const playerText = `${players.length || 0} player${players.length === 1 ? "" : "s"}`;

  return {
    slotId,
    startsAt,
    clubName: card.clubName,
    courseName: card.courseName,
    status: players.some((player) => player.confirmed === true) ? "confirmed" : "pending",
    playerCount: players.length,
    players,
    source: "webPortal",
    summary: `${card.courseName}: ${startsAt} for ${playerText}.`
  };
}

function readWebUpcomingTeeTimeCard(cardHtml: string): WebUpcomingTeeTimeCard | undefined {
  const goToTimeLink = [...cardHtml.matchAll(/<a\b([^>]*)>/gi)]
    .map((match) => decodeXmlEntities(readHtmlAttr(match[1] ?? "", "href") ?? ""))
    .find((href) => /Ressource_GUID=/i.test(href) && /Booking_Start=/i.test(href));
  if (!goToTimeLink) {
    return undefined;
  }

  const linkUrl = new URL(goToTimeLink, "https://www.golfbox.no/");
  const resourceGuid = linkUrl.searchParams.get("Ressource_GUID");
  const bookingStart = normalizeGolfBoxDateTime(linkUrl.searchParams.get("Booking_Start") ?? undefined);
  const details = readWebUpcomingCardDetails(cardHtml);
  if (!resourceGuid || !bookingStart || !details) {
    return undefined;
  }

  return {
    date: golfBoxDateTimeToIsoDate(bookingStart),
    timeOfDay: golfBoxDateTimeToTimeOfDay(bookingStart),
    clubName: details.clubName,
    courseName: details.courseName,
    resourceGuid,
    bookingStart,
    players: readWebUpcomingPlayers(cardHtml)
  };
}

function readWebUpcomingCardDetails(cardHtml: string): { clubName: string; courseName: string } | undefined {
  const calendarMatch = cardHtml.match(/CalendarAppointmentSelect\([\s\S]*?'Starttid:[\s\S]*?',\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/i);
  if (calendarMatch) {
    return {
      clubName: decodeXmlEntities(calendarMatch[1]),
      courseName: decodeXmlEntities(calendarMatch[2])
    };
  }

  const detailValues = [...cardHtml.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bd-flex align-items-center[^"']*["'][^>]*>\s*<div>[\s\S]*?<\/div>\s*([^<][\s\S]*?)<\/div>/gi)]
    .map((match) => htmlToPlainText(match[1] ?? ""))
    .filter(Boolean);
  const clubName = detailValues.find((value) => /golfklubb/i.test(value));
  const clubIndex = clubName ? detailValues.indexOf(clubName) : -1;
  const courseName = clubIndex >= 0 ? detailValues.slice(clubIndex + 1).find((value) => !/^\d{1,2}:\d{2}$/.test(value)) : undefined;
  return clubName && courseName ? { clubName, courseName } : undefined;
}

function readWebUpcomingPlayers(cardHtml: string): UpcomingTeeTimePlayer[] {
  const tablePlayers = readWebUpcomingTablePlayers(cardHtml);
  if (tablePlayers.length > 0) {
    return tablePlayers;
  }

  return [...cardHtml.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bpx-2 py-1\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass=["'][^"']*\bpx-2 py-1\b|<\/div>\s*<\/div>\s*<\/div>|<div\b[^>]*\bclass=["'][^"']*\bborder\b[^"']*\bbg-selected\b|$)/gi)]
    .map((match) => readWebUpcomingPlayer(match[1] ?? ""))
    .filter((player): player is UpcomingTeeTimePlayer => player !== undefined);
}

function readWebUpcomingTablePlayers(cardHtml: string): UpcomingTeeTimePlayer[] {
  return [...cardHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => {
      const cells = [...(match[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlToPlainText(cell[1] ?? ""));
      if (cells.length < 4 || !/^\d+$/.test(cells[0])) {
        return undefined;
      }

      const player: UpcomingTeeTimePlayer = {
        name: cells[1],
        memberNumber: cells[2],
        clubName: cells[3]
      };
      if (/bestilt|bekreftet|confirmed/i.test(cells[5] ?? "")) {
        player.confirmed = true;
      }

      return player.name && player.memberNumber ? player : undefined;
    })
    .filter((player): player is UpcomingTeeTimePlayer => player !== undefined);
}

function readWebUpcomingPlayer(playerHtml: string): UpcomingTeeTimePlayer | undefined {
  const text = htmlToPlainText(playerHtml);
  const match = text.match(/^\s*\d+\s+(.+?)\s+(\d+-\d+)\s+(.+?Golfklubb)\s+(?:[+\-]?\d+(?:[,.]\d+)?)?\s*(bestilt|bekreftet|confirmed)?\s*$/i);
  if (!match) {
    return undefined;
  }

  const player: UpcomingTeeTimePlayer = {
    name: match[1].trim(),
    memberNumber: match[2].trim(),
    clubName: match[3].trim()
  };
  if (match[4]) {
    player.confirmed = true;
  }

  return player;
}

function isCurrentUserWebPlayer(player: UpcomingTeeTimePlayer, user: AuthenticatedUser): boolean {
  const userMemberNumber = normalizeSearchText(user.memberNumber);
  const playerMemberNumber = normalizeSearchText(player.memberNumber);
  if (userMemberNumber && playerMemberNumber && userMemberNumber === playerMemberNumber) {
    return true;
  }

  return matchesCurrentUserName(player.name, user);
}

function parseWebFormFields(html: string): URLSearchParams {
  const form = new URLSearchParams();

  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const name = readHtmlAttr(attrs, "name");
    if (!name || isDisabledHtmlControl(attrs)) {
      continue;
    }

    const type = (readHtmlAttr(attrs, "type") ?? "text").toLowerCase();
    if (["button", "submit", "reset", "image", "file"].includes(type)) {
      continue;
    }

    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(attrs)) {
      continue;
    }

    form.append(name, decodeXmlEntities(readHtmlAttr(attrs, "value") ?? ""));
  }

  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = match[1] ?? "";
    const name = readHtmlAttr(attrs, "name");
    if (!name || isDisabledHtmlControl(attrs)) {
      continue;
    }

    const option =
      match[2].match(/<option\b(?=[^>]*\bselected\b)([^>]*)>/i) ?? match[2].match(/<option\b([^>]*)>/i);
    if (option) {
      form.append(name, decodeXmlEntities(readHtmlAttr(option[1] ?? "", "value") ?? ""));
    }
  }

  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attrs = match[1] ?? "";
    const name = readHtmlAttr(attrs, "name");
    if (!name || isDisabledHtmlControl(attrs)) {
      continue;
    }

    form.append(name, decodeXmlEntities(match[2] ?? ""));
  }

  return form;
}

function readHtmlAttr(source: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(source);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function isDisabledHtmlControl(attrs: string): boolean {
  return /\bdisabled\b/i.test(attrs);
}

function isWebLockedPage(url: string, html: string): boolean {
  return /\/timeIsLocked\.asp\b/i.test(new URL(url).pathname) || /id=["']timeIsLocked/i.test(html);
}

function isWebBookingWindow(html: string): boolean {
  return /<form\b[^>]*(?:name|id)=["'](?:frmPageForm|Form1)["']/i.test(html) && /cmdSubmit_Click|Bestill starttid/i.test(html);
}

function isWebBookingAcceptedPage(url: string, html: string): boolean {
  return /\/grid\.asp\b/i.test(new URL(url).pathname) || /id=["']bookingGridv3["']|Starttidsbestilling/i.test(html);
}

function isWebLoginFailurePage(html: string): boolean {
  return /<form\b[^>]*(?:id|name)=["'](?:loginform|frmLogin)["']/i.test(html) || /loginform\.submitted/i.test(html);
}

function isWebGridBounce(html: string): boolean {
  // An unauthenticated/expired web session is bounced to the public norskgolf.no site,
  // returning a tiny redirect page instead of the booking grid (which always has the club selector).
  if (html.length < 2_000) {
    return true;
  }
  if (/norskgolf\.no/i.test(html)) {
    return true;
  }
  return !/ddlClub/i.test(html);
}

function readWebPortalError(html: string): string | undefined {
  const errorContainer =
    html.match(/<div\b[^>]*id=["']clientErrorContainer["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
    html.match(/<[^>]*class=["'][^"']*(?:error|alert-danger)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  const text = errorContainer ? htmlToPlainText(errorContainer) : undefined;
  return text || undefined;
}

function htmlToPlainText(html: string): string {
  return decodeXmlEntities(html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function mapUser(response: MobileHubUserResponse): AuthenticatedGolfBoxUser {
  const firstName = toOptionalString(response.FirstName ?? response.firstName);
  const lastName = toOptionalString(response.LastName ?? response.lastName);
  const derivedName = [firstName, lastName].filter(Boolean).join(" ");
  const user: AuthenticatedGolfBoxUser = {
    guid: toOptionalString(response.Guid ?? response.guid),
    fullName:
      toOptionalString(response.FullName ?? response.fullName) ??
      toOptionalString(response.Name ?? response.name) ??
      (derivedName || undefined),
    clubGuid: toOptionalString(response.ClubGuid ?? response.clubGuid),
    clubName: toOptionalString(response.ClubName ?? response.clubName),
    memberNumber: toOptionalString(response.MemberNumber ?? response.memberNumber),
    countryIsoCode: toOptionalString(response.CountryIsoCode ?? response.countryIsoCode),
    hasAccessToBooking: toOptionalBoolean(response.HasAccessToBooking ?? response.hasAccessToBooking),
    useNewApp: toOptionalBoolean(response.UseNewApp ?? response.useNewApp)
  };

  const newAppSsoToken = toOptionalString(response.NewAppSSOToken ?? response.newAppSSOToken);
  if (newAppSsoToken) {
    user.newAppSsoToken = newAppSsoToken;
  }

  return user;
}

function buildEmptyUseNewAppTeeTimesError(routeHint: string | undefined, detail?: string): string {
  return (
    "GolfBox MobileHub teeTimesForPlayer returned no upcoming tee times for this UseNewApp account. " +
    "Live GolfBox profile data says this account uses the newer app flow, so an empty teeTimesForPlayer response is not proof that the user has no tee times. " +
    (routeHint ? `${routeHint} ` : "") +
    (detail ? `${detail} ` : "") +
    "Gimmie/new-app API support is required to list these tee times. " +
    "The MCP uses the authenticated Mine tider web portal as a final read-only fallback, but does not scan day grids for private future tee times."
  );
}

function parseTeeTimeXml(
  xml: string,
  search: TeeTimeSearch,
  resource: TeeResource,
  memberClubGuid: string
): TeeTimeSlot[] {
  const setup = findFirstXmlTag(xml, "Setup")?.attrs ?? {};
  const maxPlayers = readNumberAttr(setup, "MaxNumberOfPlayers", "MaxPlayers") ?? 4;
  const courseName = readAttr(setup, "Ressource_Name", "ResourceName", "RessourceName") ?? resource.name;
  const bookingResourceGuid =
    readAttr(setup, "Ressource_GUID", "Resource_GUID", "ResourceGuid", "ResourceGUID") ?? resource.guid;
  const slots: TeeTimeSlot[] = [];

  for (const slotTag of findXmlTags(xml, "slot")) {
    const timeOfDay = readSlotTime(slotTag.attrs);
    if (!timeOfDay || !isWithinSearchWindow(timeOfDay, search)) {
      continue;
    }

    if (isClosedSlot(slotTag.attrs)) {
      continue;
    }

    const playerNodes = findXmlTags(slotTag.body, "slotnode");
    const occupiedSpots = countOccupiedSpots(playerNodes);
    const availableSpots =
      readNumberAttr(slotTag.attrs, "AvailableSpots", "FreeSpots", "FreeSlots", "Available", "OpenSpots") ??
      Math.max(maxPlayers - occupiedSpots, 0);

    if (availableSpots < search.players) {
      continue;
    }

    const holes = search.holes ?? inferHoleCount(slotTag.attrs, playerNodes);
    const golfBoxDateTime = toGolfBoxDateTime(search.date, timeOfDay);
    const slot: TeeTimeSlot = {
      slotId: `${stripGuidBraces(bookingResourceGuid)}|${golfBoxDateTime}|${memberClubGuid}`,
      clubId: search.clubId,
      courseName,
      startsAt: toNorwayLocalIso(search.date, timeOfDay),
      holes,
      availableSpots
    };

    const price = readPrice(slotTag.attrs, playerNodes);
    if (price !== undefined) {
      slot.priceNok = price;
    }

    const notes = buildSlotNotes(slotTag.attrs);
    if (notes.length > 0) {
      slot.notes = notes;
    }

    slots.push(slot);
  }

  return slots;
}

function parseTeeTimePlayerMatchesXml(
  xml: string,
  search: TeeTimePlayerSearch,
  resource: TeeResource,
  memberClubGuid: string
): TeeTimePlayerMatch[] {
  const setup = findFirstXmlTag(xml, "Setup")?.attrs ?? {};
  const courseName = readAttr(setup, "Ressource_Name", "ResourceName", "RessourceName") ?? resource.name;
  const bookingResourceGuid =
    readAttr(setup, "Ressource_GUID", "Resource_GUID", "ResourceGuid", "ResourceGUID") ?? resource.guid;
  const normalizedQuery = normalizeSearchText(search.query);
  const matches: TeeTimePlayerMatch[] = [];

  if (!normalizedQuery) {
    return matches;
  }

  for (const slotTag of findXmlTags(xml, "slot")) {
    const timeOfDay = readSlotTime(slotTag.attrs);
    if (!timeOfDay || !isWithinPlayerSearchWindow(timeOfDay, search)) {
      continue;
    }

    for (const playerNode of findXmlTags(slotTag.body, "slotnode")) {
      const playerText = readPlayerSearchText(playerNode.attrs);
      if (!playerText || !normalizeSearchText(playerText).includes(normalizedQuery)) {
        continue;
      }

      const playerName = readAttr(playerNode.attrs, "MemberName", "PlayerName", "Name", "Description") ?? playerText;
      const golfBoxDateTime = toGolfBoxDateTime(search.date, timeOfDay);
      matches.push({
        slotId: `${stripGuidBraces(bookingResourceGuid)}|${golfBoxDateTime}|${memberClubGuid}`,
        clubId: search.clubId,
        courseName,
        startsAt: toNorwayLocalIso(search.date, timeOfDay),
        playerName,
        matchedText: playerText,
        source: "teeTimesForDay"
      });
    }
  }

  return matches;
}

function parseWebTeeTimePlayerMatches(
  html: string,
  search: TeeTimePlayerSearch,
  resource: TeeResource,
  memberClubGuid: string
): TeeTimePlayerMatch[] {
  const matches: TeeTimePlayerMatch[] = [];
  const query = search.query.trim();
  if (!query) {
    return matches;
  }

  const queryPattern = new RegExp(escapeRegex(query), "gi");
  const bookingLinks = readWebBookingStartLinks(html);
  let queryMatch: RegExpExecArray | null;

  while ((queryMatch = queryPattern.exec(html)) !== null) {
    const link = findNearestWebBookingLink(bookingLinks, queryMatch.index);
    if (!link) {
      continue;
    }

    const date = golfBoxDateTimeToIsoDate(link.bookingStart);
    const timeOfDay = golfBoxDateTimeToTimeOfDay(link.bookingStart);
    if (date !== search.date || !isWithinPlayerSearchWindow(timeOfDay, search)) {
      continue;
    }

    const matchedText = readWebPlayerMatchContext(html, queryMatch.index, query);
    matches.push({
      slotId: `${stripGuidBraces(link.resourceGuid ?? resource.guid)}|${link.bookingStart}|${stripGuidBraces(memberClubGuid)}`,
      clubId: search.clubId,
      courseName: resource.name,
      startsAt: toNorwayLocalIso(search.date, timeOfDay),
      playerName: matchedText,
      matchedText,
      source: "webPortal"
    });
  }

  return matches;
}

function countWebGridPlayers(rowBody: string): number {
  return (rowBody.match(/class="fw-bold col-auto[^"]*text-truncate/gi) ?? []).length;
}

function parseWebGridAvailability(
  html: string,
  search: TeeTimeSearch,
  resource: TeeResource,
  memberClubGuid: string
): TeeTimeSlot[] {
  const maxPlayers = 4;
  const slots: TeeTimeSlot[] = [];
  const seen = new Set<string>();

  // The web booking grid renders one list row per tee time:
  //   <div class="d-flex list-row hour c_partfree">
  //     <div class="timecell">11:00</div>
  //     <div onclick="showWindow('20260623T110000','0','0')" class="time-players ... pointer"> ...players... </div>
  //   </div>
  // State classes: `full` (no open seats), `c_partfree`/`c_free` (open seats), `expired` (past / not bookable).
  // Only rows whose player cell is clickable carry a showWindow(...) booking token.
  const rowPattern =
    /<div class="d-flex list-row hour([^"]*)">\s*<div class="timecell">\s*([0-9]{1,2}:[0-9]{2})\s*<\/div>([\s\S]*?)(?=<div class="d-flex list-row hour|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(html)) !== null) {
    const stateClasses = (match[1] ?? "").trim().toLowerCase();
    const timeOfDay = match[2] ?? "";
    const rowBody = match[3] ?? "";

    if (/\bexpired\b/.test(stateClasses)) {
      continue;
    }
    if (!isWithinSearchWindow(timeOfDay, search)) {
      continue;
    }

    const tokenMatch = rowBody.match(/showWindow\(\s*['"](\d{8}T\d{6})['"]/i);
    if (!tokenMatch) {
      // No booking token => slot is not bookable (e.g. portal window not yet open).
      continue;
    }
    const bookingStart = normalizeGolfBoxDateTime(tokenMatch[1]);
    if (!bookingStart || golfBoxDateTimeToIsoDate(bookingStart) !== search.date) {
      continue;
    }

    const isFull = /\bfull\b/.test(stateClasses);
    const occupied = countWebGridPlayers(rowBody);
    const availableSpots = isFull ? 0 : Math.max(maxPlayers - occupied, 0);
    if (availableSpots < search.players) {
      continue;
    }

    const slotId = `${stripGuidBraces(resource.guid)}|${bookingStart}|${stripGuidBraces(memberClubGuid)}`;
    if (seen.has(slotId)) {
      continue;
    }
    seen.add(slotId);

    slots.push({
      slotId,
      clubId: search.clubId,
      courseName: resource.name,
      startsAt: toNorwayLocalIso(search.date, timeOfDay),
      holes: search.holes ?? 18,
      availableSpots
    });
  }

  return slots;
}

function readWebBookingStartLinks(html: string): { index: number; resourceGuid?: string; bookingStart: string }[] {
  const links: { index: number; resourceGuid?: string; bookingStart: string }[] = [];
  const hrefPattern = /<a\b[^>]*\bhref=["']([^"']*Booking_Start=[^"']+)["'][^>]*>/gi;
  let hrefMatch: RegExpExecArray | null;

  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    const href = decodeXmlEntities(hrefMatch[1] ?? "");
    const url = new URL(href, "https://www.golfbox.no/");
    const bookingStart = normalizeGolfBoxDateTime(url.searchParams.get("Booking_Start") ?? undefined);
    const resourceGuid = normalizeGuid(url.searchParams.get("Ressource_GUID") ?? undefined);
    if (!bookingStart) {
      continue;
    }

    links.push({
      index: hrefMatch.index,
      ...(resourceGuid ? { resourceGuid } : {}),
      bookingStart
    });
  }

  const showWindowPattern = /showWindow\(\s*['"](\d{8}T\d{6})['"]/gi;
  let showWindowMatch: RegExpExecArray | null;
  while ((showWindowMatch = showWindowPattern.exec(html)) !== null) {
    const bookingStart = normalizeGolfBoxDateTime(showWindowMatch[1]);
    if (!bookingStart) {
      continue;
    }

    links.push({
      index: showWindowMatch.index,
      bookingStart
    });
  }

  return links;
}

function findNearestWebBookingLink(
  links: { index: number; resourceGuid?: string; bookingStart: string }[],
  matchIndex: number
): { index: number; resourceGuid?: string; bookingStart: string } | undefined {
  let nearest: { index: number; resourceGuid?: string; bookingStart: string } | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const link of links) {
    const distance = Math.abs(matchIndex - link.index);
    if (distance < nearestDistance && distance < 5_000) {
      nearest = link;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function readWebPlayerMatchContext(html: string, matchIndex: number, query: string): string {
  const tagStart = html.lastIndexOf("<", matchIndex);
  const tagEnd = html.indexOf("</", matchIndex);
  if (tagStart >= 0 && tagEnd > matchIndex) {
    const tagText = htmlToPlainText(html.slice(tagStart, tagEnd));
    if (normalizeSearchText(tagText).includes(normalizeSearchText(query))) {
      return tagText;
    }
  }

  const context = htmlToPlainText(html.slice(Math.max(0, matchIndex - 300), matchIndex + 300));
  const normalizedQuery = normalizeSearchText(query);
  const parts = context
    .split(/\s{2,}|[|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const exactPart = parts.find((part) => normalizeSearchText(part).includes(normalizedQuery));
  return exactPart ?? query;
}

function dedupeTeeTimePlayerMatches(matches: TeeTimePlayerMatch[]): TeeTimePlayerMatch[] {
  const deduped = new Map<string, TeeTimePlayerMatch>();
  for (const match of matches) {
    const key = `${match.slotId}|${normalizeSearchText(match.matchedText)}|${match.source}`;
    if (!deduped.has(key)) {
      deduped.set(key, match);
    }
  }

  return [...deduped.values()];
}

function findFirstXmlTag(xml: string, tagName: string): XmlTag | undefined {
  return findXmlTags(xml, tagName)[0];
}

function findXmlTags(xml: string, tagName: string): XmlTag[] {
  const tags: XmlTag[] = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tagName}>)`, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    tags.push({
      attrs: parseXmlAttributes(match[1] ?? ""),
      body: match[2] ?? ""
    });
  }

  return tags;
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }

  return attrs;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_entity, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_entity, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readAttr(attrs: Record<string, string>, ...names: string[]): string | undefined {
  const lookup = new Map(Object.entries(attrs).map(([key, value]) => [key.toLowerCase(), value]));

  for (const name of names) {
    const value = lookup.get(name.toLowerCase())?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readNumberAttr(attrs: Record<string, string>, ...names: string[]): number | undefined {
  const rawValue = readAttr(attrs, ...names);
  if (!rawValue) {
    return undefined;
  }

  const match = rawValue.replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function readSlotTime(attrs: Record<string, string>): string | undefined {
  const rawValue = readAttr(attrs, "time", "TeeTime", "StartTime", "DateTime");
  if (!rawValue) {
    return undefined;
  }

  const compactDateTime = rawValue.match(/^\d{8}T(\d{2})(\d{2})(\d{2})$/);
  if (compactDateTime) {
    return `${compactDateTime[1]}:${compactDateTime[2]}`;
  }

  const clockTime = rawValue.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (clockTime) {
    return `${clockTime[1].padStart(2, "0")}:${clockTime[2]}`;
  }

  const compactTime = rawValue.match(/^\d{3,4}$/);
  if (compactTime) {
    const padded = rawValue.padStart(4, "0");
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
  }

  return undefined;
}

function isWithinSearchWindow(timeOfDay: string, search: TeeTimeSearch): boolean {
  if (search.earliestTime && timeOfDay < search.earliestTime) {
    return false;
  }

  if (search.latestTime && timeOfDay > search.latestTime) {
    return false;
  }

  return true;
}

function isWithinPlayerSearchWindow(timeOfDay: string, search: TeeTimePlayerSearch): boolean {
  if (search.earliestTime && timeOfDay < search.earliestTime) {
    return false;
  }

  if (search.latestTime && timeOfDay > search.latestTime) {
    return false;
  }

  return true;
}

function isClosedSlot(attrs: Record<string, string>): boolean {
  const closedFlags = [
    "expired",
    "portalClosed",
    "isBlank",
    "closed",
    "blocked"
  ];

  if (closedFlags.some((name) => isTruthy(readAttr(attrs, name)))) {
    return true;
  }

  const type = readAttr(attrs, "type")?.toLowerCase();
  return Boolean(type && ["closed", "blocked", "unavailable"].some((closedType) => type.includes(closedType)));
}

function shouldUseWebPortalBooking(attrs: Record<string, string>): boolean {
  return isTruthy(readAttr(attrs, "touchClosed")) || isTruthy(readAttr(attrs, "isTooFarAheadTouch"));
}

function readPlayerSearchText(attrs: Record<string, string>): string | undefined {
  const values = [
    readAttr(attrs, "MemberName", "PlayerName", "Name"),
    readAttr(attrs, "Description"),
    readAttr(attrs, "MemberNumber", "MemberId"),
    readAttr(attrs, "Reference", "BookingGuid", "guid")
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? values.join(" ") : undefined;
}

function countOccupiedSpots(playerNodes: XmlTag[]): number {
  return playerNodes.filter((node) => {
    if (isTruthy(readAttr(node.attrs, "IsBlank", "Empty"))) {
      return false;
    }

    return Boolean(
      readAttr(
        node.attrs,
        "BookingGuid",
        "MemberGuid",
        "MemberId",
        "MemberName",
        "Reference",
        "guid",
        "Description",
        "PlayerName"
      )
    );
  }).length;
}

function inferHoleCount(slotAttrs: Record<string, string>, playerNodes: XmlTag[]): 9 | 18 {
  if (isTruthy(readAttr(slotAttrs, "IsNineHoles", "isNineHoles"))) {
    return 9;
  }

  return playerNodes.some((node) => isTruthy(readAttr(node.attrs, "IsNineHoles", "isNineHoles"))) ? 9 : 18;
}

function readPrice(slotAttrs: Record<string, string>, playerNodes: XmlTag[]): number | undefined {
  return (
    readNumberAttr(slotAttrs, "ymPrice", "Price", "GreenFee", "Amount") ??
    playerNodes.map((node) => readNumberAttr(node.attrs, "Price", "GreenFee", "Amount")).find((price) => price !== undefined)
  );
}

function buildSlotNotes(attrs: Record<string, string>): string[] {
  const notes: string[] = [];
  if (isTruthy(readAttr(attrs, "highoccupancy"))) {
    notes.push("High occupancy.");
  }

  const color = readAttr(attrs, "ymColor");
  if (color) {
    notes.push(`GolfBox color marker: ${color}.`);
  }

  if (isTruthy(readAttr(attrs, "isTooFarAheadPortal"))) {
    notes.push("GolfBox lists this future tee time, but portal booking is not open yet.");
  } else if (isTruthy(readAttr(attrs, "isTooFarAheadTouch"))) {
    notes.push("GolfBox mobile booking is not open yet; web portal booking may still be available.");
  }

  return notes;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function toGolfBoxDate(date: string): string {
  return date.replace(/-/g, "");
}

function toWebBookingDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

function toGolfBoxDateTime(date: string, timeOfDay: string): string {
  return `${toGolfBoxDate(date)}T${timeOfDay.replace(":", "")}00`;
}

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function decodeHtmlAttribute(value: string | undefined): string | undefined {
  return value
    ?.replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readCookieHeader(cookies: Map<string, Map<string, string>>, url: string): string | undefined {
  const values = cookies.get(new URL(url).origin);
  if (!values || values.size === 0) {
    return undefined;
  }

  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeResponseCookies(cookies: Map<string, Map<string, string>>, url: string, response: Response): void {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie ? getSetCookie.call(response.headers) : response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : [];
  if (setCookies.length === 0) {
    return;
  }

  const origin = new URL(url).origin;
  let values = cookies.get(origin);
  if (!values) {
    values = new Map<string, string>();
    cookies.set(origin, values);
  }

  for (const cookie of setCookies) {
    const [keyValue] = cookie.split(";");
    const separator = keyValue.indexOf("=");
    if (separator > 0) {
      values.set(keyValue.slice(0, separator), keyValue.slice(separator + 1));
    }
  }
}

function toNorwayLocalIso(date: string, timeOfDay: string): string {
  return `${date}T${timeOfDay}:00${norwayUtcOffset(date)}`;
}

function norwayUtcOffset(date: string): "+01:00" | "+02:00" {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  const day = Number.parseInt(date.slice(8, 10), 10);
  const value = Date.UTC(year, month - 1, day);
  const dstStart = lastSundayUtc(year, 2);
  const dstEnd = lastSundayUtc(year, 9);

  return value >= dstStart && value < dstEnd ? "+02:00" : "+01:00";
}

function lastSundayUtc(year: number, monthIndex: number): number {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function redactToken(token: string): string {
  if (token.length <= 10) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }

  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}
