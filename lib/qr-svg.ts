const QR_MODE_8BIT_BYTE = 1 << 2;
const QR_ERROR_CORRECT_LEVEL_L = 1;
const PAD0 = 0xec;
const PAD1 = 0x11;

type RsBlock = {
  totalCount: number;
  dataCount: number;
};

class QrBitBuffer {
  private buffer: number[] = [];
  private length = 0;

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number) {
    for (let i = 0; i < length; i += 1) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }

    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> this.length % 8;
    }

    this.length += 1;
  }

  getLengthInBits() {
    return this.length;
  }

  getBuffer() {
    return this.buffer;
  }
}

class Qr8BitByte {
  mode = QR_MODE_8BIT_BYTE;
  private data: number[];

  constructor(value: string) {
    this.data = Array.from(new TextEncoder().encode(value));
  }

  getLength() {
    return this.data.length;
  }

  write(buffer: QrBitBuffer) {
    for (const byte of this.data) {
      buffer.put(byte, 8);
    }
  }
}

function getBchDigit(data: number): number {
  let digit = 0;
  while (data !== 0) {
    digit += 1;
    data >>>= 1;
  }
  return digit;
}

const EXP_TABLE = new Array<number>(256);
const LOG_TABLE = new Array<number>(256);

for (let i = 0; i < 8; i += 1) {
  EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i += 1) {
  EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i += 1) {
  LOG_TABLE[EXP_TABLE[i]] = i;
}

function gexp(n: number): number {
  let value = n;
  while (value < 0) {
    value += 255;
  }
  while (value >= 256) {
    value -= 255;
  }
  return EXP_TABLE[value];
}

function glog(n: number): number {
  if (n < 1) {
    throw new Error(`glog(${n})`);
  }
  return LOG_TABLE[n];
}

class QrPolynomial {
  private readonly num: number[];

  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset += 1;
    }

    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      this.num[i] = num[i + offset];
    }
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(other: QrPolynomial): QrPolynomial {
    const num = new Array(this.getLength() + other.getLength() - 1).fill(0);

    for (let i = 0; i < this.getLength(); i += 1) {
      for (let j = 0; j < other.getLength(); j += 1) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(other.get(j)));
      }
    }

    return new QrPolynomial(num, 0);
  }

  mod(other: QrPolynomial): QrPolynomial {
    if (this.getLength() - other.getLength() < 0) {
      return this;
    }

    const ratio = glog(this.get(0)) - glog(other.get(0));
    const num = this.num.slice();

    for (let i = 0; i < other.getLength(); i += 1) {
      num[i] ^= gexp(glog(other.get(i)) + ratio);
    }

    return new QrPolynomial(num, 0).mod(other);
  }
}

function getPatternPosition(typeNumber: number): number[] {
  const table = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ];

  return table[typeNumber - 1] ?? [];
}

function getMask(maskPattern: number, i: number, j: number): boolean {
  switch (maskPattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return i * j % 2 + i * j % 3 === 0;
    case 6:
      return (i * j % 2 + i * j % 3) % 2 === 0;
    case 7:
      return (i * j % 3 + (i + j) % 2) % 2 === 0;
    default:
      return false;
  }
}

function getBchTypeInfo(data: number): number {
  let d = data << 10;
  const g15 = 0b10100110111;
  const g15Mask = 0b101010000010010;

  while (getBchDigit(d) - getBchDigit(g15) >= 0) {
    d ^= g15 << (getBchDigit(d) - getBchDigit(g15));
  }

  return ((data << 10) | d) ^ g15Mask;
}

function getLengthInBits(type: number): number {
  if (type < 10) {
    return 8;
  }
  return 16;
}

function getErrorCorrectPolynomial(errorCorrectLength: number): QrPolynomial {
  let a = new QrPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i += 1) {
    a = a.multiply(new QrPolynomial([1, gexp(i)], 0));
  }
  return a;
}

function getLostPoint(modules: boolean[][]): number {
  const moduleCount = modules.length;
  let lostPoint = 0;

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      const dark = modules[row][col];
      let sameCount = 0;

      for (let r = -1; r <= 1; r += 1) {
        if (row + r < 0 || moduleCount <= row + r) {
          continue;
        }

        for (let c = -1; c <= 1; c += 1) {
          if (col + c < 0 || moduleCount <= col + c || (r === 0 && c === 0)) {
            continue;
          }
          if (dark === modules[row + r][col + c]) {
            sameCount += 1;
          }
        }
      }

      if (sameCount > 5) {
        lostPoint += 3 + sameCount - 5;
      }
    }
  }

  for (let row = 0; row < moduleCount - 1; row += 1) {
    for (let col = 0; col < moduleCount - 1; col += 1) {
      let count = 0;
      if (modules[row][col]) count += 1;
      if (modules[row + 1][col]) count += 1;
      if (modules[row][col + 1]) count += 1;
      if (modules[row + 1][col + 1]) count += 1;
      if (count === 0 || count === 4) {
        lostPoint += 3;
      }
    }
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount - 6; col += 1) {
      if (
        modules[row][col] &&
        !modules[row][col + 1] &&
        modules[row][col + 2] &&
        modules[row][col + 3] &&
        modules[row][col + 4] &&
        !modules[row][col + 5] &&
        modules[row][col + 6]
      ) {
        lostPoint += 40;
      }
    }
  }

  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount - 6; row += 1) {
      if (
        modules[row][col] &&
        !modules[row + 1][col] &&
        modules[row + 2][col] &&
        modules[row + 3][col] &&
        modules[row + 4][col] &&
        !modules[row + 5][col] &&
        modules[row + 6][col]
      ) {
        lostPoint += 40;
      }
    }
  }

  let darkCount = 0;
  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount; row += 1) {
      if (modules[row][col]) {
        darkCount += 1;
      }
    }
  }

  const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
  lostPoint += ratio * 10;

  return lostPoint;
}

function getRsBlocks(typeNumber: number): RsBlock[] {
  const rsBlockTable: Record<number, [number, number, number]> = {
    1: [1, 26, 19],
    2: [1, 44, 34],
    3: [1, 70, 55],
    4: [1, 100, 80],
    5: [1, 134, 108],
    6: [2, 86, 68],
    7: [2, 98, 78],
    8: [2, 121, 97],
    9: [2, 146, 116],
    10: [2, 86, 68]
  };

  const block = rsBlockTable[typeNumber];
  if (!block) {
    throw new Error(`Unsupported QR version ${typeNumber}`);
  }

  const [count, totalCount, dataCount] = block;
  return new Array(count).fill(null).map(() => ({ totalCount, dataCount }));
}

function createData(typeNumber: number, data: Qr8BitByte): number[] {
  const rsBlocks = getRsBlocks(typeNumber);
  const buffer = new QrBitBuffer();

  buffer.put(data.mode, 4);
  buffer.put(data.getLength(), getLengthInBits(typeNumber));
  data.write(buffer);

  const totalDataCount = rsBlocks.reduce((sum, block) => sum + block.dataCount, 0);

  if (buffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error("QR payload too large");
  }

  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }

  while (buffer.getLengthInBits() % 8 !== 0) {
    buffer.putBit(false);
  }

  while (buffer.getBuffer().length < totalDataCount) {
    buffer.put(PAD0, 8);
    if (buffer.getBuffer().length < totalDataCount) {
      buffer.put(PAD1, 8);
    }
  }

  let offset = 0;
  const dcdata: number[][] = [];
  const ecdata: number[][] = [];
  let maxDcCount = 0;
  let maxEcCount = 0;

  for (let r = 0; r < rsBlocks.length; r += 1) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].totalCount - dcCount;

    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);

    dcdata[r] = new Array(dcCount);
    for (let i = 0; i < dcdata[r].length; i += 1) {
      dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
    }
    offset += dcCount;

    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QrPolynomial(dcdata[r], rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);

    ecdata[r] = new Array(rsPoly.getLength() - 1);
    for (let i = 0; i < ecdata[r].length; i += 1) {
      const modIndex = i + modPoly.getLength() - ecdata[r].length;
      ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
  }

  const dataResult: number[] = [];

  for (let i = 0; i < maxDcCount; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < dcdata[r].length) {
        dataResult.push(dcdata[r][i]);
      }
    }
  }

  for (let i = 0; i < maxEcCount; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < ecdata[r].length) {
        dataResult.push(ecdata[r][i]);
      }
    }
  }

  return dataResult;
}

class QrCodeModel {
  private readonly typeNumber: number;
  private modules: (boolean | null)[][] = [];
  private moduleCount = 0;
  private dataCache: number[] | null = null;
  private dataList: Qr8BitByte[] = [];

  constructor(typeNumber: number) {
    this.typeNumber = typeNumber;
  }

  addData(data: string) {
    this.dataList.push(new Qr8BitByte(data));
    this.dataCache = null;
  }

  isDark(row: number, col: number): boolean {
    return Boolean(this.modules[row][col]);
  }

  getModuleCount() {
    return this.moduleCount;
  }

  make() {
    if (this.dataList.length !== 1) {
      throw new Error("Only one QR payload supported");
    }

    this.dataCache = createData(this.typeNumber, this.dataList[0]);

    let minLostPoint = Number.POSITIVE_INFINITY;
    let bestPattern = 0;

    for (let pattern = 0; pattern < 8; pattern += 1) {
      this.makeImpl(true, pattern);
      const lostPoint = getLostPoint(this.modules as boolean[][]);
      if (lostPoint < minLostPoint) {
        minLostPoint = lostPoint;
        bestPattern = pattern;
      }
    }

    this.makeImpl(false, bestPattern);
  }

  private makeImpl(test: boolean, maskPattern: number) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount)
      .fill(null)
      .map(() => new Array(this.moduleCount).fill(null));

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    this.mapData(this.dataCache ?? [], maskPattern);
  }

  private setupPositionProbePattern(row: number, col: number) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || this.moduleCount <= row + r) {
        continue;
      }

      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || this.moduleCount <= col + c) {
          continue;
        }

        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  private setupTimingPattern() {
    for (let i = 8; i < this.moduleCount - 8; i += 1) {
      if (this.modules[i][6] === null) {
        this.modules[i][6] = i % 2 === 0;
      }
      if (this.modules[6][i] === null) {
        this.modules[6][i] = i % 2 === 0;
      }
    }
  }

  private setupPositionAdjustPattern() {
    const pos = getPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];

        if (this.modules[row][col] !== null) {
          continue;
        }

        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            this.modules[row + r][col + c] =
              r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
  }

  private setupTypeInfo(test: boolean, maskPattern: number) {
    const data = (QR_ERROR_CORRECT_LEVEL_L << 3) | maskPattern;
    const bits = getBchTypeInfo(data);

    for (let i = 0; i < 15; i += 1) {
      const mod = !test && ((bits >> i) & 1) === 1;

      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }

      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }

    this.modules[this.moduleCount - 8][8] = !test;
  }

  private mapData(data: number[], maskPattern: number) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) {
        col -= 1;
      }

      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (this.modules[row][col - c] !== null) {
            continue;
          }

          let dark = false;
          if (byteIndex < data.length) {
            dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          }

          if (getMask(maskPattern, row, col - c)) {
            dark = !dark;
          }

          this.modules[row][col - c] = dark;

          bitIndex -= 1;
          if (bitIndex === -1) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }

        row += inc;

        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }
}

function pickTypeNumber(value: string): number {
  const length = new TextEncoder().encode(value).length;
  const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  const index = capacities.findIndex((capacity) => length <= capacity);
  if (index === -1) {
    throw new Error("QR payload too large");
  }
  return index + 1;
}

export function buildQrMatrix(value: string): boolean[][] {
  const typeNumber = pickTypeNumber(value);
  const qr = new QrCodeModel(typeNumber);
  qr.addData(value);
  qr.make();

  return new Array(qr.getModuleCount()).fill(null).map((_, row) =>
    new Array(qr.getModuleCount()).fill(false).map((__, col) => qr.isDark(row, col))
  );
}

export function renderQrSvg(value: string, cellSize = 5, margin = 4): string {
  const matrix = buildQrMatrix(value);
  const count = matrix.length;
  const size = (count + margin * 2) * cellSize;
  const path: string[] = [];

  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      if (!matrix[y][x]) {
        continue;
      }
      const rx = (x + margin) * cellSize;
      const ry = (y + margin) * cellSize;
      path.push(`M${rx},${ry}h${cellSize}v${cellSize}h-${cellSize}z`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path.join("")}" fill="#0b1f12"/></svg>`;
}
