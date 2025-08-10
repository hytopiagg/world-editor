/* global BigInt */
import pako from "pako";

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
    LONG_ARRAY: 12,
};
export class NBTParser {
    constructor(bytesOrBuffer, littleEndian = false) {
        this.bytes =
            bytesOrBuffer instanceof Uint8Array
                ? bytesOrBuffer
                : new Uint8Array(bytesOrBuffer);
        this.view = new DataView(
            this.bytes.buffer,
            this.bytes.byteOffset,
            this.bytes.byteLength
        );
        this.offset = 0;
        this.littleEndian = littleEndian;
        this.textDecoder = new TextDecoder(); // Single reusable instance
    }
    static decompress(buffer) {
        try {
            const bytes =
                buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
            const view = new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength
            );
            if (view.getUint8(0) === 0x1f && view.getUint8(1) === 0x8b) {
                console.log("Detected GZIP compression");
                return pako.ungzip(bytes);
            }
            if (view.getUint8(0) === 0x78) {
                console.log("Detected ZLIB compression");
                return pako.inflate(bytes);
            }
            console.log("No compression detected, using raw buffer");
            return bytes;
        } catch (e) {
            console.error("Decompression error:", e);
            return buffer instanceof Uint8Array
                ? buffer
                : new Uint8Array(buffer); // Fallback to raw buffer
        }
    }
    static parse(buffer, littleEndian = false) {
        const decompressed = this.decompress(buffer);
        const bytes =
            decompressed instanceof Uint8Array
                ? decompressed
                : new Uint8Array(decompressed);
        const parser = new NBTParser(bytes, littleEndian);
        try {
            return parser.parseCompound();
        } catch (e) {
            throw new Error(
                `Failed to parse NBT data at offset ${parser.offset}: ${e.message}`
            );
        }
    }
    parseCompound(skipNameCheck = false) {
        const result = {};
        if (!skipNameCheck) {
            const tagType = this.view.getUint8(this.offset++);
            if (tagType !== TAG_TYPES.COMPOUND) {
                throw new Error(
                    `Expected compound tag but got ${tagType} at offset ${
                        this.offset - 1
                    }`
                );
            }
            const nameLength = this.view.getUint16(
                this.offset,
                this.littleEndian
            );
            this.offset += 2;
            const name = this.textDecoder.decode(
                this.bytes.subarray(this.offset, this.offset + nameLength)
            );
            this.offset += nameLength;
        }
        let tagType;
        while (
            (tagType = this.view.getUint8(this.offset++)) !== TAG_TYPES.END
        ) {
            const nameLength = this.view.getUint16(
                this.offset,
                this.littleEndian
            );
            this.offset += 2;
            const name = this.textDecoder.decode(
                this.bytes.subarray(this.offset, this.offset + nameLength)
            );
            this.offset += nameLength;
            result[name] = this.parseTagValue(tagType);
        }
        return result;
    }
    parseTagValue(tagType) {
        switch (tagType) {
            case TAG_TYPES.BYTE:
                return this.view.getInt8(this.offset++);
            case TAG_TYPES.SHORT:
                const shortVal = this.view.getInt16(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 2;
                return shortVal;
            case TAG_TYPES.INT:
                const intVal = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                return intVal;
            case TAG_TYPES.LONG:
                const highBits = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                const lowBits = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                return (BigInt(highBits) << 32n) | BigInt(lowBits >>> 0);
            case TAG_TYPES.FLOAT:
                const floatVal = this.view.getFloat32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                return floatVal;
            case TAG_TYPES.DOUBLE:
                const doubleVal = this.view.getFloat64(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 8;
                return doubleVal;
            case TAG_TYPES.BYTE_ARRAY:
                const byteLength = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                const byteArray = new Int8Array(
                    this.view.buffer,
                    this.view.byteOffset + this.offset,
                    byteLength
                );
                this.offset += byteLength;
                return Array.from(byteArray);
            case TAG_TYPES.STRING:
                const strLength = this.view.getUint16(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 2;
                const strValue = this.textDecoder.decode(
                    this.bytes.subarray(this.offset, this.offset + strLength)
                );
                this.offset += strLength;
                return strValue;
            case TAG_TYPES.LIST:
                const listTagType = this.view.getUint8(this.offset++);
                const listLength = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                const listResult = [];
                for (let i = 0; i < listLength; i++) {
                    listResult.push(this.parseTagValue(listTagType));
                }
                return listResult;
            case TAG_TYPES.COMPOUND:
                return this.parseCompound(true);
            case TAG_TYPES.INT_ARRAY:
                const intArrayLength = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                const intArray = [];
                for (let i = 0; i < intArrayLength; i++) {
                    intArray.push(
                        this.view.getInt32(this.offset, this.littleEndian)
                    );
                    this.offset += 4;
                }
                return intArray;
            case TAG_TYPES.LONG_ARRAY:
                const longArrayLength = this.view.getInt32(
                    this.offset,
                    this.littleEndian
                );
                this.offset += 4;
                const longArray = [];
                for (let i = 0; i < longArrayLength; i++) {
                    const highBits = this.view.getInt32(
                        this.offset,
                        this.littleEndian
                    );
                    this.offset += 4;
                    const lowBits = this.view.getInt32(
                        this.offset,
                        this.littleEndian
                    );
                    this.offset += 4;
                    longArray.push(
                        (BigInt(highBits) << 32n) | BigInt(lowBits >>> 0)
                    );
                }
                return longArray;
            default:
                throw new Error(
                    `Unknown tag type: ${tagType} at offset ${this.offset - 1}`
                );
        }
    }
}
