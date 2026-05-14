import { Link, Section, Text } from "@react-email/components";

import { ApprovalCard } from "./ApprovalCard";
import { BrandShell } from "./BrandShell";
import { colors } from "./theme";
import type { ApprovalEmailPayload } from "./types";

type ApprovalEmailProps = {
    payload: ApprovalEmailPayload;
};

export const ApprovalEmail = ({ payload }: ApprovalEmailProps) => {
    const {
        eyebrowLabel,
        generatedAt,
        summary,
        cards,
        parentIssueIdentifier,
        parentIssueUrl,
        iconUrl,
        anyButtons
    } = payload;

    const footerNote = anyButtons
        ? "Action links expire in 7 days. After that, action via the Paperclip inbox."
        : "";

    return (
        <BrandShell
            eyebrowLabel={eyebrowLabel}
            footerNote={footerNote}
            generatedAt={generatedAt}
            iconUrl={iconUrl}
            preview={summary}
        >
            <Text
                style={{
                    color: colors.textBody,
                    fontSize: "15px",
                    lineHeight: 1.6,
                    margin: "20px 0 18px"
                }}
            >
                {summary}
            </Text>

            <Section>
                {cards.map((card) => (
                    <ApprovalCard card={card} key={card.id} />
                ))}
            </Section>

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
