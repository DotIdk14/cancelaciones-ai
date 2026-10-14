export interface ManualCaseMatch {
  candidates: Array<{ id: string; studentName: string | null; assignedTo: string | null; createdAt: string; status: string; updatedAt: string }>;
  linkCaseId: string | null;
  requiresSelection: boolean;
}
export interface ImportLinkResolution { externalCaseId: string; caseId: string | null }
