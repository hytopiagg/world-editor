import pako from 'pako';

// NBT Tag Types
const TAG_TYPES = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12
};

export class NBTParser {
  constructor(buffer, littleEndian = false) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
    this.littleEndian = littleEndian;
  }

  static decompress(buffer) {
    try {
      // Attempt to detect the compression format
      const view = new DataView(buffer);
      
      // Check for GZIP magic number (0x1f, 0x8b)
      if (view.getUint8(0) === 0x1f && view.getUint8(1) === 0x8b) {
        console.log('Detected GZIP compression');
        return pako.ungzip(new Uint8Array(buffer)).buffer;
      }
      
      // Check for zlib header (first byte should be 0x78)
      if (view.getUint8(0) === 0x78) {
        console.log('Detected ZLIB compression');
        return pako.inflate(new Uint8Array(buffer)).buffer;
      }
      
      // If no compression is detected, return the original buffer
      console.log('No compression detected, using raw buffer');
      return buffer;
    } catch (e) {
      console.error("Decompression error:", e);
      console.log("Using uncompressed data instead");
      return buffer; // Return original buffer on error
    }
  }

  static parse(buffer, littleEndian = false) {
    // First try to decompress, but don't fail if decompression fails
    const decompressedBuffer = this.decompress(buffer);
    
    try {
      // Try to parse the decompressed (or original) buffer
      const parser = new NBTParser(decompressedBuffer, littleEndian);
      return parser.parseCompound();
    } catch (e) {
      console.error("NBT parsing error:", e);
      // If we fail, throw a more descriptive error
      throw new Error(`Failed to parse NBT data: ${e.message}`);
    }
  }

  parseCompound(skipNameCheck = false) {
    const result = {};
    
    // Read tag type if this is root compound
    if (!skipNameCheck) {
      const tagType = this.view.getUint8(this.offset++);
      if (tagType !== TAG_TYPES.COMPOUND) {
        throw new Error(`Expected compound tag but got ${tagType}`);
      }
      
      // Read name for root compound
      const nameLength = this.view.getUint16(this.offset, this.littleEndian);
      this.offset += 2;
      
      const nameBytes = new Uint8Array(this.buffer, this.offset, nameLength);
      const name = new TextDecoder().decode(nameBytes);
      this.offset += nameLength;
    }
    
    // Parse tags until END tag
    let tagType;
    while ((tagType = this.view.getUint8(this.offset++)) !== TAG_TYPES.END) {
      // Read tag name
      const nameLength = this.view.getUint16(this.offset, this.littleEndian);
      this.offset += 2;
      
      const nameBytes = new Uint8Array(this.buffer, this.offset, nameLength);
      const name = new TextDecoder().decode(nameBytes);
      this.offset += nameLength;
      
      // Read tag value based on type
      result[name] = this.parseTagValue(tagType);
    }
    
    return result;
  }

  parseTagValue(tagType) {
    switch (tagType) {
      case TAG_TYPES.BYTE:
        return this.view.getInt8(this.offset++);
        
      case TAG_TYPES.SHORT:
        const shortVal = this.view.getInt16(this.offset, this.littleEndian);
        this.offset += 2;
        return shortVal;
        
      case TAG_TYPES.INT:
        const intVal = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        return intVal;
        
      case TAG_TYPES.LONG:
        // JavaScript doesn't have 64-bit integers, so use BigInt
        const highBits = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        const lowBits = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        /* eslint-disable no-undef */
        return (BigInt(highBits) << 32n) | BigInt(lowBits >>> 0);
        /* eslint-enable no-undef */
        
      case TAG_TYPES.FLOAT:
        const floatVal = this.view.getFloat32(this.offset, this.littleEndian);
        this.offset += 4;
        return floatVal;
        
      case TAG_TYPES.DOUBLE:
        const doubleVal = this.view.getFloat64(this.offset, this.littleEndian);
        this.offset += 8;
        return doubleVal;
        
      case TAG_TYPES.BYTE_ARRAY:
        const byteLength = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        const byteArray = new Int8Array(this.buffer, this.offset, byteLength);
        this.offset += byteLength;
        return Array.from(byteArray);
        
      case TAG_TYPES.STRING:
        const strLength = this.view.getUint16(this.offset, this.littleEndian);
        this.offset += 2;
        const strBytes = new Uint8Array(this.buffer, this.offset, strLength);
        const strValue = new TextDecoder().decode(strBytes);
        this.offset += strLength;
        return strValue;
        
      case TAG_TYPES.LIST:
        const listTagType = this.view.getUint8(this.offset++);
        const listLength = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        
        const listResult = [];
        for (let i = 0; i < listLength; i++) {
          listResult.push(this.parseTagValue(listTagType));
        }
        return listResult;
        
      case TAG_TYPES.COMPOUND:
        return this.parseCompound(true);
        
      case TAG_TYPES.INT_ARRAY:
        const intArrayLength = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        const intArray = [];
        for (let i = 0; i < intArrayLength; i++) {
          intArray.push(this.view.getInt32(this.offset, this.littleEndian));
          this.offset += 4;
        }
        return intArray;
        
      case TAG_TYPES.LONG_ARRAY:
        const longArrayLength = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        const longArray = [];
        for (let i = 0; i < longArrayLength; i++) {
          const highBits = this.view.getInt32(this.offset, this.littleEndian);
          this.offset += 4;
          const lowBits = this.view.getInt32(this.offset, this.littleEndian);
          this.offset += 4;
          /* eslint-disable no-undef */
          longArray.push((BigInt(highBits) << 32n) | BigInt(lowBits >>> 0));
          /* eslint-enable no-undef */
        }
        return longArray;
        
      default:
        throw new Error(`Unknown tag type: ${tagType}`);
    }
  }
} 