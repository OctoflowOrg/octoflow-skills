import { Button, Heading, Hr, Link, Section, Text } from "@react-email/components";

import { colors } from "./theme";
import type { Card } from "./types";

type ApprovalCardProps = {
    card: Card;
};

const formatChipLabel = (id: string): string =>
    id
        .replace(/-/g, " ")
        .replace(/([a-zA-Z])(\d)/g, "$1 $2")
        .replace(/(\d)([a-zA-Z])/g, "$1 $2");

export const ApprovalCard = ({ card }: ApprovalCardProps) => {
    const hasButtons = Boolean(card.approveUrl && card.rejectUrl);
    const chipLabel = formatChipLabel(card.id);

    return (
        <Section
            style={{
                backgroundColor: colors.white,
                border: `1px solid ${colors.cardBorder}`,
                borderRadius: "10px",
                margin: "0 0 14px",
                padding: "20px"
            }}
        >
            <Text
                style={{
                    backgroundColor: colors.brandOrange,
                    borderRadius: "4px",
                    color: colors.white,
                    display: "inline-block",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    margin: "0 0 10px",
                    padding: "4px 9px",
                    textTransform: "uppercase"
                }}
            >
                {chipLabel}
            </Text>
            <Heading
                as="h3"
                style={{
                    color: colors.textBody,
                    fontSize: "18px",
                    fontWeight: 600,
                    lineHeight: 1.3,
                    margin: "0 0 10px"
                }}
            >
                {card.title}
            </Heading>

            {card.body
                ? card.body
                      .split(/\n{2,}/)
                      .map((paragraph, index) => (
                          <Text
                              key={`body-${index}`}
                              style={{
                                  color: colors.textBody,
                                  fontSize: "15px",
                                  lineHeight: 1.65,
                                  margin: "0 0 12px"
                              }}
                          >
                              {paragraph}
                          </Text>
                      ))
                : null}

            {card.details.length > 0 ? (
                <Section
                    style={{
                        color: colors.textBody,
                        fontSize: "14px",
                        lineHeight: 1.7,
                        margin: "0 0 12px"
                    }}
                >
                    {card.details.map((detail) => (
                        <Text
                            key={detail.label}
                            style={{
                                color: colors.textBody,
                                fontSize: "14px",
                                lineHeight: 1.7,
                                margin: 0
                            }}
                        >
                            <strong style={{ color: colors.brandTealDark }}>
                                {detail.label}:
                            </strong>{" "}
                            {detail.value}
                        </Text>
                    ))}
                </Section>
            ) : null}

            {card.rationale ? (
                <Text
                    style={{
                        color: colors.textBody,
                        fontSize: "14px",
                        margin: "0 0 12px"
                    }}
                >
                    <strong style={{ color: colors.brandTealDark }}>Rationale:</strong>{" "}
                    {card.rationale}
                </Text>
            ) : null}

            {card.sources.length > 0 ? (
                <Section style={{ color: colors.textMuted, fontSize: "13px" }}>
                    <Text
                        style={{
                            color: colors.brandTealDark,
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            margin: 0,
                            textTransform: "uppercase"
                        }}
                    >
                        Sources
                    </Text>
                    {card.sources.map((source) => (
                        <Text
                            key={source.url}
                            style={{
                                color: colors.textMuted,
                                fontSize: "13px",
                                lineHeight: 1.6,
                                margin: "4px 0 0",
                                paddingLeft: "18px"
                            }}
                        >
                            <Link
                                href={source.url}
                                style={{
                                    color: colors.brandTealDark,
                                    textDecoration: "none"
                                }}
                            >
                                {source.label}
                            </Link>
                        </Text>
                    ))}
                </Section>
            ) : null}

            {hasButtons ? (
                <>
                    <Hr
                        style={{
                            borderColor: colors.cardBorder,
                            borderTopWidth: "1px",
                            margin: "16px 0 14px"
                        }}
                    />
                    <Section>
                        <Button
                            href={card.approveUrl ?? "#"}
                            style={{
                                backgroundColor: colors.approveBg,
                                borderRadius: "6px",
                                color: colors.white,
                                display: "inline-block",
                                fontSize: "14px",
                                fontWeight: 600,
                                marginRight: "8px",
                                padding: "9px 16px",
                                textDecoration: "none"
                            }}
                        >
                            {card.approveLabel}
                        </Button>
                        <Button
                            href={card.rejectUrl ?? "#"}
                            style={{
                                backgroundColor: colors.rejectBg,
                                borderRadius: "6px",
                                color: colors.white,
                                display: "inline-block",
                                fontSize: "14px",
                                fontWeight: 600,
                                padding: "9px 16px",
                                textDecoration: "none"
                            }}
                        >
                            {card.rejectLabel}
                        </Button>
                    </Section>
                </>
            ) : null}
        </Section>
    );
};
