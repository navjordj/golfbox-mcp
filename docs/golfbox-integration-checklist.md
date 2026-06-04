# GolfBox Integration Checklist

Use this checklist before enabling real booking writes.

## Access

- Official API documentation or written integration agreement exists.
- API base URL and authentication method are documented.
- Scope of credentials is limited to the relevant club/user.
- The integration is allowed for agent-assisted booking.

## Booking rules

- Release windows are known per club/course.
- Member and guest booking permissions are known.
- Cancellation deadlines and penalties are known.
- Payment requirements are known.
- Max players, hole count, and cart/extra options are known.

## Agent guardrails

- Write tools stay disabled by default.
- Booking requires an idempotency key.
- Booking requires explicit user confirmation.
- Cancellation requires explicit user confirmation.
- Logs avoid credentials and unnecessary personal data.
- The agent exposes final price/fees before write actions.

## Production readiness

- Rate limits and retry policy are implemented.
- API errors are mapped to user-safe messages.
- Booking conflicts are handled gracefully.
- Audit logs capture who requested the action and when.
- Tests cover search, prepare, booking success, duplicate booking, cancellation, and API failures.
