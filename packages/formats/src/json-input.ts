export type FormatErrorFactory = (
  code: string,
  details?: Readonly<Record<string, unknown>>,
) => Error;

export const PROJECT_V1_MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_STRING_BYTES = 1024 * 1024;
const MAX_EMBEDDED_ASSET_BASE64_BYTES = 22_369_624;
const MAX_OBJECT_FIELDS = 4096;
const MAX_ARRAY_ITEMS = 2_000_000;

interface PendingValue {
  readonly value: unknown;
  readonly depth: number;
  readonly pointer: string;
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

interface JsonObjectFrame {
  readonly kind: "object";
  readonly keys: Set<string>;
  readonly pointer: string;
  expectKey: boolean;
  currentKey?: string;
}

interface JsonArrayFrame {
  readonly kind: "array";
  readonly pointer: string;
  index: number;
}

type JsonFrame = JsonObjectFrame | JsonArrayFrame;

function utf8ByteLengthUntil(value: string, limit: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > limit) return bytes;
  }
  return bytes;
}

function childPointer(stack: readonly JsonFrame[]): string {
  const parent = stack.at(-1);
  if (parent === undefined) return "";
  if (parent.kind === "array") return `${parent.pointer}/${parent.index}`;
  return parent.currentKey === undefined
    ? parent.pointer
    : `${parent.pointer}/${pointerToken(parent.currentKey)}`;
}

/** JSON.parse 会静默覆盖同名键，因此在解析前单独拒绝重复键。 */
function assertNoDuplicateObjectKeys(
  text: string,
  makeError: FormatErrorFactory,
): void {
  const stack: JsonFrame[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') break;
        index += 1;
      }
      if (index >= text.length) return;
      const frame = stack.at(-1);
      if (frame?.kind === "object" && frame.expectKey) {
        let key: string;
        try {
          key = JSON.parse(text.slice(start, index + 1)) as string;
        } catch {
          return;
        }
        if (frame.keys.has(key)) {
          throw makeError("format-json-duplicate-key", {
            key,
            pointer: `${frame.pointer}/${pointerToken(key)}`,
          });
        }
        frame.keys.add(key);
        frame.expectKey = false;
        frame.currentKey = key;
      }
      index += 1;
      continue;
    }
    if (character === "{") {
      stack.push({
        kind: "object",
        keys: new Set(),
        pointer: childPointer(stack),
        expectKey: true,
      });
    } else if (character === "[") {
      stack.push({ kind: "array", pointer: childPointer(stack), index: 0 });
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === ",") {
      const frame = stack.at(-1);
      if (frame?.kind === "object") {
        frame.expectKey = true;
        delete frame.currentKey;
      } else if (frame?.kind === "array") {
        frame.index += 1;
      }
    }
    index += 1;
  }
}

/** 在 Schema 前执行不分配整图结构的 JSON 安全上限检查。 */
export function parseJsonWithSafetyLimits(
  text: string,
  makeError: FormatErrorFactory,
): unknown {
  const bytes = utf8ByteLengthUntil(text, PROJECT_V1_MAX_FILE_BYTES);
  if (bytes > PROJECT_V1_MAX_FILE_BYTES) {
    throw makeError("format-size-limit-exceeded", {
      actualBytes: bytes,
      maxBytes: PROJECT_V1_MAX_FILE_BYTES,
    });
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw makeError("format-bom-not-allowed");
  }

  assertNoDuplicateObjectKeys(text, makeError);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw makeError("format-json-invalid");
  }

  const pending: PendingValue[] = [{ value: raw, depth: 1, pointer: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > MAX_DEPTH) {
      throw makeError("format-depth-limit-exceeded", {
        pointer: current.pointer,
        maxDepth: MAX_DEPTH,
      });
    }
    if (typeof current.value === "string") {
      const embeddedAssetData =
        /^\/embeddedAssets\/\d+\/data$/u.test(current.pointer) ||
        /^\/objects\/embeddedAssets\/\d+\/data$/u.test(current.pointer);
      const maxBytes = embeddedAssetData
        ? MAX_EMBEDDED_ASSET_BASE64_BYTES
        : MAX_STRING_BYTES;
      const stringBytes = utf8ByteLengthUntil(current.value, maxBytes);
      if (stringBytes > maxBytes) {
        throw makeError("format-string-limit-exceeded", {
          pointer: current.pointer,
          actualBytes: stringBytes,
          maxBytes,
        });
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_ARRAY_ITEMS) {
        throw makeError("format-array-limit-exceeded", {
          pointer: current.pointer,
          actualItems: current.value.length,
          maxItems: MAX_ARRAY_ITEMS,
        });
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
          pointer: `${current.pointer}/${index}`,
        });
      }
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    const entries = Object.entries(current.value);
    if (entries.length > MAX_OBJECT_FIELDS) {
      throw makeError("format-object-field-limit-exceeded", {
        pointer: current.pointer,
        actualFields: entries.length,
        maxFields: MAX_OBJECT_FIELDS,
      });
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      pending.push({
        value: entry[1],
        depth: current.depth + 1,
        pointer: `${current.pointer}/${pointerToken(entry[0])}`,
      });
    }
  }
  return raw;
}
