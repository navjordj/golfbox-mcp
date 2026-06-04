# GolfBox MobileHub Contract

This is an unofficial contract extracted from the public Android app package `com.golfboxdk`, version `2.7.003` / version code `242`, and validated with a read-only unauthenticated request on 2026-05-27.

It is not an official GolfBox API agreement. Treat it as a reverse-engineered compatibility map until GolfBox or a club gives written permission to use these endpoints for agent-assisted booking.

## Evidence

- Google Play confirms the GolfBox app supports booking, "My times", changes and cancellation.
- APK mirrors list `com.golfboxdk` version `2.7.003`.
- The APK contains Retrofit interfaces under `com.golfboxdk.*.api`.
- A read-only request to `https://app.golfbox.dk/teeTime/booking?methodName=clubsForCountry` reached GolfBox and returned `401` with a `MobileHub-Error` header, confirming the base URL and route family exist.

## Base URLs

```text
Live: https://app.golfbox.dk/
Test: https://test.app.golfbox.dk/
```

The app can also switch to a local development host, but only the live/test domains are relevant here.

## Common Headers

The app adds these headers to MobileHub calls:

```http
Client-User-Agent: AppCountry:NO;AppUserCountryNO;AppLanguage:en;AppVersion:2.7.003;Model:<device>;OS:<android-version>;
Authorization: <token returned by authentication>
Accept: application/json | application/xml | text/plain
```

Notes:

- `Authorization` is stored as the raw string returned by `POST /authentication?methodName=authenticate`.
- The app retries non-auth `401` responses by re-authenticating and replaying the original request.
- JSON uses Gson `UPPER_CAMEL_CASE`, so a Java/Kotlin field named `resourceGuid` serializes as `ResourceGuid`.
- Date/time format is `yyyyMMdd'T'HHmmss`, for example `20260601T081000`.

## Authentication

```http
POST /authentication?methodName=authenticate&country=NO
Accept: text/plain
Content-Type: application/json
```

Request body:

```json
{
  "Username": "<golfbox-username>",
  "Password": "<golfbox-password>"
}
```

Response body is a plain-text auth token. Use it directly as the `Authorization` header for later calls.

The app also has:

```http
POST /profile/member?methodName=login&country=NO
Accept: application/json
Authorization: <token>
```

Response shape includes user details such as `Guid`, `ClubGuid`, `ClubName`, `MemberNumber`, `CountryIsoCode`, and `HasAccessToBooking`.

## Tee-Time Booking Endpoints

All endpoints are relative to `https://app.golfbox.dk/`.

| Method | Path | Accept | Purpose |
| --- | --- | --- | --- |
| `GET` | `/teeTime/booking?methodName=clubsForCountry` | JSON | List clubs available to the user/country. |
| `GET` | `/teeTime/booking?methodName=resourcesForClub&clubGuid=<guid>` | JSON | List courses/resources for a club. |
| `GET` | `/teeTime/booking?methodName=teeTimesForDay&resourceGuid=<guid>&teeTime=<yyyymmdd>&memberclubguid=<guid>` | XML | Get the day grid for one course/resource. |
| `POST` | `/teeTime/booking?methodName=tryEditTeeTime` | JSON | Lock/open a selected tee time before editing/booking. |
| `POST` | `/teeTime/booking?methodName=editTeeTime` | JSON | Open an existing booked tee time for editing. |
| `GET` | `/teeTime/booking?methodName=teeTimesForPlayer` | JSON | List the logged-in user's tee times. |
| `GET` | `/teeTime/booking?methodName=searchPlayerForTeeTime&sessionKey=<key>&searchInCountry=NO&name=<name>&memberNumber=<number>&club=<club>` | JSON | Search members to add to a booking session. |
| `POST` | `/teeTime/booking?methodName=addPlayerToTeeTime` | JSON | Add a GolfBox member to a booking session. |
| `POST` | `/teeTime/booking?methodName=addGuestPlayerToTeeTime` | JSON | Add a guest player to a booking session. |
| `GET` | `/teeTime/booking?methodName=saveTeeTime&sessionKey=<key>` | JSON | Save/finalize a booking session. The Android client treats this as a raw `ResponseBody`, not a tee-time JSON payload. |
| `POST` | `/teeTime/booking?methodName=confirmTeeTimePlayers` | JSON | Confirm players on a tee time. |
| `DELETE` | `/teeTime/booking?methodName=deletePlayerFromTeeTime&sessionKey=<key>&deletePlayer=<guid>` | JSON | Remove a player from a booking session. |
| `DELETE` | `/teeTime/booking?methodName=deleteSession&sessionKey=<key>` | JSON | Abandon/delete a booking session lock. |
| `DELETE` | `/teeTime/booking?methodName=deleteTeeTime&resourceGuid=<guid>&teeTime=<yyyyMMdd'T'HHmmss>&memberclubguid=<guid>` | JSON | Cancel a booked tee time. |
| `POST` | `/teeTime/locks?methodName=deleteLock` | JSON | Delete an explicit lock by lock/session guid. |
| `GET` | `/teeTime/booking?methodName=warningsForTeeTimeOnResource&resourceGuid=<guid>&teeTime=<yyyyMMdd'T'HHmmss>` | JSON | Get booking warnings for a slot/resource. |

## Core Booking Flow

1. Authenticate with GolfBox username/password.
2. Call `profile/member?methodName=login&country=NO` and verify `HasAccessToBooking`.
3. Call `clubsForCountry`.
4. Call `resourcesForClub` for the selected club.
5. Call `teeTimesForDay` with `teeTime=YYYYMMDD` to get the day grid.
6. Pick a slot, then call `tryEditTeeTime` with `ResourceGuid`, `TeeTime`, and `MemberClubGuid`. Use the `Ressource_GUID` from the `teeTimesForDay` XML `Setup` node as `ResourceGuid`; the Android client does not necessarily reuse the guid passed into `teeTimesForDay`.
7. Optionally call `searchPlayerForTeeTime`, `addPlayerToTeeTime`, or `addGuestPlayerToTeeTime`.
8. Call `saveTeeTime` using the `SessionKey` returned from `tryEditTeeTime`; treat any 2xx response body as opaque.
9. Call `teeTimesForPlayer` to verify the saved booking and capture the booking reference.
10. If required, call payment/confirmation endpoints.

## Key Request Bodies

`tryEditTeeTime` / `editTeeTime`:

```json
{
  "ResourceGuid": "<resource-guid>",
  "TeeTime": "20260601T081000",
  "MemberClubGuid": "<user-club-guid>"
}
```

`addPlayerToTeeTime`:

```json
{
  "SessionGuid": "<session-key>",
  "PlayerGuid": "<member-guid>",
  "ClubGuid": "<club-guid>",
  "ConfirmBy": "TeeTime",
  "ConfirmableByApp": true,
  "ConfirmationWindowOpen": true
}
```

`addGuestPlayerToTeeTime`:

```json
{
  "SessionGuid": "<session-key>",
  "Gender": "M",
  "Junior": false,
  "Hcp": {
    "Value": "18.0"
  }
}
```

`confirmTeeTimePlayers`:

```json
{
  "ConfirmPlayers": [
    { "BookingGuid": "<booking-guid>" }
  ],
  "LockGuid": "<session-key>",
  "PaymentMode": "Confirmation",
  "ResourceGuid": "<resource-guid>",
  "TeeTime": "20260601T081000",
  "TeeTimeIsReadOnly": false
}
```

`deleteLock`:

```json
{
  "LockGuid": "<session-key>",
  "ResourceGuid": "<resource-guid>",
  "TeeTime": "20260601T081000"
}
```

## Important Response Shapes

`clubsForCountry` returns `TeeClub[]` with fields such as:

```json
{
  "Guid": "<club-guid>",
  "Name": "Club name",
  "ID": "<club-id>",
  "Country": "NO",
  "HasBooking": "true",
  "IsGolfBoxClub": "true",
  "GPSLocation": {}
}
```

`tryEditTeeTime`, `editTeeTime`, and `teeTimesForPlayer` return `TeeTime` objects:

```json
{
  "ClubGuid": "<club-guid>",
  "ClubName": "Club name",
  "ResourceGuid": "<resource-guid>",
  "ResourceName": "Course name",
  "TeeTime": "20260601T081000",
  "SessionKey": "<session-key>",
  "IsReadOnly": false,
  "ReadOnlyReason": null,
  "ConfirmationWindowOpen": true,
  "Players": [
    {
      "BookingGuid": "<booking-guid>",
      "BookingGroupGuid": "<group-guid>",
      "MemberGuid": "<member-guid>",
      "MemberNumber": "<member-number>",
      "FirstName": "First",
      "LastName": "Last",
      "ClubName": "Club",
      "BookingIsPaid": true,
      "Confirmable": true,
      "Confirmed": false,
      "IsEditable": true,
      "Items": []
    }
  ]
}
```

`teeTimesForDay` returns XML. Important attributes parsed by the app:

- `Setup`: `MaxNumberOfPlayers`, `MinNumberOfPlayers`, `Interval`, `IntervalUnit`, `Ressource_GUID`, `Ressource_Name`, `Club_GUID`, `Club_Name`, `TimeStart`, `TimeEnd`.
- `slot`: `time`, `expired`, `portalClosed`, `touchClosed`, `isBlank`, `type`, `highoccupancy`, `ymColor`, `ymPrice`, `isTooFarAheadPortal`, `isTooFarAheadTouch`.
- `slotnode`: `IsPaid`, `IsMerge`, `IsNineHoles`, `IsGreenFee`, `IsLocked`, `IsConfirmed`, `IsJunior`, `MemberSex`, `MemberHCP`, `MemberId`, `MemberName`, `Reference`, `guid`, `Description`, `gradient`, `IsFlex`, `Price`, `ClubName`.

## Payment Endpoints

These are used when the booking requires payment or payment also confirms the tee time:

| Method | Path |
| --- | --- |
| `POST` | `/teeTime/payment?methodName=InitPayment` |
| `POST` | `/teeTime/payment?methodName=startPaymentProcess` |
| `POST` | `/teeTime/payment?methodName=finishPaymentProcess` |
| `POST` | `/teeTime/payment?methodName=selectedPaymentPlayers` |
| `POST` | `/teeTime/payment?methodName=vouchervalidate` |
| `POST` | `/teeTime/payment?methodName=voucherreserve` |
| `POST` | `/teeTime/payment?methodName=vouchercancel` |

For a first MCP implementation, keep paid bookings read-only or require a human confirmation step before any payment action.

## Tournament Endpoints

Validated with an authenticated read-only request on 2026-06-04.

| Method | Path | Accept | Purpose |
| --- | --- | --- | --- |
| `GET` | `/tournament?methodName=tournamentsForPlayer` | JSON | List tournaments the logged-in player is registered for or has participated in. |

The same payload was also returned from `/tournament/player?methodName=tournamentsForPlayer` and `/tournament/registration?methodName=tournamentsForPlayer` during discovery, but the MCP uses the shorter `/tournament` route.

Response shape:

```json
{
  "SearchFrom": "20250604T073105",
  "SearchTo": "20270604T073105",
  "Tournaments": [
    {
      "CompetitionId": 5329410,
      "CustomerName": "Organizer name",
      "EndDate": "20260614T000000",
      "Name": "Tournament name",
      "StartDate": "20260613T000000"
    }
  ]
}
```

## Error Headers

The app reads these response headers:

```http
GolfBox-API-Error-Code: <code>
GolfBox-API-Error-Message: <message>
MobileHub-Error: <message>
```

## Implementation Notes For This MCP

- Add `GOLFBOX_USERNAME`, `GOLFBOX_PASSWORD`, and `GOLFBOX_COUNTRY=NO` only in local environment or a secret store.
- Cache the auth token in memory, not on disk.
- `OfficialGolfBoxClient` now uses `tryEditTeeTime` followed by `saveTeeTime` when write tools are explicitly enabled.
- Tee-time search stores the booking resource from the day-grid XML `Setup.Ressource_GUID` in `slotId`, matching the Android client's `tryEditTeeTime` payload.
- Tee times can be portal-open while `touchClosed=1` or `isTooFarAheadTouch=1`. Search keeps those slots visible, and create-booking uses the web portal `window.asp` form flow for the authenticated player instead of calling MobileHub `tryEditTeeTime`. A successful web form save that returns to the booking grid is treated as `confirmed`, even if `teeTimesForPlayer` lags behind.
- The first booked player is assumed to be the authenticated GolfBox user. Additional members require a `golfId`/member number so the adapter can resolve them with `searchPlayerForTeeTime`.
- `saveTeeTime` is bounded by `GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS`, read as raw text, and reconciled with `teeTimesForPlayer` after the call.
- The Android app loads `warningsForTeeTimeOnResource` before saving; the MCP mirrors this as a non-blocking advisory call.
- If `tryEditTeeTime` returns `ResourceSettings` requiring advance internet payment that confirms the tee time, the MCP stops before `saveTeeTime` and releases the lock because payment automation is not implemented.
- The MCP exposes `golfbox_list_bookings` for direct `teeTimesForPlayer` checks after ambiguous booking attempts.
- Always call `deleteSession` or `deleteLock` when abandoning a booking flow.
- Keep booking/cancellation behind explicit confirmation and an idempotency key.
- Do not automate payment until the exact fee, cancellation policy, and payment consent are shown to the user.
