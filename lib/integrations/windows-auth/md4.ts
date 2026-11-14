/**
 * MD4 (RFC 1320) in plain TypeScript. NTLM's NT hash is MD4 of the UTF-16LE
 * password, and Node 17+ (OpenSSL 3) no longer ships MD4 in its default
 * provider, so `createHash('md4')` throws. Used only to derive the NT hash;
 * MD4 is not used as a general-purpose digest anywhere.
 */

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
const F = (x: number, y: number, z: number) => (x & y) | (~x & z)
const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z)
const H = (x: number, y: number, z: number) => x ^ y ^ z

const R1 = [3, 7, 11, 19]
const R2 = [3, 5, 9, 13]
const R3 = [3, 9, 11, 15]
const ORDER3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]

export function md4(input: Uint8Array): Buffer {
  const bitLength = BigInt(input.length) * BigInt(8)
  // Message + 0x80 + zero padding to 56 mod 64 + 64-bit little-endian length.
  const padLength = (55 - (input.length % 64) + 64) % 64
  const message = Buffer.alloc(input.length + 1 + padLength + 8)
  message.set(input, 0)
  message[input.length] = 0x80
  message.writeBigUInt64LE(BigInt.asUintN(64, bitLength), message.length - 8)

  let a = 0x67452301
  let b = 0xefcdab89 | 0
  let c = 0x98badcfe | 0
  let d = 0x10325476
  const X = new Array<number>(16)

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) X[i] = message.readInt32LE(offset + i * 4)
    const [aa, bb, cc, dd] = [a, b, c, d]

    for (let i = 0; i < 16; i++) {
      const t = (a + F(b, c, d) + X[i]) | 0
      a = d; d = c; c = b; b = rotl(t, R1[i % 4])
    }
    for (let i = 0; i < 16; i++) {
      const k = (i % 4) * 4 + Math.floor(i / 4)
      const t = (a + G(b, c, d) + X[k] + 0x5a827999) | 0
      a = d; d = c; c = b; b = rotl(t, R2[i % 4])
    }
    for (let i = 0; i < 16; i++) {
      const t = (a + H(b, c, d) + X[ORDER3[i]] + 0x6ed9eba1) | 0
      a = d; d = c; c = b; b = rotl(t, R3[i % 4])
    }

    a = (a + aa) | 0
    b = (b + bb) | 0
    c = (c + cc) | 0
    d = (d + dd) | 0
  }

  const out = Buffer.alloc(16)
  out.writeInt32LE(a, 0)
  out.writeInt32LE(b, 4)
  out.writeInt32LE(c, 8)
  out.writeInt32LE(d, 12)
  return out
}
