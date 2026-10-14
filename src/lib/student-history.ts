export type RelationKind =
  | "SAME_TICKET"
  | "POSSIBLE_DUPLICATE"
  | "DIFFERENT_REQUESTS"
  | "UNVERIFIED";
export interface StudentHistoryItem {
  id: string;
  externalCaseId: string | null;
  createdAt: string;
  status: string;
  studentName: string | null;
  assignedTo: string | null;
  creatorId: string | null;
  assignedName?: string | null;
  creatorName?: string | null;
  isTest: boolean;
  flokzuData: unknown;
  evidenceCount: number;
  auditCount: number;
  latestResult: string | null;
  finalResolution: string | null;
  workflowState: string;
  normativeSection: string | null;
  versions: Array<{
    id: string;
    status: string;
    createdAt: string;
    result: string | null;
    retired: boolean;
  }>;
}
export interface StudentHistory {
  studentIdentifier: string | null;
  totalCases: number;
  totalAudits: number;
  totalEvidence: number;
  uniqueTickets: number;
  uniqueRequests: number;
  lastRequest: string | null;
  items: StudentHistoryItem[];
  nextOffset: number | null;
}
export function reportedFields(value: unknown): Record<string, string | null> {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const section = (key: string) =>
    data[key] && typeof data[key] === "object"
      ? (data[key] as Record<string, unknown>)
      : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const procedure = section("procedure");
  const operations = section("operations");
  return {
    requestDate: text(procedure.requestDate),
    policy: text(procedure.policyReported),
    motive: text(procedure.motive),
    description: text(procedure.description),
    originalTicket: text(data.originalTicketId),
    comments: text(data.comments),
    status: text(operations.statusReported),
  };
}
export function classifyRelation(
  a: {
    externalCaseId?: string | null;
    studentIdentifier?: string | null;
    flokzuData?: unknown;
  },
  b: {
    externalCaseId?: string | null;
    studentIdentifier?: string | null;
    flokzuData?: unknown;
  },
): RelationKind {
  const ticket = (v: string | null | undefined) =>
    v?.trim().toLowerCase() || null;
  if (
    ticket(a.externalCaseId) &&
    ticket(a.externalCaseId) === ticket(b.externalCaseId)
  )
    return "SAME_TICKET";
  const x = reportedFields(a.flokzuData),
    y = reportedFields(b.flokzuData);
  if (x.originalTicket && x.originalTicket === y.originalTicket)
    return "POSSIBLE_DUPLICATE";
  const mentions = (
    text: string | null | undefined,
    id: string | null | undefined,
  ) =>
    Boolean(
      text &&
        id &&
        /duplicad|misma solicitud|ticket original/i.test(text) &&
        text.toLowerCase().includes(id.toLowerCase()),
    );
  if (
    mentions(x.comments, b.externalCaseId) ||
    mentions(y.comments, a.externalCaseId)
  )
    return "POSSIBLE_DUPLICATE";
  if (a.externalCaseId && b.externalCaseId) return "DIFFERENT_REQUESTS";
  if (
    x.requestDate &&
    x.requestDate === y.requestDate &&
    x.policy &&
    x.policy === y.policy
  )
    return "POSSIBLE_DUPLICATE";
  return "UNVERIFIED";
}
