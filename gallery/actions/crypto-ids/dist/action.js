/*! UserTasks action ut_crypto 1.0.0 */

// packages/action/src/index.ts
function defineAction(definition) {
  if (!definition || typeof definition !== "object" || !definition.operations || typeof definition.operations !== "object") {
    throw new Error("defineAction({ operations: { id: fn } })");
  }
  return definition;
}

// gallery/actions/shared/inputs.ts
var isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isBlank = (value) => value === void 0 || value === null || typeof value === "string" && value.trim() === "";
var show = (value) => {
  let s;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const s = value.trim().replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/^\+/, "");
    if (s === "") return null;
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  if (value === void 0 || value === null) return null;
  return NaN;
}
function optNum(inputs, name, opts = {}) {
  const raw = inputs[name];
  let n = isBlank(raw) ? null : toNumber(raw);
  if (n === null) n = opts.default ?? null;
  if (n === null) return null;
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${show(raw)}")`);
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number (got ${n})`);
  if (opts.min !== void 0 && n < opts.min) throw new Error(`${name} must be at least ${opts.min} (got ${n})`);
  if (opts.max !== void 0 && n > opts.max) throw new Error(`${name} must be at most ${opts.max} (got ${n})`);
  return n;
}
function num(inputs, name, opts = {}) {
  const n = optNum(inputs, name, opts);
  if (n === null) throw new Error(`${name} is required`);
  return n;
}
function str(inputs, name, opts = {}) {
  const raw = inputs[name];
  let s;
  if (raw === void 0 || raw === null) s = opts.default ?? "";
  else if (typeof raw === "string") s = raw;
  else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  else s = JSON.stringify(raw);
  if (opts.trim !== false) s = s.trim();
  if (s === "" && opts.default !== void 0 && raw !== "") s = opts.default;
  if (opts.required && s === "") throw new Error(`${name} is required`);
  if (opts.max !== void 0 && s.length > opts.max) throw new Error(`${name} is longer than ${opts.max} characters`);
  return s;
}
function text(inputs, name, opts = {}) {
  return str(inputs, name, { ...opts, trim: false });
}
function bool(inputs, name, dflt) {
  const raw = inputs[name];
  if (isBlank(raw)) return dflt;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "1", "on", "y"].includes(s)) return true;
  if (["false", "no", "0", "off", "n"].includes(s)) return false;
  throw new Error(`${name} must be true or false (got "${show(raw)}")`);
}
function choice(inputs, name, options, dflt) {
  const raw = inputs[name];
  if (isBlank(raw)) return dflt;
  const s = String(raw).trim();
  const hit = options.find((o) => o === s) ?? options.find((o) => o.toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`${name} must be one of ${options.join(", ")} (got "${show(raw)}")`);
  return hit;
}
function obj(inputs, name, opts = {}) {
  const raw = inputs[name];
  if (isBlank(raw)) {
    if (opts.required) throw new Error(`${name} is required (an object)`);
    return {};
  }
  if (isPlainObject(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) return parsed;
    } catch {
    }
  }
  throw new Error(`${name} must be an object`);
}

// gallery/actions/crypto-ids/src/action.ts
var HASHES = ["SHA-256", "SHA-512", "SHA-384", "SHA-1"];
var ENCODINGS = ["hex", "base64", "base64url"];
var FORMATS = ["base64", "base64url", "hex", "url"];
var HMAC_KEY = "secret://hmac_key";
var TOKEN_SECRET = "secret://token_secret";
function randomBytes(ctx, n) {
  const out = [];
  while (out.length < n) {
    const take = Math.min(4096, n - out.length);
    const hex = ctx.crypto.randomBytes(take, "hex");
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}
var toBig = (bytes) => bytes.reduce((acc, b) => acc << 8n | BigInt(b), 0n);
function randomStrings(ctx, alphabet, length, count) {
  const n = alphabet.length;
  const limit = 256 - 256 % n;
  const out = [];
  let pool = [];
  for (let c = 0; c < count; c++) {
    const chars = [];
    while (chars.length < length) {
      if (pool.length === 0) pool = randomBytes(ctx, Math.min(4096, Math.ceil(length * (count - c) * 1.3) + 16));
      const b = pool.pop();
      if (b < limit) chars.push(alphabet[b % n]);
    }
    out.push(chars.join(""));
  }
  return out;
}
function uuidFromBig(v) {
  const hex = v.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
var RAND74_MAX = (1n << 74n) - 1n;
function uuidV7(ctx, count) {
  const out = [];
  let lastMs = -1;
  let rand = 0n;
  for (let i = 0; i < count; i++) {
    let ms = Date.now();
    if (ms <= lastMs) {
      ms = lastMs;
      rand += 1n;
      if (rand > RAND74_MAX) {
        ms = lastMs + 1;
        rand = toBig(randomBytes(ctx, 10)) & RAND74_MAX >> 1n;
      }
    } else {
      rand = toBig(randomBytes(ctx, 10)) & RAND74_MAX >> 1n;
    }
    lastMs = ms;
    const randA = rand >> 62n;
    const randB = rand & (1n << 62n) - 1n;
    const v = BigInt(ms) << 80n | 7n << 76n | randA << 64n | 2n << 62n | randB;
    out.push(uuidFromBig(v));
  }
  return out;
}
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var RAND80_MAX = (1n << 80n) - 1n;
function crockford(v, chars) {
  let s = "";
  for (let i = 0; i < chars; i++) {
    s = CROCKFORD[Number(v & 31n)] + s;
    v >>= 5n;
  }
  return s;
}
function ulids(ctx, count) {
  const out = [];
  let lastMs = -1;
  let rand = 0n;
  for (let i = 0; i < count; i++) {
    let ms = Date.now();
    if (ms <= lastMs) {
      ms = lastMs;
      rand += 1n;
      if (rand > RAND80_MAX) {
        ms = lastMs + 1;
        rand = toBig(randomBytes(ctx, 10)) >> 1n;
      }
    } else {
      rand = toBig(randomBytes(ctx, 10)) >> 1n;
    }
    lastMs = ms;
    out.push(crockford(BigInt(ms), 10) + crockford(rand, 16));
  }
  return out;
}
var b64url = (ctx, s) => ctx.crypto.encode(s, "utf8", "base64url");
function fromB64url(ctx, s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  return ctx.crypto.encode(s, "base64url", "utf8");
}
function checkEncoded(format, s) {
  const compact = format === "url" ? s : s.replace(/\s+/g, "");
  const ok = format === "base64" ? /^[A-Za-z0-9+/]*={0,2}$/.test(compact) && compact.replace(/=+$/, "").length % 4 !== 1 : format === "base64url" ? /^[A-Za-z0-9_-]*={0,2}$/.test(compact) && compact.replace(/=+$/, "").length % 4 !== 1 : format === "hex" ? /^(?:[0-9a-fA-F]{2})*$/.test(compact) : true;
  if (!ok) throw new Error(`text is not valid ${format}`);
  return compact;
}
async function hmacWith(ctx, alg, ref, data, encoding) {
  try {
    return await ctx.crypto.hmac(alg, ref, data, encoding);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = ref.replace("secret://", "");
    throw new Error(/secret/i.test(message) ? `${ctx.operation} needs the secret "${name}": ${message}` : message);
  }
}
var nowSeconds = () => Math.floor(Date.now() / 1e3);
var isoOfSeconds = (s) => typeof s === "number" && Number.isFinite(s) ? new Date(s * 1e3).toISOString() : null;
var action_default = defineAction({
  operations: {
    uuid(inputs, ctx) {
      const version = choice(inputs, "version", ["v4", "v7"], "v4");
      const count = num(inputs, "count", { integer: true, min: 1, max: 1e3, default: 1 });
      const uppercase = bool(inputs, "uppercase", false);
      let uuids = version === "v7" ? uuidV7(ctx, count) : Array.from({ length: count }, () => ctx.crypto.randomUUID());
      if (uppercase) uuids = uuids.map((u) => u.toUpperCase());
      return { uuid: uuids[0], uuids };
    },
    ulid(inputs, ctx) {
      const count = num(inputs, "count", { integer: true, min: 1, max: 1e3, default: 1 });
      const list = ulids(ctx, count);
      return { ulid: list[0], ulids: list };
    },
    hash(inputs, ctx) {
      const value = text(inputs, "text", { max: 5e6 });
      const algorithm = choice(inputs, "algorithm", HASHES, "SHA-256");
      const encoding = choice(inputs, "encoding", ENCODINGS, "hex");
      return { hash: ctx.crypto.digest(algorithm, value, encoding), algorithm };
    },
    async hmac(inputs, ctx) {
      const message = text(inputs, "message", { max: 5e6 });
      const algorithm = choice(inputs, "algorithm", HASHES, "SHA-256");
      const encoding = choice(inputs, "encoding", ENCODINGS, "hex");
      const signature = await hmacWith(ctx, algorithm, HMAC_KEY, message, encoding);
      let expected = str(inputs, "expected");
      let matches = null;
      if (expected) {
        expected = expected.replace(/^(?:sha(?:1|256|384|512)|v\d)=/i, "");
        if (encoding === "hex") expected = expected.toLowerCase();
        matches = ctx.crypto.timingSafeEqual(signature, expected);
      }
      return { signature, matches };
    },
    encode(inputs, ctx) {
      const value = text(inputs, "text", { max: 5e6 });
      const format = choice(inputs, "format", FORMATS, "base64");
      return { result: format === "url" ? encodeURIComponent(value) : ctx.crypto.encode(value, "utf8", format) };
    },
    decode(inputs, ctx) {
      const value = text(inputs, "text", { max: 5e6 });
      const format = choice(inputs, "format", FORMATS, "base64");
      const compact = checkEncoded(format, value);
      if (format === "url") {
        try {
          return { result: decodeURIComponent(compact.replace(/\+/g, bool(inputs, "plus_as_space", false) ? " " : "+")) };
        } catch {
          throw new Error("text has a broken %-escape (URL decoding failed)");
        }
      }
      return { result: ctx.crypto.encode(compact, format, "utf8") };
    },
    random_code(inputs, ctx) {
      const length = num(inputs, "length", { integer: true, min: 1, max: 256, default: 8 });
      const count = num(inputs, "count", { integer: true, min: 1, max: 1e3, default: 1 });
      const preset = choice(inputs, "alphabet", ["no_lookalikes", "digits", "alphanumeric", "alphanumeric_upper", "letters_upper", "hex", "custom"], "no_lookalikes");
      const presets = {
        digits: "0123456789",
        alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        alphanumeric_upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        letters_upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        hex: "0123456789abcdef",
        // No 0/O, 1/I/L: safe to read aloud or type from paper.
        no_lookalikes: "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
      };
      const alphabet = Array.from(new Set(Array.from(preset === "custom" ? str(inputs, "custom_alphabet", { trim: false }) : presets[preset])));
      if (alphabet.length < 2) throw new Error("custom_alphabet needs at least 2 different characters");
      if (alphabet.length > 256) throw new Error("custom_alphabet has more than 256 characters");
      const group = num(inputs, "group_size", { integer: true, min: 0, max: 64, default: 0 });
      const separator = str(inputs, "separator", { default: "-", trim: false });
      const codes = randomStrings(ctx, alphabet, length, count).map((code) => {
        if (!group) return code;
        const chars = Array.from(code);
        const parts = [];
        for (let i = 0; i < chars.length; i += group) parts.push(chars.slice(i, i + group).join(""));
        return parts.join(separator);
      });
      return { code: codes[0], codes };
    },
    otp(inputs, ctx) {
      const digits = num(inputs, "digits", { integer: true, min: 4, max: 10, default: 6 });
      const minutes = num(inputs, "expires_minutes", { integer: true, min: 1, max: 10080, default: 10 });
      const [code] = randomStrings(ctx, Array.from("0123456789"), digits, 1);
      return {
        code,
        expires_at: new Date(Date.now() + minutes * 6e4).toISOString(),
        code_hash: ctx.crypto.digest("SHA-256", code, "hex")
      };
    },
    async sign_token(inputs, ctx) {
      const claims = obj(inputs, "claims");
      const minutes = num(inputs, "expires_minutes", { integer: true, min: 0, max: 525600, default: 60 });
      const issuer = str(inputs, "issuer");
      const audience = str(inputs, "audience");
      const subject = str(inputs, "subject");
      const iat = nowSeconds();
      const payload = {
        ...claims,
        iat,
        ...minutes > 0 ? { exp: iat + minutes * 60 } : {},
        ...issuer ? { iss: issuer } : {},
        ...audience ? { aud: audience } : {},
        ...subject ? { sub: subject } : {},
        jti: typeof claims.jti === "string" && claims.jti ? claims.jti : ctx.crypto.randomUUID()
      };
      const signingInput = `${b64url(ctx, JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(ctx, JSON.stringify(payload))}`;
      const signature = await hmacWith(ctx, "SHA-256", TOKEN_SECRET, signingInput, "base64url");
      return { jwt: `${signingInput}.${signature}`, expires_at: isoOfSeconds(payload.exp), claims: payload };
    },
    async verify_token(inputs, ctx) {
      const token = str(inputs, "jwt", { required: true, max: 2e4 }).replace(/^Bearer\s+/i, "");
      const issuer = str(inputs, "issuer");
      const audience = str(inputs, "audience");
      const leeway = num(inputs, "leeway_seconds", { integer: true, min: 0, max: 3600, default: 30 });
      const result = (valid, reason, claims2) => ({
        valid,
        reason,
        claims: claims2,
        expires_at: claims2 ? isoOfSeconds(claims2.exp) : null
      });
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1]) return result(false, "malformed token (expected header.payload.signature)", null);
      let header;
      let claims;
      try {
        header = JSON.parse(fromB64url(ctx, parts[0]));
        claims = JSON.parse(fromB64url(ctx, parts[1]));
      } catch {
        return result(false, "malformed token (header or payload is not JSON)", null);
      }
      if (!header || typeof header !== "object" || !claims || typeof claims !== "object" || Array.isArray(claims)) return result(false, "malformed token", null);
      if (header.alg !== "HS256") return result(false, `unsupported algorithm "${String(header.alg).slice(0, 20)}" (only HS256)`, null);
      const expected = await hmacWith(ctx, "SHA-256", TOKEN_SECRET, `${parts[0]}.${parts[1]}`, "base64url");
      if (!ctx.crypto.timingSafeEqual(expected, parts[2])) return result(false, "bad signature", null);
      const now = nowSeconds();
      if (claims.exp !== void 0 && (typeof claims.exp !== "number" || now > claims.exp + leeway)) return result(false, "expired", claims);
      if (claims.nbf !== void 0 && (typeof claims.nbf !== "number" || now + leeway < claims.nbf)) return result(false, "not yet valid (nbf)", claims);
      if (issuer && claims.iss !== issuer) return result(false, "issuer does not match", claims);
      if (audience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!aud.includes(audience)) return result(false, "audience does not match", claims);
      }
      return result(true, "", claims);
    }
  }
});
export {
  action_default as default
};
