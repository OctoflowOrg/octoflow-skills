# OctoSync brand shell (email)

The unified outer chrome for every OctoSync workflow email. Both the
LinkedIn review email and the weekly opportunity digest use this
shell — same colors, same compact 64px header, same footer.

## Palette

| Token | Value | Use |
|---|---|---|
| `BRAND_TEAL` | `#2d6065` | header background |
| `BRAND_TEAL_DARK` | `#234d52` | links, accent dividers |
| `BRAND_ORANGE` | `#d97543` | option-id badge, accents |
| `BRAND_CREAM` | `#e8d8b8` | eyebrow text on the teal header |
| `TEXT_BODY` | `#1f2937` | primary body copy |
| `TEXT_MUTED` | `#6b7280` | secondary copy, dates, footnotes |
| `CARD_BORDER` | `#e5e7eb` | card and divider lines |
| `PAGE_BG` | `#fafaf7` | warm off-white page background |
| `APPROVE_BG` | `#0d8857` | Approve button (muted operator green) |
| `REJECT_BG` | `#9b2c2c` | Reject button (muted operator red) |

These are the canonical OctoSync brand colors from the Capabilities
Deck. Do NOT introduce alternate palettes per workflow. The previous
opportunity-digest gradient header (`#0f766e` → `#155e75`) was an
unintentional brand split and has been retired.

## Header layout

Compact, ~64px tall. Brand teal background. Small icon (40×32px) +
wordmark + eyebrow line that names the workflow.

```
+----------------------------------------------------------+
| [icon]  OCTOSYNC                                          |
|         <EYEBROW LABEL>                                   |
+----------------------------------------------------------+
```

The eyebrow label is workflow-specific (`LinkedIn Draft Review`,
`Weekly Opportunity Digest`, etc.) — passed in via the payload.

The icon is served by the email-approvals sidecar at
`${EMAIL_APPROVAL_PUBLIC_URL}/static/octosync-icon.png`. If
`EMAIL_APPROVAL_PUBLIC_URL` is unset, the icon is omitted (text-only
header).

## Body chrome

- Full-width 640px max (`max-width:640px;margin:0 auto`)
- White card with `CARD_BORDER` 1px border, 8px rounded corners
- Card top is flush against the header (header is `border-radius:8px 8px 0 0`, card is `border-radius:0 0 8px 8px`)
- The card contains: company name as `<h1>`, summary paragraph, a thin divider, a one-line note on how to act

## Card grid

Approval cards sit BELOW the main info card, each as a standalone
section with the same border + radius style. See
`approval-button-card.md` for per-card layout.

## Footer

Plain, muted, short:

> Action links expire in 7 days. After that, action via the
> Paperclip inbox.
> Generated YYYY-MM-DD by the OctoSync <workflow> workflow.

The "Action links expire" line is only shown when buttons are
present.

## Asset location

The icon PNG lives in the sidecar service at
`services/email-approvals/static/octosync-icon.png` (23KB,
256px max edge). Served at `/email-approval/static/octosync-icon.png`.
This stays canonical — do not duplicate the asset into the skill.
