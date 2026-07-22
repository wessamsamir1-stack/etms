# eligibility (Admin Approvals)

Admin-portal UI for the AI-assisted eligibility approvals workflow (design:
`docs/etms/11`), consuming the backend eligibility REST API
(`backend` → `/v1/eligibility/*`).

## Screens
- **Approvals** (`ApprovalsScreen`) — the human-review queue: pending decisions with
  their band (GREEN/AMBER/RED) + risk score and **Approve / Reject** actions. Shown in
  the admin shell for users with `employee.manage`. GREEN-in-shadow and AMBER decisions
  appear here; live-mode auto-approved GREEN never enters the queue.

## Structure (Clean Architecture)
- `domain/`: `EligibilityDecision` + `Band`, `EligibilityRepository`.
- `data/`: DTO, remote data source (Dio `ApiClient` → REST), repository impl
  (maps `AppException` → `Failure`).
- `presentation/`: providers (`reviewQueueProvider`, `ApprovalsController`), screen, card.

## Integration prerequisite (important)
This feature calls the **ETMS backend REST API** via `ApiClient`, which attaches the
bearer token from secure storage. That token must be the **backend-issued JWT**
(`POST /v1/auth/login`), not only the Supabase session the rest of the admin portal
currently uses for direct CRUD. Reconciling the two auth paths — the app logging into
the backend and storing its JWT — is the documented prerequisite for this screen to work
end-to-end. The feature code itself matches the API contract in `backend/openapi.yaml`.

## Status
Reviewed, not compiled (no Flutter SDK in the build environment) — same caveat as the
rest of `etms_app`. Run `flutter pub get && flutter test` locally to exercise it.
