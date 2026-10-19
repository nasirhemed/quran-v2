/**
 * The pieces of a SentencePiece model (model A's tokenizer.model), read straight from its protobuf: ModelProto
 * field 1 is the repeated SentencePiece message, whose field 1 is the piece text and field 3 its type. Only the
 * id → piece table is needed, since the model's output is decoded greedily, never re-encoded.
 */
export interface Piece {
  piece: string;
  /** 1 normal, 2 unknown, 3 control, 4 user defined, 6 byte, 5 unused */
  type: number;
}

function varint(b: Uint8Array, p: { i: number }): number {
  let v = 0;
  let mul = 1;
  for (;;) {
    const byte = b[p.i++];
    v += (byte & 0x7f) * mul;
    if (byte < 0x80) return v;
    mul *= 128;
  }
}

function skip(b: Uint8Array, p: { i: number }, wire: number) {
  if (wire === 0) varint(b, p);
  else if (wire === 1) p.i += 8;
  else if (wire === 2) {
    const n = varint(b, p);
    p.i += n;
  }
  else if (wire === 5) p.i += 4;
  else throw new Error(`tokenizer: unsupported wire type ${wire}`);
}

export function readPieces(bytes: Uint8Array): Piece[] {
  const text = new TextDecoder();
  const pieces: Piece[] = [];
  const p = { i: 0 };
  while (p.i < bytes.length) {
    const tag = varint(bytes, p);
    if (tag >>> 3 !== 1 || (tag & 7) !== 2) {
      skip(bytes, p, tag & 7);
      continue;
    }
    const len = varint(bytes, p);
    const end = p.i + len;
    const piece: Piece = { piece: "", type: 1 };
    while (p.i < end) {
      const t = varint(bytes, p);
      if (t >>> 3 === 1 && (t & 7) === 2) {
        const n = varint(bytes, p);
        piece.piece = text.decode(bytes.subarray(p.i, p.i + n));
        p.i += n;
      } else if (t >>> 3 === 3 && (t & 7) === 0) piece.type = varint(bytes, p);
      else skip(bytes, p, t & 7);
    }
    pieces.push(piece);
  }
  return pieces;
}

/**
 * The model's output symbols as display text, by unit id: a word-start piece's "▁" becomes a space, control and
 * unknown pieces are empty, and the blank (one past the last piece) is empty too.
 */
export function bpeSymbols(bytes: Uint8Array, blank: number): string[] {
  const symbols = readPieces(bytes).map((p) => (p.type === 1 || p.type === 4 ? p.piece.replace(/▁/g, " ") : ""));
  while (symbols.length <= blank) symbols.push("");
  return symbols;
}
