export type Source = {
    label: string;
    url: string;
};

export type Detail = {
    label: string;
    value: string;
};

export type Card = {
    id: string;
    title: string;
    body: string | null;
    details: Detail[];
    rationale: string | null;
    sources: Source[];
    approvalId: string | null;
    approveLabel: string;
    rejectLabel: string;
    approveUrl: string | null;
    rejectUrl: string | null;
};

export type ApprovalEmailPayload = {
    eyebrowLabel: string;
    companyName: string;
    generatedAt: string;
    summary: string;
    cards: Card[];
    parentIssueIdentifier: string | null;
    parentIssueUrl: string | null;
    iconUrl: string | null;
    anyButtons: boolean;
};
