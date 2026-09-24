export async function blobToText(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? Buffer.from(data) : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
  return buffer.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}