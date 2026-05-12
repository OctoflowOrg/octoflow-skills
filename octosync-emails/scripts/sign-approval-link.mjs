// HMAC-SHA256 token signer for OctoSync approval-email button URLs.
//
// The matching verifier lives in services/email-approvals/token.mjs;
// the algorithm and TTL must stay in sync. Both sides read the same
// EMAIL_APPROVAL_SIGNING_KEY env var.
//
// Token shape (matches sidecar's verifyToken):
//   <payloadB64>.<sigB64>
// where payloadB64 = base64url(JSON.stringify({a, k, e}))
//   a: approvalId (string)
//   k: action ("approve" | "reject")
//   e: expiresAtUnix (integer seconds since epoch)
// and sigB64 = base64url(HMAC-SHA256(signingKey, payloadB64))

import { createHmac } from "node:crypto";

export const APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signApprovalUrl({ approvalId, action, baseUrl, signingKey }) {
  if (typeof approvalId !== "string" || approvalId.trim() === "") {
    throw new Error("signApprovalUrl: approvalId required");
  }
  if (action !== "approve" && action !== "reject") {
    throw new Error(`signApprovalUrl: action must be "approve" or "reject"`);
  }
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("signApprovalUrl: baseUrl required");
  }
  if (typeof signingKey !== "string" || signingKey.trim() === "") {
    throw new Error("signApprovalUrl: signingKey required");
  }

  const expiresAtUnix =
    Math.floor(Date.now() / 1000) + APPROVAL_TOKEN_TTL_SECONDS;
  const payloadB64 = Buffer.from(
    JSON.stringify({ a: approvalId, k: action, e: expiresAtUnix }),
  ).toString("base64url");
  const sigB64 = createHmac("sha256", signingKey)
    .update(payloadB64)
    .digest("base64url");
  const token = `${payloadB64}.${sigB64}`;
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  return `${trimmedBase}/confirm?token=${encodeURIComponent(token)}`;
}
