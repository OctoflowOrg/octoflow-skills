// Smoke test: render the bundled approval email with a sample payload.
// Run after `npm run build` via `node scripts/smoke.mjs`. Confirms the
// dist bundle imports + produces non-empty HTML containing the brand
// markers we expect.
import { renderApprovalEmailHtml } from "../dist/render.mjs";

const html = await renderApprovalEmailHtml({
    eyebrowLabel: "LinkedIn Draft Review",
    companyName: "OctoSync",
    generatedAt: "2026-05-11",
    summary: "Three draft options ready for review.",
    iconUrl: "https://example.com/static/octosync-icon.png",
    anyButtons: true,
    parentIssueIdentifier: "OCT-241",
    parentIssueUrl: "https://paperclip.example/octosync/issues/OCT-241",
    cards: [
        {
            id: "option1",
            title: "Renewables procurement pulse — option A",
            body: "Tight, voice-aligned, 1180 chars.",
            details: [
                { label: "Target buyer", value: "Ops Manager" }
            ],
            rationale: "Best mix of voice + technical claim density.",
            sources: [
                { label: "DOE PPA report 2026", url: "https://example.com/doe" }
            ],
            approvalId: "ap_abc",
            approveLabel: "Approve option1",
            rejectLabel: "Reject option1",
            approveUrl: "https://example.com/approve?id=ap_abc",
            rejectUrl: "https://example.com/reject?id=ap_abc"
        }
    ]
});

if (!html.includes("OCTOSYNC")) throw new Error("Missing OCTOSYNC header");
if (!html.includes("LinkedIn Draft Review")) throw new Error("Missing eyebrow label");
if (!html.includes("option1")) throw new Error("Missing card id chip");
if (!html.includes("approve?id=ap_abc")) throw new Error("Missing approve URL");
if (!html.includes("reject?id=ap_abc")) throw new Error("Missing reject URL");
if (!html.includes("#2d6065")) throw new Error("Missing brand teal color");
if (!html.includes("#d97543")) throw new Error("Missing brand orange color");

process.stdout.write(`OK ${html.length} bytes\n`);
