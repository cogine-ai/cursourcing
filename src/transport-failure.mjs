// Some Cursor versions return a standalone transport diagnostic with end_turn.
// Inspect only a complete, short reply: clipped text could hide preceding prose.
export const DIAGNOSTIC_LIMIT = 8192;

export function transportFailure({ text, total_chars = text.length, truncated = false }) {
  if (truncated || total_chars > DIAGNOSTIC_LIMIT || text.length !== total_chars) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const [first, ...rest] = lines;
  if (!first || rest.some((line) => !/^\s+at\s+\S/.test(line))) return null;
  const retriable = /^Error: RetriableError: (?!\[internal\]).+$/;
  const connection = /^Error: ConnectError: \[(unavailable|aborted|deadline_exceeded)\].*$/;
  const server = 'Something went wrong communicating with the server. Please try again.';
  return retriable.test(first) || connection.test(first) || first === server ? first : null;
}
