import {
    Body,
    Column,
    Container,
    Head,
    Hr,
    Html,
    Img,
    Preview,
    Row,
    Section,
    Text
} from "@react-email/components";
import type { ReactNode } from "react";

import { colors, fontStack } from "./theme";

type BrandShellProps = {
    eyebrowLabel: string;
    preview: string;
    iconUrl: string | null;
    footerNote: string;
    generatedAt: string;
    children: ReactNode;
};

export const BrandShell = ({
    eyebrowLabel,
    preview,
    iconUrl,
    footerNote,
    generatedAt,
    children
}: BrandShellProps) => {
    return (
        <Html lang="en">
            <Head />
            <Preview>{preview}</Preview>
            <Body
                style={{
                    backgroundColor: colors.pageBg,
                    color: colors.textBody,
                    fontFamily: fontStack,
                    margin: 0,
                    padding: 0
                }}
            >
                <Container
                    style={{
                        margin: "0 auto",
                        maxWidth: "640px",
                        padding: "24px 16px 32px"
                    }}
                >
                    <Section
                        style={{
                            backgroundColor: colors.brandTeal,
                            borderRadius: "8px 8px 0 0",
                            padding: "14px 20px"
                        }}
                    >
                        <Row>
                            <Column style={{ verticalAlign: "middle", width: "48px" }}>
                                {iconUrl ? (
                                    <Img
                                        alt="OctoSync"
                                        height={32}
                                        src={iconUrl}
                                        style={{ display: "block", height: "auto", width: "40px" }}
                                        width={40}
                                    />
                                ) : null}
                            </Column>
                            <Column style={{ paddingLeft: "12px", verticalAlign: "middle" }}>
                                <Text
                                    style={{
                                        color: colors.white,
                                        fontSize: "15px",
                                        fontWeight: 700,
                                        letterSpacing: "0.04em",
                                        lineHeight: 1.1,
                                        margin: 0
                                    }}
                                >
                                    OCTOSYNC
                                </Text>
                                <Text
                                    style={{
                                        color: colors.brandCream,
                                        fontSize: "10px",
                                        fontWeight: 600,
                                        letterSpacing: "0.14em",
                                        lineHeight: 1.1,
                                        margin: "2px 0 0",
                                        textTransform: "uppercase"
                                    }}
                                >
                                    {eyebrowLabel}
                                </Text>
                            </Column>
                        </Row>
                    </Section>

                    {children}

                    <Hr
                        style={{
                            borderColor: colors.cardBorder,
                            borderTopWidth: "1px",
                            margin: "24px 0 14px"
                        }}
                    />
                    <Text
                        style={{
                            color: colors.textMuted,
                            fontSize: "12px",
                            lineHeight: 1.5,
                            margin: 0
                        }}
                    >
                        {footerNote ? (
                            <>
                                {footerNote}
                                <br />
                            </>
                        ) : null}
                        Generated {generatedAt} by the OctoSync workflow.
                    </Text>
                </Container>
            </Body>
        </Html>
    );
};
