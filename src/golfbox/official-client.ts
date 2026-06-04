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
  TeeTimeSlot,
  Tournament
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
  FirstName?: unknown;
  LastName?: unknown;
  FullName?: unknown;
  Name?: unknown;
  ClubGuid?: unknown;
  ClubName?: unknown;
  MemberNumber?: unknown;
  CountryIsoCode?: unknown;
  HasAccessToBooking?: unknown;
  UseNewApp?: unknown;
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
  BookingGroupGuid?: unknown;
  MemberGuid?: unknown;
  MemberNumber?: unknown;
  FirstName?: unknown;
  LastName?: unknown;
  FullName?: unknown;
  Name?: unknown;
  ClubGuid?: unknown;
  ClubName?: unknown;
  BookingIsPaid?: unknown;
  Confirmable?: unknown;
  Confirmed?: unknown;
  IsEditable?: unknown;
  Items?: unknown;
}

interface TeeTimeResourceSettingsResponse {
  HasInternetPayment?: unknown;
  ForceInAdvancePayment?: unknown;
  PaymentConfirmsTeeTime?: unknown;
}

interface TeeTimeBookingItemResponse {
  Price?: unknown;
  Paid?: unknown;
}

interface TeeTimeResponse {
  BookingGuid?: unknown;
  BookingGroupGuid?: unknown;
  ClubGuid?: unknown;
  ClubName?: unknown;
  ResourceGuid?: unknown;
  ResourceName?: unknown;
  TeeTime?: unknown;
  SessionKey?: unknown;
  SessionGuid?: unknown;
  LockGuid?: unknown;
  IsReadOnly?: unknown;
  ReadOnlyReason?: unknown;
  ConfirmationWindowOpen?: unknown;
  ResourceSettings?: unknown;
  Players?: TeeTimePlayerResponse[];
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

export class OfficialGolfBoxClient implements GolfBoxClient {
  private readonly baseUrl: string;
  private readonly webBaseUrl: string;
  private readonly country: string;
  private readonly appLanguage: string;
  private readonly appVersion: string;
  private readonly clientUserAgent: string;
  private readonly saveTeeTimeTimeoutMs: number;
  private readonly saveReconciliationDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly webRequestTimeoutMs: number;
  private readonly includeErrorBodySnippets: boolean;
  private cachedToken?: AuthToken;
  private cachedUser?: AuthenticatedUser;
  private readonly bookingsByIdempotencyKey = new Map<string, Promise<Booking>>();
  private readonly responseContexts = new WeakMap<Response, { method: string; path: string }>();

  constructor(private readonly options: OfficialGolfBoxClientOptions) {
    this.country = (options.country ?? "NO").toUpperCase();
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
      `AppCountry:${this.country};` +
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

    const mobileHubResources = await this.listResourcesForClub(search.clubId);
    const resources =
      mobileHubResources.length > 0 ? mobileHubResources : await this.listWebResourcesForClub(search.clubId);
    const memberClubGuid = user.clubGuid ?? search.clubId;
    const slots: TeeTimeSlot[] = [];

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

      slots.push(...parseTeeTimeXml(xml, search, resource, memberClubGuid));
    }

    return slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
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
      if (toOptionalBoolean(session.IsReadOnly)) {
        const reason = toOptionalString(session.ReadOnlyReason) ?? "no reason supplied";
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

    if (request.players.length > 1) {
      throw new Error(
        "This tee time is only open in the GolfBox web portal. Web portal booking is currently mapped only for the authenticated player."
      );
    }

    const session = await this.createWebSession();
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

    const form = parseWebFormFields(page.text);
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
      await this.cancelWebBookingWindow(session, page.url, page.text);
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

  private async loginWithToken(token: string): Promise<AuthenticatedUser> {
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

  private async getAuthenticatedUser(): Promise<AuthenticatedUser> {
    if (this.cachedUser) {
      return this.cachedUser;
    }

    return (await this.authenticate()).user ?? {};
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
      const session = await this.createWebSession();
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

      const resources = parseWebBookingResources(page.text, page.url);
      return resources.map((resource) => ({
        ...resource,
        clubGuid
      }));
    } catch {
      return [];
    }
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

    return session;
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

    return {
      provider: "official",
      baseUrl: this.baseUrl,
      country: this.country,
      authenticated: true,
      tokenSource: authToken.source,
      tokenPreview: redactToken(authToken.token),
      tokenLength: authToken.token.length,
      validatedWithLogin: true,
      user,
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
  return `${teeTime.slice(0, 4)}-${teeTime.slice(4, 6)}-${teeTime.slice(6, 8)}`;
}

function golfBoxDateTimeToTimeOfDay(teeTime: string): string {
  return `${teeTime.slice(9, 11)}:${teeTime.slice(11, 13)}`;
}

function formatGolfBoxDateTime(teeTime: string): string {
  if (!/^\d{8}T\d{6}$/.test(teeTime)) {
    return teeTime;
  }

  return `${golfBoxDateTimeToIsoDate(teeTime)} ${golfBoxDateTimeToTimeOfDay(teeTime)}`;
}

function golfBoxDateTimeToIso(value: unknown): string | undefined {
  const text = toOptionalString(value);
  if (!text || !/^\d{8}T\d{6}$/.test(text)) {
    return undefined;
  }

  const date = golfBoxDateTimeToIsoDate(text);
  return toNorwayLocalIso(date, golfBoxDateTimeToTimeOfDay(text));
}

function parseTeeTimeResponse(value: unknown): TeeTimeResponse {
  const record = pickRecord(value, "TeeTime", "Data", "Result");
  if (!record) {
    throw new Error("GolfBox returned an invalid tee-time booking response.");
  }

  return record as TeeTimeResponse;
}

function readSessionKey(response: TeeTimeResponse): string | undefined {
  return toOptionalString(response.SessionKey ?? response.SessionGuid ?? response.LockGuid);
}

function ensureBookingCanBeSavedWithoutPayment(response: TeeTimeResponse): void {
  const resourceSettings = isRecord(response.ResourceSettings)
    ? (response.ResourceSettings as TeeTimeResourceSettingsResponse)
    : undefined;
  const hasInternetPayment = toOptionalBoolean(resourceSettings?.HasInternetPayment) === true;
  const forceInAdvancePayment = toOptionalBoolean(resourceSettings?.ForceInAdvancePayment) === true;
  const paymentConfirmsTeeTime = toOptionalBoolean(resourceSettings?.PaymentConfirmsTeeTime) === true;

  if (hasInternetPayment && forceInAdvancePayment && paymentConfirmsTeeTime && teeTimeHasUnpaidItems(response)) {
    throw new Error(
      "GolfBox requires advance payment before this tee time can be booked. The MCP adapter does not automate payment yet, so this booking must be completed manually in GolfBox."
    );
  }
}

function teeTimeHasUnpaidItems(response: TeeTimeResponse): boolean {
  const players = Array.isArray(response.Players) ? response.Players : [];
  return players.some((player) => {
    if (toOptionalBoolean(player.BookingIsPaid) === true) {
      return false;
    }

    const items = Array.isArray(player.Items) ? player.Items : [];
    return items.some((item) => {
      if (!isRecord(item)) {
        return false;
      }

      const bookingItem = item as TeeTimeBookingItemResponse;
      if (toOptionalBoolean(bookingItem.Paid) === true) {
        return false;
      }

      return readMoney(bookingItem.Price) > 0;
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

function mapBookingFromTeeTime(
  response: TeeTimeResponse,
  request: CreateBookingRequest,
  slot: SlotKey,
  prefix?: string
): Booking {
  const players = Array.isArray(response.Players) ? response.Players : [];
  const golfBoxReference =
    toOptionalString(response.BookingGroupGuid ?? response.BookingGuid) ??
    players
      .map((player) => toOptionalString(player.BookingGroupGuid ?? player.BookingGuid))
      .find((reference) => reference !== undefined);
  const needsConfirmation = players.some(
    (player) => toOptionalBoolean(player.Confirmable) === true && toOptionalBoolean(player.Confirmed) === false
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
  const resourceGuid = toOptionalString(response.ResourceGuid);
  const teeTime = toOptionalString(response.TeeTime);
  const memberClubGuid = user.clubGuid ?? toOptionalString(response.ClubGuid);
  if (!resourceGuid || !teeTime || !memberClubGuid) {
    return undefined;
  }

  const slotId = `${stripGuidBraces(resourceGuid)}|${teeTime}|${stripGuidBraces(memberClubGuid)}`;
  const players = Array.isArray(response.Players) ? response.Players : [];
  const needsConfirmation = players.some(
    (player) => toOptionalBoolean(player.Confirmable) === true && toOptionalBoolean(player.Confirmed) === false
  );
  const golfBoxReference =
    toOptionalString(response.BookingGroupGuid ?? response.BookingGuid) ??
    players
      .map((player) => toOptionalString(player.BookingGroupGuid ?? player.BookingGuid))
      .find((reference) => reference !== undefined);
  const courseName = toOptionalString(response.ResourceName) ?? "GolfBox";
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

function parseTeeTimeResponses(value: unknown): TeeTimeResponse[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as TeeTimeResponse[];
  }

  const values = pickArray(value, "TeeTimes", "Times", "Bookings", "Items", "Data", "Result");
  if (values.length > 0) {
    return values.filter(isRecord) as TeeTimeResponse[];
  }

  const single = pickRecord(value, "TeeTime", "Data", "Result");
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
    const candidateResourceGuid = normalizeGuid(toOptionalString(teeTime.ResourceGuid));
    const candidateTeeTime = toOptionalString(teeTime.TeeTime);

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

function mapUser(response: MobileHubUserResponse): AuthenticatedUser {
  const firstName = toOptionalString(response.FirstName);
  const lastName = toOptionalString(response.LastName);
  const derivedName = [firstName, lastName].filter(Boolean).join(" ");

  return {
    guid: toOptionalString(response.Guid),
    fullName: toOptionalString(response.FullName) ?? toOptionalString(response.Name) ?? (derivedName || undefined),
    clubGuid: toOptionalString(response.ClubGuid),
    clubName: toOptionalString(response.ClubName),
    memberNumber: toOptionalString(response.MemberNumber),
    countryIsoCode: toOptionalString(response.CountryIsoCode),
    hasAccessToBooking: toOptionalBoolean(response.HasAccessToBooking),
    useNewApp: toOptionalBoolean(response.UseNewApp)
  };
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

function isClosedSlot(attrs: Record<string, string>): boolean {
  const closedFlags = [
    "expired",
    "portalClosed",
    "isBlank",
    "isTooFarAheadPortal",
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

function toGolfBoxDateTime(date: string, timeOfDay: string): string {
  return `${toGolfBoxDate(date)}T${timeOfDay.replace(":", "")}00`;
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
