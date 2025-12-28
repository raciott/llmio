export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ line: string; bytes: number }, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    const chunkText = decoder.decode(value, { stream: true });
    carry += chunkText;

    let idx = 0;
    while (true) {
      const nextIdx = carry.indexOf("\n", idx);
      if (nextIdx === -1) break;
      const rawLine = carry.slice(idx, nextIdx);
      idx = nextIdx + 1;
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      yield { line, bytes: encoder.encode(line).byteLength };
    }
    carry = carry.slice(idx);
  }

  if (carry.length > 0) {
    yield { line: carry, bytes: encoder.encode(carry).byteLength };
  }
}
