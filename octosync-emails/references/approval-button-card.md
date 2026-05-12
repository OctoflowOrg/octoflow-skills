# Approval card layout

The repeating unit inside every OctoSync approval email — one card
per item the human is approving. Same layout for LinkedIn options and
opportunity-pursuit items.

## Card structure (top to bottom)

1. **ID chip** — small orange (`BRAND_ORANGE`) badge with the
   workflow's id token (e.g. `option1` for LinkedIn, `1` for the
   top-ranked opportunity). 11px font, uppercase, letter-spaced.
2. **Title** — `<h3>`, 18px, 600 weight, `TEXT_BODY` color.
3. **Body** — main paragraph(s). Preserves line breaks
   (`white-space: pre-wrap`). For LinkedIn, this is the draft post
   text. For opportunities, a one-paragraph summary.
4. **Details** (optional) — structured key/value pairs rendered as
   `<strong>label:</strong> value` lines. Used by the opportunity
   workflow for target buyer / why-now / OctoSync fit / key risks /
   confidence. Not used by LinkedIn (LinkedIn's draft is body-only).
5. **Rationale** (optional) — `<strong>Rationale:</strong> one-line
   reason this card exists`. Used by LinkedIn; optional for
   opportunity.
6. **Sources** — bulleted list of `[label](url)`. 2–5 entries. Each
   workflow's caller passes the source list it received from
   upstream.
7. **Action row** — Approve and Reject buttons, separated by 8px.
   Only rendered if the caller passed an `approvalId` AND
   `EMAIL_APPROVAL_SIGNING_KEY`/`EMAIL_APPROVAL_PUBLIC_URL` are set.

## Button shape

```
[Approve <id>]    [Reject <id>]
```

- Both buttons are 9×16px padding, 6px rounded
- Approve: `APPROVE_BG` (muted operator green), white text
- Reject: `REJECT_BG` (muted operator red), white text
- Both 14px, 600 weight

The button labels include the card's id by default
(`Approve option1` / `Reject option1`, `Approve 1` / `Reject 1`).
The caller can override per card with `approveLabel` / `rejectLabel`
if a more readable label is preferable (e.g. `Pursue` /
`Skip` for opportunities — operator's call).

## Button URL shape

Each button's `href` is an HMAC-signed URL to the email-approvals
sidecar:

```
${EMAIL_APPROVAL_PUBLIC_URL}/confirm?token=<encoded-token>
```

Token construction: see `sidecar-protocol.md`. The renderer calls
`sign-approval-link.mjs` to produce the URL.

## When buttons are absent

If the caller didn't pass an `approvalId`, or if the signing key/URL
env vars are unset, the action row is omitted entirely. The card
still renders with id chip, title, body, etc. — the human reads the
email and acts via Paperclip's inbox instead. The body's
"Approve/reject from the buttons below" intro line falls back to
"Approvals remain in Paperclip…" automatically.

## Body text caveats

- Caller passes plain text/markdown. Renderer HTML-escapes it.
- Line breaks in the body are preserved (`white-space: pre-wrap`).
- Sources are typed as `{label, url}` objects. The renderer escapes
  both. URL must be a string; the renderer does not check protocol.
- Details (key/value pairs) accept plain text — renderer escapes
  values.
