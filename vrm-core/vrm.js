// ES6
import { deserializeGlb, serializeGlb } from './gltf.js';

const PRIMITIVE_MODE = {
    POINTS: 0,
    LINES: 1,
    LINE_LOOP: 2,
    LINE_STRIP: 3,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TRIANGLE_FAN: 6,
};

/**
 * Mutable representation of a single, whole .vrm data.
 * Guranteed to be (de-)serializable from/to a blob.
 */
export class VrmModel {
    // Private
    /**
     * @param {Object} gltf: glTF structure
     * @param {Array<ArrayBuffer>} buffers 
     */
    constructor(gltf, buffers) {
        this.gltf = gltf;
        this.buffers = buffers;
        this.version = 0; // mutation version
    }

    /**
     * 
     * @param {ArrayBuffer} blob
     * @returns {Promise<VrmModel>}
     */
    static deserialize(blob) {
        const gltf = deserializeGlb(blob);
        return new Promise((resolve, _reject) => {
            resolve(new VrmModel(gltf.json, gltf.buffers));
        });
    }

    /** 
     * Asynchronously serializes model to a VRM data.
     * Repeated calls are guranteed to return exactly same data.
     * @returns {Promise<ArrayBuffer>}
     */
    serialize() {
        return new Promise((resolve, _reject) => {
            resolve(serializeGlb({
                json: this.gltf,
                buffers: this.buffers,
            }));
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    // Mutation methods.

    /**
     * Note: {buffer, byteOffset, byteLength} will be calculated automatically. Other properties won't be set /
     * existing property (e.g. byteStride) will be discarded.
     * 
     * @param {number} bufferViewIx: Existing bufferView index
     * @param {ArrayBuffer} data: new content of specified bufferView. Existing data will be thrown away.
     */
    setBufferViewData(bufferViewIx, data) {
        this.gltf.bufferViews[bufferViewIx] = this.appendDataToBuffer(data, 0);
        this.repackBuffer();
    }

    /**
     * @param {ArrayBuffer} data 
     * @param {number} bufferIx: Usually specify 0. Buffer must already exist.
     * @returns {Object} {buffer, byteOffset, byteLength}
     */
    appendDataToBuffer(data, bufferIx) {
        const oldBuffer = this.buffers[bufferIx];
        const newByteBuffer = new Uint8Array(oldBuffer.byteLength + data.byteLength);
        newByteBuffer.set(new Uint8Array(oldBuffer), 0);
        newByteBuffer.set(new Uint8Array(data), oldBuffer.byteLength);

        this.buffers[bufferIx] = newByteBuffer.buffer;
        this.gltf.buffers[bufferIx] = {
            byteLength: newByteBuffer.byteLength
        };
        this.version++;
        return {
            buffer: bufferIx,
            byteOffset: oldBuffer.byteLength,
            byteLength: data.byteLength,
        };
    }

    /**
     * Copy content of every bufferViews in to buffer 0 with tight packing.
     */
    repackBuffer() {
        const preTotalSize = this.buffers.map(buf => buf.byteLength).reduce((a, b) => a + b);
        const totalSize = this.gltf.bufferViews
            .map(bv => bv.byteLength).reduce((a, b) => a + b);

        const newBuffer = new Uint8Array(totalSize);
        let offset = 0;
        const newBufferViews = this.gltf.bufferViews.map(bv => {
            const data = new Uint8Array(this.buffers[bv.buffer].slice(bv.byteOffset, bv.byteOffset + bv.byteLength));
            newBuffer.set(data, offset);

            const newBv = Object.assign({}, bv);
            newBv.buffer = 0;
            newBv.byteOffset = offset;
            newBv.byteLength = data.byteLength;

            offset += data.byteLength;
            return newBv;
        });

        this.buffers = [newBuffer.buffer];
        this.gltf.bufferViews = newBufferViews;
        this.gltf.buffers = [{
            byteLength: newBuffer.byteLength
        }];
        this.version++;

        console.log("repack", preTotalSize, "->", totalSize);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    // Accessors.

    countTotalTris() {
        var numTris = 0;
        this.gltf.meshes.forEach(mesh => {
            mesh.primitives.forEach(prim => {
                numTris += this.countPrimitiveTris(prim);
            });
        });
        return numTris;
    }

    countPrimitiveTris(primitive) {
        const mode = primitive.mode ?? 4;
        if (mode === PRIMITIVE_MODE.TRIANGLES) {
            const accessor = this.gltf.accessors[primitive.indices];
            return accessor.count / 3;
        }
        console.log(`Unsupported primitive mode ${mode}`)
        throw "Couldn't count tris";
    }

    /**
     * @param {number} imageId 
     * @returns {ArrayBuffer}
     */
    getImageAsBuffer(imageId) {
        const img = this.gltf.images[imageId];
        return this._getBufferView(img.bufferView);
    }

    /**
     * 
     * @param {number} bufferViewIx: glTF bufferView index
     * @param {ArrayBuffer} newData: new buffer data
     */
    setBufferData(bufferViewIx, newData) {
        const offset = this.buffers[0].byteLength;

        const newBuffer = new ArrayBuffer(offset + newData.byteLength);
        const newBufferView = new Uint8Array(newBuffer);
        newBufferView.set(new Uint8Array(this.buffers[0]));
        newBufferView.set(new Uint8Array(newData), offset);

        this.buffers[0] = newBuffer;
        this.gltf.bufferViews[bufferViewIx] = {
            buffer: 0,
            byteOffset: offset,
            byteLength: newData.byteLength,
        };

        this.version += 1;
    }

    /**
     * @param {number} imageId
     * @returns {string}
     */
    getImageAsDataUrl(imageId) {
        const img = this.gltf.images[imageId];
        const data = this._getBufferView(img.bufferView);

        const byteBuffer = new Uint8Array(data);
        var asciiBuffer = "";
        for (var i = 0; i < data.byteLength; i++) {
            asciiBuffer += String.fromCharCode(byteBuffer[i]);
        }
        return "data:img/png;base64," + window.btoa(asciiBuffer);
    }

    /**
     * @param {number} bufferViewIx: glTF bufferView index
     * @returns {ArrayBuffer}: immutable blob slice
     */
    _getBufferView(bufferViewIx) {
        const bufferView = this.gltf.bufferViews[bufferViewIx];
        const offset = bufferView.byteOffset ?? 0;
        return this.buffers[bufferView.buffer].slice(offset, offset + bufferView.byteLength);
    }
}
