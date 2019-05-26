
const GLB_HEADER_LENGTH = 12;
const GLB_HEADER_MAGIC = 0x46546C67; // "glTF" in little endian.
const GLB_CHUNK_TYPE_JSON = 0x4E4F534A;
const GLB_CHUNK_TYPE_BIN = 0x004E4942;

/**
 * Deserialize GLB buffer.
 * Support only glTF Version 2.
 * Only do minimum validation, but won't accept known broken format.
 * Spec: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification
 * 
 * @param {ArrayBuffer} data 
 * @returns {Object} gltfObject
 * 
 * gltfObject contains:
 * - json: Object. main glTF structure.
 * - buffers: Array<ArrayBuffer>. Length=0 or 1.
 */
export function deserializeGlb(data) {
    // Decode header.
    const headerView = new DataView(data, 0, GLB_HEADER_LENGTH);
    const magic = headerView.getUint32(0, /* little= */ true);
    const version = headerView.getUint32(4, true);

    if (magic !== GLB_HEADER_MAGIC) {
        throw new Error('Unsupported glTF-Binary header.');
    }
    if (version != 2) {
        throw new Error('Only version 2 is supported. Found ', version);
    }

    // Decode all chunks.
    const chunks = [];
    var dataOffset = GLB_HEADER_LENGTH;
    while (dataOffset < data.byteLength) {
        const chunkHeaderView = new DataView(data, dataOffset, 8);
        const chunkLength = chunkHeaderView.getUint32(0, true); // length of data (excludes this 8B chunk header)
        const chunkType = chunkHeaderView.getUint32(4, true);
        dataOffset += 8;

        const chunkData = data.slice(dataOffset, dataOffset + chunkLength);
        dataOffset += chunkLength;

        chunks.push({
            type: chunkType,
            data: chunkData,
        });
    }

    // Extract glTF 2 chunks.
    const jsonChunk = chunks.filter(c => c.type === GLB_CHUNK_TYPE_JSON)[0];
    const binChunks = chunks.filter(c => c.type === GLB_CHUNK_TYPE_BIN);
    return {
        json: JSON.parse(decodeUtf8(jsonChunk.data).trim()),
        buffers: binChunks.map(c => c.data),
    };
}


/**
 * Serialize glTF JSON & binary buffers into a single binary (GLB format).
 * Only supports glTF version 2.
 * Spec: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification
 * 
 * @param {Object} obj
 * @return {ArrayBuffer}
 * 
 * obj must contain:
 * - json: main glTF structure.
 * - buffers: Array<ArrayBuffer>. Length 0 or 1.
 */
export function serializeGlb(obj) {
    // Convert to chunks.
    const chunks = [
        {
            type: GLB_CHUNK_TYPE_JSON,
            data: alignWithPadding(encodeUtf8(JSON.stringify(obj.json)), 4, 0x20), // space padding
        }
    ].concat(obj.buffers.map(buffer => {
        return {
            type: GLB_CHUNK_TYPE_BIN,
            data: alignWithPadding(buffer, 4, 0x00), // 0 padding
        };
    }));

    // Create file.
    const totalSize = GLB_HEADER_LENGTH + chunks.map(chunk => 8 + chunk.data.byteLength).reduce((a, b) => a + b);
    const glbData = new ArrayBuffer(totalSize);

    const headerView = new DataView(glbData, 0, GLB_HEADER_LENGTH);
    headerView.setUint32(0, GLB_HEADER_MAGIC, true);
    headerView.setUint32(4, 2, true); // version
    headerView.setUint32(8, totalSize, true);

    var dataOffset = GLB_HEADER_LENGTH;
    chunks.forEach(chunk => {
        const chunkHeaderView = new DataView(glbData, dataOffset, 8);
        chunkHeaderView.setUint32(0, chunk.data.byteLength, true);
        chunkHeaderView.setUint32(4, chunk.type, true);
        dataOffset += 8;

        const chunkDataView = new Uint8Array(glbData, dataOffset, chunk.data.byteLength);
        chunkDataView.set(new Uint8Array(chunk.data));

        dataOffset += chunk.data.byteLength;
    });

    return glbData;
}

/**
 * 
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function decodeUtf8(buffer) {
    return new TextDecoder('utf-8').decode(buffer);
}

/**
 * 
 * @param {string} str 
 * @returns {Uint8Array}
 */
function encodeUtf8(str) {
    return new TextEncoder().encode(str);
}

/**
 * 
 * @param {ArrayBuffer} data 
 * @param {number} numBytes: alignment unit
 * @param {number} 0~255 single byte to pad
 */
function alignWithPadding(data, numBytes, padding) {
    const finalSize = Math.ceil(data.byteLength / numBytes) * numBytes;
    const result = new ArrayBuffer(finalSize);

    const values = new Uint8Array(result);
    values.set(new Uint8Array(data));
    for (var offset = data.byteLength; offset < finalSize; offset++) {
        values[offset] = padding;
    }

    return result;
}