/** `String(v)` for input that may be anything (config, API payloads); objects stringify as `String()` does. */
export const asText = (v: unknown): string => String(v);
