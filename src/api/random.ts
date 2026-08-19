// Random value generators for header/value fields when producing messages.
// Used both to fill a field on demand and to expand {{...}} placeholders.

export type RandomKind =
  | "uuid"
  | "timestamp"
  | "iso"
  | "number"
  | "string";

export const RANDOM_KINDS: { kind: RandomKind; label: string }[] = [
  { kind: "uuid", label: "UUID" },
  { kind: "timestamp", label: "Timestamp (ms)" },
  { kind: "iso", label: "ISO datetime" },
  { kind: "number", label: "Random number" },
  { kind: "string", label: "Random string" },
];

export function randomValue(kind: RandomKind): string {
  switch (kind) {
    case "uuid":
      return crypto.randomUUID();
    case "timestamp":
      return String(Date.now());
    case "iso":
      return new Date().toISOString();
    case "number":
      return String(Math.floor(Math.random() * 1_000_000));
    case "string":
      return Math.random().toString(36).slice(2, 10);
    default:
      return "";
  }
}

// Expand {{uuid}}, {{timestamp}}, {{iso}}, {{number}}, {{string}} placeholders
// in a string, generating a fresh random value for each occurrence.
export function expandPlaceholders(input: string): string {
  return input.replace(/\{\{\s*(uuid|timestamp|iso|number|string)\s*\}\}/gi, (_m, k) =>
    randomValue(k.toLowerCase() as RandomKind)
  );
}
