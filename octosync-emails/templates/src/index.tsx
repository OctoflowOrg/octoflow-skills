import { render } from "@react-email/render";

import { ApprovalEmail } from "./ApprovalEmail";
import { ProspectingApprovalEmail } from "./ProspectingApprovalEmail";
import type {
    ApprovalEmailPayload,
    ProspectingApprovalPayload
} from "./types";

export async function renderApprovalEmailHtml(
    payload: ApprovalEmailPayload
): Promise<string> {
    return render(<ApprovalEmail payload={payload} />);
}

export async function renderProspectingApprovalEmailHtml(
    payload: ProspectingApprovalPayload
): Promise<string> {
    return render(<ProspectingApprovalEmail payload={payload} />);
}

export type {
    ApprovalEmailPayload,
    Card,
    Detail,
    Opportunity,
    Prospect,
    ProspectingApprovalPayload,
    Source
} from "./types";
