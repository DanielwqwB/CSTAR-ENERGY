export async function fetchGzip(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Map data could not be loaded (HTTP ${response.status}).`);
  const compressed = await response.arrayBuffer();
  const header = new Uint8Array(compressed, 0, Math.min(2, compressed.byteLength));
  // Browsers may decode gzip assets from Content-Encoding before returning them.
  if (header[0] !== 0x1f || header[1] !== 0x8b) return compressed;
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot decompress the monthly map data.");
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
