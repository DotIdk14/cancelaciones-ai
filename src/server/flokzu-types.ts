import type { FlokzuObservation } from "../lib/flokzu-administrative.js";
export interface FlokzuEvidenceReference {
  label: string;
  value: string;
  url?: string;
}

export interface FlokzuCaseData {
  externalCaseId: string;
  studentIdentifier: string;
  studentName: string;
  academic: {
    campus: string | null;
    university: string | null;
    countryReported: string | null;
    program: string | null;
    level: string | null;
    block: string | null;
    programKey: string | null;
    entryDate: string | null;
  };
  procedure: {
    policyReported: string | null;
    motive: string | null;
    description: string | null;
    requestDate: string | null;
    administrativeStartDate: string | null;
  };
  operations: {
    salesChannelReported?: string | null;
    currentTask: string | null;
    statusReported: string | null;
    finalizedReported: string | null;
    reviewerReported: string | null;
    supervisorReported: string | null;
    requesterReported: string | null;
    requesterArea: string | null;
  };
  fields?: Array<{ label: string; value: string }>;
  observations?: FlokzuObservation[];
  administrativeComments?: Array<{ label: string; value: string }>;
  comments?: string | null;
  originalTicketId?: string | null;
  evidenceReferences: FlokzuEvidenceReference[];
}
