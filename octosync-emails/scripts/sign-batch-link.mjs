// HMAC-SHA256 token signer for OctoSync email-approval forms.
//
// The token ties one email's checkbox form to the set of Paperclip
// approvals it represents, via an opaque-to-the-user `emailRef`
// string that the orchestrator bakes into each approval's
// `payload.emailRef` at creation time. The sidecar's /decide endpoint
// verifies the token and queries Paperclip for approvals matching
// that emailRef — Paperclip is the authoritative tree.
//
// Algorithm and TTL match sign-approval-link.mjs; same
// EMAIL_APPROVAL_SIGNING_KEY env var.
//
// Token shape:
//   <payloadB64>.<sigB64>
// where payloadB64 = base64url(JSON.stringify({r, c, e}))
//   r: emailRef (string — usually the Resend Idempotency-Key value,
//      e.g. "prospecting-approval:<parentId>")
//   c: companyId (string — Paperclip company UUID, needed because
//      Paperclip's approval-list endpoint is company-scoped)
//   e: expiresAtUnix (integer seconds since epoch)
// and sigB64 = base64url(HMAC-SHA256(signingKey, payloadB64))

import { createHmac } from "node:crypto";

export const EMAIL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signEmailToken({
  emailRef,
  companyId,
  signingKey,
  expiresAtUnix,
}) {
  if (typeof emailRef !== "string" || emailRef.trim() === "") {
    throw new Error("signEmailToken: emailRef required");
  }
  if (typeof companyId !== "string" || companyId.trim() === "") {
    throw new Error("signEmailToken: companyId required");
  }
  if (typeof signingKey !== "string" || signingKey.trim() === "") {
    throw new Error("signEmailToken: signingKey required");
  }
  const exp =
    expiresAtUnix ?? Math.floor(Date.now() / 1000) + EMAIL_TOKEN_TTL_SECONDS;
  if (!Number.isFinite(exp)) {
    throw new Error("signEmailToken: expiresAtUnix must be finite");
  }
  const payloadB64 = Buffer.from(
    JSON.stringify({ r: emailRef, c: companyId, e: exp }),
  ).toString("base64url");
  const sigB64 = createHmac("sha256", signingKey)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sigB64}`;
}

export function decideActionUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("decideActionUrl: baseUrl required");
  }
  return `${baseUrl.replace(/\/+$/, "")}/decide`;
}
