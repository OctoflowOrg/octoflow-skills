import { ApprovalEmail } from "../src/ApprovalEmail";
import type { ApprovalEmailPayload } from "../src/types";
import { iconDataUrl } from "./icon";

const sample: ApprovalEmailPayload = {
    eyebrowLabel: "Weekly Opportunity Digest",
    companyName: "OctoSync",
    generatedAt: "2026-05-14",
    summary:
        "Three opportunities surfaced this week. Approve the ones to pursue; rejected items roll off the active queue.",
    parentIssueIdentifier: "OCT-310",
    parentIssueUrl: "https://paperclip.example/octosync/issues/OCT-310",
    iconUrl: iconDataUrl,
    anyButtons: true,
    cards: [
        {
            id: "1-acme-corp",
            title: "Acme Corp — annual renewables RFP",
            body: "Mid-market specialty chemicals player publicly committed to 50% renewables by 2028. RFP window opens Q3.",
            details: [
                { label: "Industry", value: "Specialty chemicals" },
                { label: "Confidence", value: "High" }
            ],
            rationale: "Public commitment + active sourcing motion + size fit.",
            sources: [
                {
                    label: "Acme sustainability report",
                    url: "https://example.com/acme-sr"
                }
            ],
            approvalId: "ap_acme",
            approveLabel: "Pursue",
            rejectLabel: "Skip",
            approveUrl: "https://approvals.example.com/confirm?token=preview-acme-approve",
            rejectUrl: "https://approvals.example.com/confirm?token=preview-acme-reject"
        },
        {
            id: "2-northwind-mfg",
            title: "Northwind Manufacturing — energy transition advisory",
            body: "Tier-2 automotive supplier, mid-Atlantic, just hired a sustainability VP.",
            details: [{ label: "Confidence", value: "Medium" }],
            rationale: null,
            sources: [],
            approvalId: "ap_northwind",
            approveLabel: "Pursue",
            rejectLabel: "Skip",
            approveUrl: "https://approvals.example.com/confirm?token=preview-nw-approve",
            rejectUrl: "https://approvals.example.com/confirm?token=preview-nw-reject"
        }
    ]
};

const OpportunityDigest = () => <ApprovalEmail payload={sample} />;

OpportunityDigest.PreviewProps = {};

export default OpportunityDigest;
