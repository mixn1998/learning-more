import { open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function crc32(content: Buffer): number {
  let value = 0xffffffff;
  for (const byte of content) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}

async function files(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('zip_symlink_forbidden');
    if (entry.isDirectory()) output.push(...(await files(root, absolute)));
    else output.push(path.relative(root, absolute).replaceAll('\\', '/'));
  }
  return output.sort();
}

function localHeader(name: Buffer, size: number, checksum: number): Buffer {
  const output = Buffer.alloc(30 + name.length);
  output.writeUInt32LE(0x04034b50, 0);
  output.writeUInt16LE(20, 4);
  output.writeUInt16LE(0x0800, 6);
  output.writeUInt16LE(0, 8);
  output.writeUInt16LE(0, 10);
  output.writeUInt16LE(0x0021, 12);
  output.writeUInt32LE(checksum, 14);
  output.writeUInt32LE(size, 18);
  output.writeUInt32LE(size, 22);
  output.writeUInt16LE(name.length, 26);
  output.writeUInt16LE(0, 28);
  name.copy(output, 30);
  return output;
}

function centralHeader(name: Buffer, size: number, checksum: number, offset: number): Buffer {
  const output = Buffer.alloc(46 + name.length);
  output.writeUInt32LE(0x02014b50, 0);
  output.writeUInt16LE(0x0314, 4);
  output.writeUInt16LE(20, 6);
  output.writeUInt16LE(0x0800, 8);
  output.writeUInt16LE(0, 10);
  output.writeUInt16LE(0, 12);
  output.writeUInt16LE(0x0021, 14);
  output.writeUInt32LE(checksum, 16);
  output.writeUInt32LE(size, 20);
  output.writeUInt32LE(size, 24);
  output.writeUInt16LE(name.length, 28);
  output.writeUInt16LE(0, 30);
  output.writeUInt16LE(0, 32);
  output.writeUInt16LE(0, 34);
  output.writeUInt16LE(0, 36);
  output.writeUInt32LE(0, 38);
  output.writeUInt32LE(offset, 42);
  name.copy(output, 46);
  return output;
}

function endRecord(entries: number, centralSize: number, centralOffset: number): Buffer {
  const output = Buffer.alloc(22);
  output.writeUInt32LE(0x06054b50, 0);
  output.writeUInt16LE(0, 4);
  output.writeUInt16LE(0, 6);
  output.writeUInt16LE(entries, 8);
  output.writeUInt16LE(entries, 10);
  output.writeUInt32LE(centralSize, 12);
  output.writeUInt32LE(centralOffset, 16);
  output.writeUInt16LE(0, 20);
  return output;
}

export async function writeDeterministicZip(input: {
  sourceRoot: string;
  outputPath: string;
  prefix: string;
}): Promise<void> {
  const entries = await files(input.sourceRoot);
  if (entries.length > 65_535) throw new Error('zip_entry_limit_exceeded');
  const output = await open(input.outputPath, 'w');
  const central: Buffer[] = [];
  let offset = 0;
  try {
    for (const relativePath of entries) {
      const content = await readFile(path.join(input.sourceRoot, ...relativePath.split('/')));
      if (content.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error('zip64_required');
      }
      const name = Buffer.from(`${input.prefix}/${relativePath}`, 'utf8');
      const checksum = crc32(content);
      const header = localHeader(name, content.byteLength, checksum);
      await output.write(header, 0, header.length, offset);
      await output.write(content, 0, content.length, offset + header.length);
      central.push(centralHeader(name, content.byteLength, checksum, offset));
      offset += header.length + content.length;
    }
    const centralOffset = offset;
    for (const header of central) {
      await output.write(header, 0, header.length, offset);
      offset += header.length;
    }
    const centralSize = offset - centralOffset;
    const end = endRecord(entries.length, centralSize, centralOffset);
    await output.write(end, 0, end.length, offset);
    await output.sync();
  } finally {
    await output.close();
  }
}
