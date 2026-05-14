import { ProspectingApprovalEmail } from "../src/ProspectingApprovalEmail";
import type { ProspectingApprovalPayload } from "../src/types";
import { iconDataUrl } from "./icon";

const sample: ProspectingApprovalPayload = {
    generatedAt: "2026-05-14",
    parentIssueIdentifier: "OCT-320",
    parentIssueUrl: "https://paperclip.example/octosync/issues/OCT-320",
    iconUrl: iconDataUrl,
    token: "preview-batch-token.preview-batch-sig",
    actionUrl: "https://approvals.example.com/email-approval/decide",
    totalProspects: 7,
    opportunities: [
        {
            id: "1-acme-corp",
            companyName: "Acme Corp",
            industry: "Specialty chemicals",
            location: "Texas",
            whyNow:
                "Public commitment to 50% renewables by 2028; RFP window opens Q3.",
            workflow: "Renewables procurement",
            confidence: "High",
            sources: [
                {
                    label: "Acme sustainability report",
                    url: "https://example.com/acme-sr"
                },
                {
                    label: "Acme Q1 earnings call",
                    url: "https://example.com/acme-q1"
                }
            ],
            prospects: [
                {
                    approvalId: "ap_acme_1",
                    name: "Sarah Chen",
                    role: "Director of Operations",
                    email: "sarah.chen@acme.example",
                    isGenericInbox: false
                },
                {
                    approvalId: "ap_acme_2",
                    name: "Mike Rivera",
                    role: "CFO",
                    email: "mike@acme.example",
                    isGenericInbox: false
                },
                {
                    approvalId: "ap_acme_3",
                    name: null,
                    role: "sourcing inbox",
                    email: "sourcing@acme.example",
                    isGenericInbox: true
                }
            ]
        },
        {
            id: "2-northwind-mfg",
            companyName: "Northwind Manufacturing",
            industry: "Tier-2 automotive supplier",
            location: "Pennsylvania",
            whyNow:
                "New sustainability VP, hired last month; public hiring signal that renewables/efficiency is a 2026 focus.",
            workflow: "Energy transition advisory",
            confidence: "Medium",
            sources: [
                {
                    label: "VP hire announcement",
                    url: "https://example.com/nw-vp"
                }
            ],
            prospects: [
                {
                    approvalId: "ap_nw_1",
                    name: "Priya Patel",
                    role: "VP Sustainability",
                    email: "priya.patel@northwind.example",
                    isGenericInbox: false
                },
                {
                    approvalId: "ap_nw_2",
                    name: "Tom Becker",
                    role: "Plant Operations Manager",
                    email: "tom.becker@northwind.example",
                    isGenericInbox: false
                }
            ]
        },
        {
            id: "3-bayview-foods",
            companyName: "Bayview Foods",
            industry: "Mid-market food processing",
            location: "California",
            whyNow:
                "Two retailers requiring scope-3 disclosure by 2027; bayview is in their supplier audit pool.",
            workflow: "Carbon accounting",
            confidence: "Medium",
            sources: [],
            prospects: [
                {
                    approvalId: "ap_bv_1",
                    name: null,
                    role: "sales inbox",
                    email: "sales@bayviewfoods.example",
                    isGenericInbox: true
                },
                {
                    approvalId: "ap_bv_2",
                    name: "Lisa Park",
                    role: "Procurement Lead",
                    email: "lisa.park@bayviewfoods.example",
                    isGenericInbox: false
                }
            ]
        }
    ]
};

const ProspectingApproval = () => <ProspectingApprovalEmail payload={sample} />;

ProspectingApproval.PreviewProps = {};

export default ProspectingApproval;
