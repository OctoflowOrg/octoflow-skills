import { Heading, Hr, Link, Section, Text } from "@react-email/components";

import { BrandShell } from "./BrandShell";
import { colors } from "./theme";
import type { Opportunity, Prospect, ProspectingApprovalPayload } from "./types";

type ProspectingApprovalEmailProps = {
    payload: ProspectingApprovalPayload;
};

const opportunityCardStyle: React.CSSProperties = {
    backgroundColor: colors.white,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: "10px",
    margin: "0 0 14px",
    padding: "20px"
};

const prospectRowStyle: React.CSSProperties = {
    backgroundColor: "#fafaf7",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: "8px",
    margin: "8px 0 0",
    padding: "12px 14px"
};

const ProspectRow = ({ prospect }: { prospect: Prospect }) => {
    const displayName = prospect.name
        ? `${prospect.name}, ${prospect.role}`
        : `(no individual found) ${prospect.role}`;

    return (
        <Section style={prospectRowStyle}>
            <table
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ borderCollapse: "collapse", width: "100%" }}
            >
                <tbody>
                    <tr>
                        <td
                            style={{
                                paddingRight: "12px",
                                verticalAlign: "top",
                                width: "22px"
                            }}
                        >
                            <input
                                name="approve"
                                style={{
                                    height: "18px",
                                    margin: "2px 0 0",
                                    width: "18px"
                                }}
                                type="checkbox"
                                value={prospect.approvalId}
                            />
                        </td>
                        <td style={{ verticalAlign: "top" }}>
                            <Text
                                style={{
                                    color: colors.textBody,
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    lineHeight: 1.4,
                                    margin: 0
                                }}
                            >
                                {displayName}
                            </Text>
                            <Text
                                style={{
                                    color: colors.textMuted,
                                    fontSize: "13px",
                                    lineHeight: 1.4,
                                    margin: "2px 0 0"
                                }}
                            >
                                {prospect.email}
                            </Text>
                            {prospect.isGenericInbox ? (
                                <Text
                                    style={{
                                        color: "#9b5a1a",
                                        fontSize: "12px",
                                        lineHeight: 1.4,
                                        margin: "4px 0 0"
                                    }}
                                >
                                    ⚠ Generic inbox — lower response rate.
                                </Text>
                            ) : null}
                        </td>
                    </tr>
                </tbody>
            </table>
        </Section>
    );
};

const OpportunitySection = ({ opportunity }: { opportunity: Opportunity }) => {
    const meta = [opportunity.industry, opportunity.location]
        .filter(Boolean)
        .join(" · ");

    const workflowConfidence = [
        opportunity.workflow ? `Workflow: ${opportunity.workflow}` : null,
        opportunity.confidence ? `Confidence: ${opportunity.confidence}` : null
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <Section style={opportunityCardStyle}>
            <Heading
                as="h3"
                style={{
                    color: colors.textBody,
                    fontSize: "18px",
                    fontWeight: 600,
                    lineHeight: 1.3,
                    margin: "0 0 4px"
                }}
            >
                {opportunity.companyName}
            </Heading>
            {meta ? (
                <Text
                    style={{
                        color: colors.textMuted,
                        fontSize: "13px",
                        lineHeight: 1.4,
                        margin: "0 0 12px"
                    }}
                >
                    {meta}
                </Text>
            ) : null}

            <Text
                style={{
                    color: colors.textBody,
                    fontSize: "14px",
                    lineHeight: 1.6,
                    margin: "0 0 8px"
                }}
            >
                <strong style={{ color: colors.brandTealDark }}>Why now:</strong>{" "}
                {opportunity.whyNow}
            </Text>

            {workflowConfidence ? (
                <Text
                    style={{
                        color: colors.textMuted,
                        fontSize: "13px",
                        lineHeight: 1.5,
                        margin: "0 0 12px"
                    }}
                >
                    {workflowConfidence}
                </Text>
            ) : null}

            {opportunity.sources.length > 0 ? (
                <Text
                    style={{
                        color: colors.textMuted,
                        fontSize: "13px",
                        lineHeight: 1.5,
                        margin: "0 0 8px"
                    }}
                >
                    <strong
                        style={{
                            color: colors.brandTealDark,
                            fontSize: "11px",
                            letterSpacing: "0.06em",
                            textTransform: "uppercase"
                        }}
                    >
                        Sources
                    </strong>
                    {": "}
                    {opportunity.sources.map((source, index) => (
                        <span key={source.url}>
                            <Link
                                href={source.url}
                                style={{
                                    color: colors.brandTealDark,
                                    textDecoration: "none"
                                }}
                            >
                                {source.label}
                            </Link>
                            {index < opportunity.sources.length - 1 ? " · " : ""}
                        </span>
                    ))}
                </Text>
            ) : null}

            <Hr
                style={{
                    borderColor: colors.cardBorder,
                    borderTopWidth: "1px",
                    margin: "12px 0 4px"
                }}
            />

            <Text
                style={{
                    color: colors.brandTealDark,
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    margin: "8px 0 0",
                    textTransform: "uppercase"
                }}
            >
                Prospects ({opportunity.prospects.length})
            </Text>

            {opportunity.prospects.map((prospect) => (
                <ProspectRow key={prospect.approvalId} prospect={prospect} />
            ))}
        </Section>
    );
};

export const ProspectingApprovalEmail = ({
    payload
}: ProspectingApprovalEmailProps) => {
    const {
        generatedAt,
        opportunities,
        parentIssueIdentifier,
        parentIssueUrl,
        iconUrl,
        token,
        actionUrl,
        totalProspects
    } = payload;

    const previewText = `${opportunities.length} ${opportunities.length === 1 ? "opportunity" : "opportunities"} · ${totalProspects} ${totalProspects === 1 ? "prospect" : "prospects"} ready for outreach`;

    return (
        <BrandShell
            eyebrowLabel="Weekly Prospecting Approval"
            footerNote="Selections recorded when you submit. Unchecked prospects are skipped this week. Links expire in 7 days; after that, action via the Paperclip inbox."
            generatedAt={generatedAt}
            iconUrl={iconUrl}
            preview={previewText}
        >
            <Text
                style={{
                    color: colors.textBody,
                    fontSize: "15px",
                    lineHeight: 1.6,
                    margin: "20px 0 6px"
                }}
            >
                <strong style={{ color: colors.brandTealDark }}>
                    Weekly Prospecting Approval
                </strong>
                {` — ${generatedAt}`}
            </Text>
            <Text
                style={{
                    color: colors.textMuted,
                    fontSize: "14px",
                    lineHeight: 1.5,
                    margin: "0 0 18px"
                }}
            >
                {previewText}. Check the prospects you want the team to draft cold
                outreach for; submit once at the bottom. Anything left unchecked is
                explicitly skipped.
            </Text>

            <form action={actionUrl} method="POST">
                <input name="token" type="hidden" value={token} />

                {opportunities.map((opportunity) => (
                    <OpportunitySection
                        key={opportunity.id}
                        opportunity={opportunity}
                    />
                ))}

                <Section style={{ margin: "18px 0 0", textAlign: "center" }}>
                    <button
                        style={{
                            backgroundColor: colors.approveBg,
                            border: "0",
                            borderRadius: "8px",
                            color: colors.white,
                            cursor: "pointer",
                            fontSize: "15px",
                            fontWeight: 600,
                            padding: "12px 24px"
                        }}
                        type="submit"
                    >
                        Submit approved prospects
                    </button>
                </Section>
            </form>

            {parentIssueIdentifier || parentIssueUrl ? (
                <Text
                    style={{
                        color: colors.textMuted,
                        fontSize: "13px",
                        margin: "18px 0 0"
                    }}
                >
                    Review thread:{" "}
                    {parentIssueUrl ? (
                        <Link
                            href={parentIssueUrl}
                            style={{
                                color: colors.brandTealDark,
                                fontWeight: 600,
                                textDecoration: "none"
                            }}
                        >
                            {parentIssueIdentifier ?? "Open in Paperclip"}
                        </Link>
                    ) : (
                        parentIssueIdentifier
                    )}
                </Text>
            ) : null}
        </BrandShell>
    );
};
