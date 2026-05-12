# Email-approvals sidecar protocol

The `services/email-approvals/` service ("the sidecar") is a small
Node service that turns email-button clicks into authenticated
Paperclip API calls. It is workflow-agnostic — every OctoSync
approval email shares the same protocol.

## URL shapes

| Route | Purpose |
|---|---|
| `GET /email-approval/health` | sidecar healthcheck |
| `GET /email-approval/static/<file>` | static brand assets (icon) |
| `GET /email-approval/confirm?token=<token>` | renders the confirmation page after a button click |
| `POST /email-approval/action` (body: `{ token }`) | executes the approve/reject against Paperclip |

The Approve/Reject buttons in emails point at
`${EMAIL_APPROVAL_PUBLIC_URL}/confirm?token=<urlencoded-token>`.
After the user lands on the confirm page and clicks "Confirm," the
page `POST`s to `/email-approval/action`.

## Token shape

```
<payloadB64>.<sigB64>
```

- `payloadB64`: base64url-encoded JSON of
  `{ a: approvalId, k: action, e: expiresAtUnix }` where `action` is
  `"approve"` or `"reject"`
- `sigB64`: base64url-encoded HMAC-SHA256 of `payloadB64` using the
  shared secret `EMAIL_APPROVAL_SIGNING_KEY`

The sidecar's `verifyToken` (see `services/email-approvals/token.mjs`)
parses, recomputes the HMAC with a timing-safe compare, and rejects
expired tokens.

## TTL

`APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60` (7 days). Tokens
expire after this window. The sidecar returns a "this link has
expired" page for stale tokens; the human can still act via the
Paperclip inbox.

## What the sidecar does on action

When `/email-approval/action` is hit with a valid token:

1. Decode → `{ approvalId, action }`.
2. Authenticate against Paperclip's better-auth using a service-user
   email/password (`EMAIL_APPROVAL_SERVICE_EMAIL` /
   `EMAIL_APPROVAL_SERVICE_PASSWORD`).
3. Call `POST /api/approvals/${approvalId}/approve` or `/reject`.
4. Render an outcome page:
   - `won` — first approval to succeed on its parent (LinkedIn:
     `single_select` semantics where first-wins; opportunity:
     `multi_select` where each approval is independent and always
     "won")
   - `stale` — another approval on the same parent already won
     (LinkedIn only)
   - `already_actioned` — approval was already decided
   - `rejected` — reject succeeded

The sidecar then makes a HTTP call to Paperclip; Paperclip fires the
`approval_approved` or `approval_rejected` wake on whichever agent
owns the approval (CMO for LinkedIn, CSO for opportunity).

## Env vars (sidecar side)

- `EMAIL_APPROVAL_SIGNING_KEY` (must match the renderer's value)
- `PAPERCLIP_API_URL`
- `PAPERCLIP_PUBLIC_URL` (for the Origin header on better-auth)
- `EMAIL_APPROVAL_SERVICE_EMAIL`, `EMAIL_APPROVAL_SERVICE_PASSWORD`
- `PORT` (default 3200)

## What's workflow-specific (caller-side)

The sidecar itself is fully workflow-agnostic. Workflow-specific
behavior lives in the Paperclip approval's `payload` field — see
`approval-payload.md` for the per-workflow `payload` shape.
