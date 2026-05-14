import { ApprovalEmail } from "../src/ApprovalEmail";
import type { ApprovalEmailPayload } from "../src/types";
import { iconDataUrl } from "./icon";

const sample: ApprovalEmailPayload = {
    eyebrowLabel: "LinkedIn Draft Review",
    companyName: "OctoSync",
    generatedAt: "2026-05-14",
    summary:
        "Two draft options for tomorrow's daily post — pick the one that matches the voice and lands the technical claim cleanly.",
    parentIssueIdentifier: "OCT-301",
    parentIssueUrl: "https://paperclip.example/octosync/issues/OCT-301",
    iconUrl: iconDataUrl,
    anyButtons: true,
    cards: [
        {
            id: "option1",
            title: "Renewables procurement pulse — option A",
            body: "Energy procurement teams: PPA pricing finally cracked $40/MWh in 3 ERCOT zones last week — and that's not the headline.\n\nWhat changed: capacity-firmed solar+storage is now competitive with combined-cycle baseload on day-ahead pricing. Two implications:\n\n1. Renewables go from carbon-strategy line-item to bottom-line procurement decision\n2. The 'green premium' framing is officially obsolete.\n\nIf you're in ops or procurement at an industrial buyer, time to revisit how renewables show up in your sourcing model.",
            details: [
                { label: "Target buyer", value: "Procurement & Ops Manager" }
            ],
            rationale: "Best mix of technical authority and clear business hook.",
            sources: [
                {
                    label: "DOE PPA Market Report Q4 2026",
                    url: "https://example.com/doe-q4-2026"
                },
                {
                    label: "ERCOT day-ahead snapshot",
                    url: "https://example.com/ercot"
                }
            ],
            approvalId: "ap_option1",
            approveLabel: "Approve option1",
            rejectLabel: "Reject option1",
            approveUrl: "https://approvals.example.com/confirm?token=preview-approve-1",
            rejectUrl: "https://approvals.example.com/confirm?token=preview-reject-1"
        },
        {
            id: "option2",
            title: "Renewables procurement pulse — option B",
            body: "A more technical variant emphasizing capacity-firming over price. Same underlying signal, different framing — leads with the engineering story.",
            details: [],
            rationale: null,
            sources: [],
            approvalId: "ap_option2",
            approveLabel: "Approve option2",
            rejectLabel: "Reject option2",
            approveUrl: "https://approvals.example.com/confirm?token=preview-approve-2",
            rejectUrl: "https://approvals.example.com/confirm?token=preview-reject-2"
        }
    ]
};

const LinkedInDraftReview = () => <ApprovalEmail payload={sample} />;

LinkedInDraftReview.PreviewProps = {};

export default LinkedInDraftReview;
