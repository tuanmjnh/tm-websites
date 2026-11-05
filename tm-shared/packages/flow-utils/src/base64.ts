interface NodeBufferLike {
  from(value: string, encoding: string): { toString(encoding: string): string }
}

export const encodeBase64 = (value: string): string => {
  const nodeBuffer = (globalThis as { Buffer?: NodeBufferLike }).Buffer
  if (nodeBuffer) return nodeBuffer.from(value, 'utf8').toString('base64')

  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}