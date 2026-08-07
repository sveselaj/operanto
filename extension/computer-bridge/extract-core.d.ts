/** Type surface of the pure extraction core (see extract-core.js). */

export declare const EXTRACT_LIMITS: {
  name: number;
  role: number;
  elements: number;
  visibleText: number;
  title: number;
};

export declare function stripUrl(rawUrl: string): string;
export declare function truncate(value: unknown, max: number): string;
export declare function accessibleName(
  candidates: Array<string | null | undefined>,
): string;
export declare function toSemanticElement(descriptor: {
  tag?: string | null;
  typeAttr?: string | null;
  roleAttr?: string | null;
  nameCandidates?: Array<string | null | undefined>;
}): { role: string; name: string } | null;
export declare function boundElements(
  elements: Array<{ role: string; name: string } | null>,
): Array<{ role: string; name: string }>;
export declare function buildPayload(input: {
  url: string;
  title?: string;
  visibleText?: string;
  elements?: Array<{ role: string; name: string }>;
  captureId?: string;
}): {
  url: string;
  captureId?: string;
  title?: string;
  visibleText?: string;
  elements?: Array<{ role: string; name: string }>;
};
