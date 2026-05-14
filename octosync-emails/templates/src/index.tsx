import { render } from "@react-email/render";

import { ApprovalEmail } from "./ApprovalEmail";
import type { ApprovalEmailPayload } from "./types";

export async function renderApprovalEmailHtml(
    payload: ApprovalEmailPayload
): Promise<string> {
    return render(<ApprovalEmail payload={payload} />);
}

export type { ApprovalEmailPayload, Card, Detail, Source } from "./types";
