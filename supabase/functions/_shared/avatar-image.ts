export function imageDimensions(type: string, bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'image/png' && bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (type === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (marker === 0xda || offset + 2 > bytes.length) break
      const segmentLength = view.getUint16(offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segmentLength < 7) break
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      }
      offset += segmentLength
    }
  }
  if (type === 'image/webp' && bytes.length >= 20
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const chunk = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      const data = offset + 8
      if (data + length > bytes.length) break
      if (chunk === 'VP8X' && length >= 10) {
        return {
          width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16),
          height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16),
        }
      }
      if (chunk === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
        return {
          width: 1 + (((bytes[data + 2] & 0x3f) << 8) | bytes[data + 1]),
          height: 1 + (((bytes[data + 4] & 0x0f) << 10) | (bytes[data + 3] << 2) | ((bytes[data + 2] & 0xc0) >> 6)),
        }
      }
      if (chunk === 'VP8 ' && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        return {
          width: view.getUint16(data + 6, true) & 0x3fff,
          height: view.getUint16(data + 8, true) & 0x3fff,
        }
      }
      offset = data + length + (length % 2)
    }
  }
  return null
}
