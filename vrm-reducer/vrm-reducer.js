"use strict"; // ES6
import { VrmModel } from "../vrm-core/vrm.js";
import { VrmDependency, TYPE_RMAP, TYPE_FMAP } from "../vrm-core/deps.js";
import { MinHeap, setSub, mapMerge, multimapAdd} from "./algorithm.js";

/**
 * @param {VrmModel} model: will be mutated
 * @returns {Promise<void>}
 */
export async function reduceVrm(model) {
    /* TODO
    GPU reduction
     - mesh / primitive merging, atlasing
    compressed size reduction
     - float quantization
    user-editing
     - merging multiple blendshapes in a blendshape group
    */
    await deleteNonEssentialBones(model);
    await deleteVrmThumbnail(model);
    await extremeResizeTexture(model, 128);
    await stripAllEmotions(model);
    await removeUnusedMorphs(model);
    await reduceMesh(model, 0.6);
    await removeUnusedTextures(model);
    await removeUnusedImages(model);
    await removeUnusedAccessors(model);
    await removeUnusedBufferViews(model);
    // await removeAllNames(model);
    model.repackBuffer();
    return null;
}


/**
 * Reduces the number of triangles somewhat smartly.
 * "Surface Simplification Using Quadric Error Metrics" (1997)
 * https://www.cs.cmu.edu/~./garland/Papers/quadrics.pdf
 * 
 * @param {VrmModel} model 
 * @param {number} target number of vertices (0.3: reduce to 30% of vertices)
 */
async function reduceMesh(model, target) {
    function initErrorMatrix() {
        return new Float64Array(16); // row major (m11, m12, m13, m14, m21, ...)
    }
    function accumErrorMatrix(m, plane, multiplier) {
        console.assert(m.length === 16);
        console.assert(plane.length === 4);
        multiplier = multiplier ?? 1;

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                m[i * 4 + j] += plane[i] * plane[j] * multiplier;
            }
        }
    }
    function getError(m, v) {
        console.assert(m.length === 16);
        console.assert(v.length === 3);
        v = [v[0], v[1], v[2], 1];

        const u = [0, 0, 0, 0]; // <- mul(m, v)
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                u[i] += m[i * 4 + j] * v[j];
            }
        }
        let s = 0; // <- dot(v, u)
        for (let i = 0; i < 4; i++) {
            s += v[i] * u[i];
        }
        return Math.max(s, 0); // since this is quadaratic op, result must be >=0 (negative result is due to numerical error)
    }
    function combineErrorMatrix(m0, m1) {
        const mcombined = new Float64Array(16);
        for (let i = 0; i < 16; i++) {
            mcombined[i] = m0[i] + m1[i];
        }
        return mcombined;
    }

    // assuming CCW triangle
    function v3sub(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }
    function v3normalize(a) {
        const k = 1 / Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        return [a[0] * k, a[1] * k, a[2] * k];
    }
    function v3cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function v3dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    // returns [a,b,c,d] such that ax + by + cz + d = 0, |(a,b,c)| = 1
    function computePlane(p0, p1, p2) {
        const n = v3normalize(v3cross(v3sub(p1, p0), v3sub(p2, p0)));
        const d = -v3dot(p0, n);
        return [n[0], n[1], n[2], d];
    }
    function getPlane(p, n) {
        const d = -v3dot(p, n);
        return [n[0], n[1], n[2], d];
    }
    
    function computeNormal(p0, p1, p2) {
        return v3normalize(v3cross(v3sub(p1, p0), v3sub(p2, p0)));
    }

    function encodeVPair(va, vb) {
        return va < vb ? `${va}:${vb}` : `${vb}:${va}`;
    }
    function decodeVPair(vp) {
        return vp.split(':').map(s => parseInt(s));
    }

    // index buffer (multiple) -> vertex attribs
    model.gltf.meshes.forEach(mesh => {
        const numVertices = model.gltf.accessors[mesh.primitives[0].attributes.POSITION].count;
        if (numVertices <= 3) {
            return;
        }


        
        const vertexErrorMatrix = new Map(); // vix:error matrix
        mesh.primitives.forEach(prim => {
            const pos = readVecBuffer(model, prim.attributes.POSITION);
            const tris = readIndexBuffer(model, prim.indices);
            console.assert(tris.length % 3 === 0);

            // Compute "open" edges for boundary preservation.
            const vpCount = new Map(); //key:vp-encoding, value:vp-count
            const vpAnyFaceNormal = new Map(); // key:vp-encoding, value:any of a shared triangle normal
            for (let i = 0; i < tris.length; i+=3) {
                const vix0 = tris[i + 0];
                const vix1 = tris[i + 1];
                const vix2 = tris[i + 2];
                const vp0 = encodeVPair(vix0, vix1);
                const vp1 = encodeVPair(vix1, vix2);
                const vp2 = encodeVPair(vix2, vix0);
                vpCount.set(vp0, (vpCount.get(vp0) ?? 0) + 1);
                vpCount.set(vp1, (vpCount.get(vp1) ?? 0) + 1);
                vpCount.set(vp2, (vpCount.get(vp2) ?? 0) + 1);

                const n = computeNormal(pos[vix0], pos[vix1], pos[vix2]);
                vpAnyFaceNormal.set(vp0, n);
                vpAnyFaceNormal.set(vp1, n);
                vpAnyFaceNormal.set(vp2, n);
            }
            const openEdges = new Set();
            vpCount.forEach((cnt, vp) => {
                if (cnt === 1) {
                    openEdges.add(vp);
                }
                // cnt=2: normal edge, cnt>=3: broken edge
            });

            for (let i = 0; i < tris.length; i+=3) {
                const vix0 = tris[i + 0];
                const vix1 = tris[i + 1];
                const vix2 = tris[i + 2];
                const plane = computePlane(pos[vix0], pos[vix1], pos[vix2]);
                for (const vix of [vix0, vix1, vix2]) {
                    const m = vertexErrorMatrix.get(vix) ?? initErrorMatrix();
                    accumErrorMatrix(m, plane);
                    vertexErrorMatrix.set(vix, m);
                }
            }
            for (let openEdge of openEdges) {
                const [vix0, vix1] = decodeVPair(openEdge);
                const edgeDir = v3normalize(v3sub(pos[vix1], pos[vix0]));
                const faceNormal = vpAnyFaceNormal.get(openEdge);
                const constraintPlaneNormal = v3cross(edgeDir, faceNormal);
        
                // TODO: maybe better to multiply by some scaler? (to more heavily penalize boundary breaking than surface breaking)
                accumErrorMatrix(vertexErrorMatrix.get(vix0), getPlane(pos[vix0], constraintPlaneNormal), 10);
                accumErrorMatrix(vertexErrorMatrix.get(vix1), getPlane(pos[vix1], constraintPlaneNormal), 10);
            }
        });
        console.log("vertex error matrix", vertexErrorMatrix);

        const vertexMergeTracker = new IndexMergeTracker();
        const newTrisList = mesh.primitives.map(prim => {
            const vps = new Set(); // vix(small):vix(large)


            const pos = readVecBuffer(model, prim.attributes.POSITION);
            const tris = readIndexBuffer(model, prim.indices);
            console.assert(tris.length % 3 === 0);

            function computeVPError(vix0, vix1) {
                const mcombined = combineErrorMatrix(vertexErrorMatrix.get(vix0), vertexErrorMatrix.get(vix1));
                // TODO: Solve for quadratic minimum.
                const e0 = getError(mcombined, pos[vix0]);
                const e1 = getError(mcombined, pos[vix1]);
                if (e0 < e1) {
                    return [e0, vix0];
                } else {
                    return [e1, vix1];
                }
            }

            const vpReductionHeap = new MinHeap();
            const vertexToVps = new Map();
            for (let i = 0; i < tris.length; i+=3) {
                const vix0 = tris[i + 0];
                const vix1 = tris[i + 1];
                const vix2 = tris[i + 2];
                vps.add(encodeVPair(vix0, vix1));
                vps.add(encodeVPair(vix1, vix2));
                vps.add(encodeVPair(vix2, vix0));
                vpReductionHeap.insert(encodeVPair(vix0, vix1), computeVPError(vix0, vix1)[0]);
                vpReductionHeap.insert(encodeVPair(vix1, vix2), computeVPError(vix1, vix2)[0]);
                vpReductionHeap.insert(encodeVPair(vix2, vix0), computeVPError(vix2, vix0)[0]);

                multimapAdd(vertexToVps, vix0, encodeVPair(vix0, vix1), encodeVPair(vix2, vix0));
                multimapAdd(vertexToVps, vix1, encodeVPair(vix1, vix2), encodeVPair(vix0, vix1));
                multimapAdd(vertexToVps, vix2, encodeVPair(vix2, vix0), encodeVPair(vix1, vix2));
            }
            console.log("VPRedH", vpReductionHeap);

            // TODO: Re-compute error after each reduction.
            const numReductionIter = Math.floor(vps.size * (1 - target));
            for (let i = 0; i < numReductionIter; i++) {
                const vp = vpReductionHeap.popmin()[0];
                let [v0, v1] = decodeVPair(vp);

                const diff = v3sub(pos[v0], pos[v1]);
                const vlen = Math.sqrt(v3dot(diff, diff));
                console.log(`Reducing ${v0},${v1} d=${vlen}`);

                v0 = vertexMergeTracker.resolve(v0);
                v1 = vertexMergeTracker.resolve(v1);
                if (v0 === v1) {
                    continue; // VP candidate became degenerate due to previous VP collapses.
                }

                const [_, vdst] = computeVPError(v0, v1);
                const vsrc = (vdst === v0) ? v1 : v0;

                const mcombined = combineErrorMatrix(vertexErrorMatrix.get(v0), vertexErrorMatrix.get(v1));
                vertexMergeTracker.mergePair(vdst, vsrc);
                vertexErrorMatrix.set(vdst, mcombined);
                multimapAdd(vertexToVps, vdst, ...(vertexToVps.get(vsrc) || []));

                // Recompute error heap.
                const affectedVps = new Set(vertexToVps.get(vdst) || []);
                for (const vp of affectedVps) {
                    let [v0, v1] = decodeVPair(vp);
                    v0 = vertexMergeTracker.resolve(v0);
                    v1 = vertexMergeTracker.resolve(v1);
                    const [err, _] = computeVPError(v0, v1);

                    // WARNING: This will result in O(V^2 log(V)) time.
                    for (let eix = 0; eix < vpReductionHeap.size(); eix++) {
                        const e = vpReductionHeap.tree[eix];
                        if (affectedVps.has(e[0])) {
                            if (e[1] < err) { // error nerve become smaller, that's why fix_down is enough.
                                vpReductionHeap.tree[eix][1] = err;
                                vpReductionHeap._fix_invariance_down(eix);
                            }
                            break;
                        }
                    }
                }
            }

            // remove degenerate tris
            // Encode triangle's identity, assuming cyclic symmetry. (but not allowing flipping)
            function encodeTriKey(v0, v1, v2) {
                const vmin = Math.min(v0, v1, v2);
                if (v0 === vmin) {
                    return `${v0}:${v1}:${v2}`;
                } else if (v1 === vmin) {
                    return `${v1}:${v2}:${v0}`;
                } else {
                    return `${v2}:${v0}:${v1}`;
                }
            }
            const triKeys = new Set();
            let newTris = [];
            for (let i = 0; i < tris.length; i+=3) {
                const vix0 = vertexMergeTracker.resolve(tris[i + 0]);
                const vix1 = vertexMergeTracker.resolve(tris[i + 1]);
                const vix2 = vertexMergeTracker.resolve(tris[i + 2]);
                if (vix0 === vix1 || vix1 === vix2 || vix2 === vix0) {
                    continue; // omit
                }
                const key = encodeTriKey(vix0, vix1, vix2);
                if (triKeys.has(key)) {
                    // Two different triangles can degenerate into single triangle after 3 VP collapses.
                    continue; // omit
                }
                // accept
                newTris.push(vix0, vix1, vix2);
                triKeys.add(key);
            }
            console.assert(newTris.length <= tris.length);
            return newTris;
        });
        
        const allvs = new Set();
        newTrisList.forEach(tris => tris.forEach(v => allvs.add(v)));
        const vertexPacking = new ArrayPacking(allvs, numVertices);

        newTrisList.forEach((newTris, primIx) => {
            const prim = mesh.primitives[primIx];
            writeIndexBuffer(model, prim.indices, newTris.map(v => vertexPacking.convert(v)));
            Object.entries(prim.attributes).forEach(
                ([_, accId]) => writeVecBuffer(model, accId, vertexPacking.apply(readVecBuffer(model, accId))));
            if (prim.targets !== undefined) {
                prim.targets.forEach(target => {
                    Object.entries(target).forEach(
                        ([_, accId]) => writeVecBuffer(model, accId, vertexPacking.apply(readVecBuffer(model, accId))));
                });    
            }
        });
    });
}


/**
 * @param {VrmModel} model
 * @param {number} accId
 * @returns {Uint32Array}
 */
function readIndexBuffer(model, accId) {
    const acc = model.gltf.accessors[accId];
    console.assert(acc.type === "SCALAR");
    const blob = model._getBufferView(acc.bufferView);
    const blobView = new DataView(blob);

    const data = new Uint32Array(acc.count);
    const ty = TYPE_RMAP[acc.componentType];
    console.assert(ty === "u8" || ty === "u16" || ty === "u32");
    for (let i = 0; i < acc.count; i++) {
        if (ty === "u8") {
            data[i] = blobView.getUint8(i);
        } else if (ty === "u16") {
            data[i] = blobView.getUint16(i * 2, true);
        } else if (ty === "u32") {
            data[i] = blobView.getUint32(i * 4, true);
        }
    }
    return data;
}


/**
 * @param {VrmModel} model
 * @param {number} accId
 * @param {number[]} data
 */
function writeIndexBuffer(model, accId, data) {
    console.assert(data.length > 0);
    const acc = model.gltf.accessors[accId];
    console.assert(acc.type === "SCALAR");

    const maxVal = Math.max(...data);
    console.assert(maxVal <= 0xffffffff);

    let ty;
    let blob = new ArrayBuffer(data.length * 4);
    if (maxVal <= 0xff) {
        ty = "u8";
        blob = new ArrayBuffer(data.length * 1);
    } else if (maxVal <= 0xffff) {
        ty = "u16";
        blob = new ArrayBuffer(data.length * 2);
    } else if (maxVal <= 0xffffffff) {
        ty = "u32";
        blob = new ArrayBuffer(data.length * 4);
    }

    const blobView = new DataView(blob);
    for (let i = 0; i < data.length; i++) {
        if (ty === "u8") {
            blobView.setUint8(i, data[i]);
        } else if (ty === "u16") {
            blobView.setUint16(i * 2, data[i], true);
        } else if (ty === "u32") {
            blobView.setUint32(i * 4, data[i], true);
        }
    }
    acc.componentType = TYPE_FMAP[ty];
    acc.count = data.length;
    delete acc.byteOffset;
    delete acc.sparse;
    model.setBufferViewData(acc.bufferView, blob);
}


/**
 * @param {VrmModel} model
 * @param {number} accId
 * @returns {number[][]}
 */
function readVecBuffer(model, accId) {
    const acc = model.gltf.accessors[accId];
    console.assert(VEC_MAP[acc.type] !== undefined);
    const vecDim = VEC_MAP[acc.type];
    const blob = model._getBufferView(acc.bufferView);
    const blobView = new DataView(blob);

    const data = [];
    const ty = TYPE_RMAP[acc.componentType];
    console.assert(ty === "f32" || ty === "u16");
    for (let i = 0; i < acc.count; i++) {
        const v = [];
        for (let e = 0; e < vecDim; e++) {
            if (ty === "f32") {
                v.push(blobView.getFloat32((i * vecDim + e) * 4, true));
            } else if (ty === "u16") {
                v.push(blobView.getUint16((i * vecDim + e) * 2, true));
            }
        }
        data.push(v);
    }
    return data;
}

const VEC_MAP = {
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
};

/**
 * Mutate specified accessor (and associated buffer view).
 * Keeps original type & componentType.
 * 
 * @param {VrmModel} model 
 * @param {number} accId 
 * @param {number[][]} data 
 */
function writeVecBuffer(model, accId, data) {
    const acc = model.gltf.accessors[accId];
    console.assert(data.length > 0);
    const vecDim = data[0].length;
    console.assert(VEC_MAP[acc.type] === vecDim);
    const ty = TYPE_RMAP[acc.componentType];
    console.assert(ty === "f32" || ty === "u16");
    const componentSize = ty === "f32" ? 4 : 2;

    const blob = new ArrayBuffer(data.length * vecDim * componentSize);
    const blobView = new DataView(blob);
    for (let i = 0; i < data.length; i++) {
        for (let e = 0; e < vecDim; e++) {
            if (ty === "f32") {
                blobView.setFloat32((i * vecDim + e) * componentSize, data[i][e], true);
            } else if (ty === "u16") {
                blobView.setUint16((i * vecDim + e) * componentSize, data[i][e], true);
            }
        }
    }
    acc.count = data.length;
    // TODO: Set min, max
    delete acc.byteOffset;
    delete acc.sparse;
    model.setBufferViewData(acc.bufferView, blob);
}

class ArrayPacking {
    /**
     * @param {Set<number>} usedIxs
     * @param {number} length
     */
    constructor(usedIxs, length) {
        console.assert(0 <= length);
        usedIxs.forEach(ix => console.assert(0 <= ix && ix < length));
        this.length = length;
        
        const mapping = new Map();
        let newIx = 0;
        for (const oldIx of Array.from(usedIxs).sort((a, b) => a - b)) {
            mapping.set(oldIx, newIx);
            newIx++;
        }
        this.mapping = mapping;
    }

    convert(oldIx) {
        console.assert(this.mapping.has(oldIx));
        return this.mapping.get(oldIx);
    }

    /**
     * @param {any[]} array
     * @returns {any[]} packed array
     */
    apply(array) {
        console.assert(array.length === this.length, `expected:${this.length} observed:${array.length}`);
        return array.filter((_, ix) => this.mapping.has(ix));
    }
}

class IndexMergeTracker {
    constructor() {
        this.mapping = new Map();
    }

    /**
     * 
     * @param {number} to: old index
     * @param {number} from: old index
     */
    mergePair(to, from) {
        to = this.resolve(to);
        from = this.resolve(from);
        if (to === from) {
            // it's possible they're already merged indirectly.
            // (e.g. after mergePair(0, 1), mergePair(1, 2), resolve(1) == resolve(2) == 0)
            return;
        }
        this.mapping.set(from, to);
    }

    /**
     * Lookup latest index corresponding to ix.
     * @param {number} ix: index in some merging state
     */
    resolve(ix) {
        if (!this.mapping.has(ix)) {
            return ix;
        }

        const latestIx = this.resolve(this.mapping.get(ix));
        this.mapping.set(ix, latestIx); // update cache to accelerate future resolve
        return latestIx;
    }
}

/**
 * @param {VrmModel} model
 */
async function deleteVrmThumbnail(model) {
    delete model.gltf.extensions.VRM.meta.texture;
    model.version += 1;
}

/**
 * @param {VrmModel} model
 * @param {number} maxTexSizePx
 * @returns {Promise<void>}
 */
async function extremeResizeTexture(model, maxTexSizePx) {
    for (let i = 0; i < model.gltf.images.length; i++) {
        const bufferViewIx = model.gltf.images[i].bufferView;
        const imageBlob = model.getImageAsBuffer(i);

        const img = await Jimp.read(imageBlob);
        const smallBlob = await img.scaleToFit(maxTexSizePx, maxTexSizePx).getBufferAsync("image/png");
        model.setBufferData(bufferViewIx, smallBlob);
    }
    model.repackBuffer();
}

/**
 * @param {VrmModel} model
 */
async function deleteNonEssentialBones(model) {
    model.gltf.extensions.VRM.secondaryAnimation.boneGroups = [];
    model.gltf.extensions.VRM.secondaryAnimation.colliderGroups = [];

    // Merge weights
    const lockedNodes = new Set(); // nodeIx
    model.gltf.nodes.forEach((node, nodeIx) => {
        if (node.skin !== undefined || node.mesh !== undefined) {
            lockedNodes.add(nodeIx);
        }
        // just in case, keep "secondary" special node to prevent UniVRM from crashing
        if (node.name === "secondary") {
            lockedNodes.add(nodeIx);
        }
    });
    model.gltf.scenes.forEach(scene => {
        scene.nodes.forEach(nodeIx => {
            lockedNodes.add(nodeIx);
        });
    });
    if (model.gltf.extensions.VRM.firstPerson !== undefined) {
        lockedNodes.add(model.gltf.extensions.VRM.firstPerson.firstPersonBone);
    }
    model.gltf.extensions.VRM.humanoid.humanBones.forEach(hb => {
        lockedNodes.add(hb.node);
    });
    model.gltf.skins.forEach(skin => {
        if (skin.skeleton !== undefined) {
            lockedNodes.add(skin.skeleton);
        }
    });

    const parents = new Map(); // key:nodeIx, val:parent nodeIx | roots wont't be included
    model.gltf.nodes.forEach((node, nodeIx) => {
        if (node.children === undefined) {
            return;
        }
        node.children.forEach(cnIx => {
            console.assert(!parents.has(cnIx)); // if this happens, node graph is not a tree
            parents.set(cnIx, nodeIx);
        });
    });

    // Node N is "free" = (n is not locked) & (n's children are free)
    const freeNodes = new Set(); // nodeIx
    // returns: is nodeIx free
    function indexFreeNodes(nodeIx) {
        const node = model.gltf.nodes[nodeIx];

        const selfIsFree = !lockedNodes.has(nodeIx);
        const childrenAreFree = (node.children || []).map(indexFreeNodes).every(x => x);

        const isFree= selfIsFree && childrenAreFree;
        if (isFree) {
            freeNodes.add(nodeIx);
        }
        return isFree;
    }
    model.gltf.scenes.forEach(scene => {
        scene.nodes.forEach(nodeIx => {
            indexFreeNodes(nodeIx);
        });
    });
    const weightMergePlan = new Map(); // key:src nodeIx, val:dst nodeIx
    function findFirstNonFree(nodeIx) {
        if (!freeNodes.has(nodeIx)) {
            return nodeIx;
        }

        console.assert(parents.has(nodeIx));
        if (weightMergePlan.has(nodeIx)) {
            return weightMergePlan.get(nodeIx);
        }
        return findFirstNonFree(parents.get(nodeIx));
    }
    freeNodes.forEach(nodeIx => {
        const nonFree = findFirstNonFree(nodeIx);
        weightMergePlan.set(nodeIx, nonFree);
    });
    function nodeIxToName(ix) {
        const node = model.gltf.nodes[ix];
        return `${ix}:${node.name || ""}`;
    }
    console.log("Node weight merge plan",
        new Map(new Array(...weightMergePlan.entries()).map(([k,v]) => [nodeIxToName(k), nodeIxToName(v)])));
    mergeWeights(model, weightMergePlan);

    // Remove nodes
    const nodeRemap = new Map(); // key:old node ix, val:old node ix
    const newNodes = [];
    let newNodeIx = 0;
    model.gltf.nodes.forEach((node, nodeIx) => {
        if (!freeNodes.has(nodeIx)) {
            nodeRemap.set(nodeIx, newNodeIx);
            newNodes.push(node);
            newNodeIx++;
        }
    });
    console.log("Node migration", nodeRemap);

    // Execute migration.
    model.gltf.scenes.forEach(scene => scene.nodes = scene.nodes.map(n => nodeRemap.get(n)));
    model.gltf.skins.forEach(skin => {
        skin.skeleton = nodeRemap.get(skin.skeleton);
        skin.joints = skin.joints.map(n => nodeRemap.get(n));
    });
    model.gltf.extensions.VRM.firstPerson.firstPersonBone = nodeRemap.get(model.gltf.extensions.VRM.firstPerson.firstPersonBone);
    model.gltf.extensions.VRM.humanoid.humanBones.forEach(hb => hb.node = nodeRemap.get(hb.node));
    // TODO: Migrate secondaryAnimation.
    newNodes.forEach(node => {
        const newChildren = [];
        if (node.children !== undefined) {
            node.children.forEach(n => {
                if (nodeRemap.has(n)) {
                    newChildren.push(nodeRemap.get(n));
                }
            });
        }
        if (newChildren.length > 0) {
            node.children = newChildren;
        } else {
            delete node.children;
        }
    });
    model.gltf.nodes = newNodes;

    model.version += 1;
}



/**
 * Move weights according to nodeMap. Nodes won't be deleted or re-indexed.
 * Joints will be re-generated to drop 0-weight nodes.
 * @param {VrmModel} model 
 * @param {Map<number, number>} nodeMap: key:src node id / val:dst node id
 * @returns {Promise<void>}
 */
async function mergeWeights(model, nodeMap) {
    model.gltf.nodes.forEach(node => {
        if (node.skin === undefined) {
            return;
        }

        const mesh = model.gltf.meshes[node.mesh];
        const skin = model.gltf.skins[node.skin];

        const newNodeToJoint = new Map(); // key:node, val:new joint ix
        const newJoints = [];
        let newJointIx = 0;
        for (let n of setSub(new Set(skin.joints), new Set(nodeMap.keys()))) {
            newNodeToJoint.set(n, newJointIx);
            newJoints.push(n);
            newJointIx++;
        }
        const jointIxTransfer = new Map();
        const jointIxMove = new Map();
        skin.joints.forEach((nodeIx, jointIx) => {
            const execTransfer = nodeMap.has(nodeIx);
            const newNodeIx = execTransfer ? nodeMap.get(nodeIx) : nodeIx;
            console.assert(newNodeToJoint.has(newNodeIx));
            const newJoint = newNodeToJoint.get(newNodeIx);

            if (execTransfer) {
                jointIxTransfer.set(jointIx, newJoint);
            } else {
                jointIxMove.set(jointIx, newJoint);
            }
        });
        if (jointIxTransfer.size === 0 && jointIxMove.size === 0) {
            return;
        }
        console.log("Joint migration", "move", jointIxMove, "trans", jointIxTransfer);
        // Exec migration.
        remapJointMatrices(model, skin.inverseBindMatrices, newJoints.length, jointIxMove);
        const alreadyProcessedJointAccIx = new Set();
        mesh.primitives.forEach(prim => {
            const j = prim.attributes.JOINTS_0;
            const w = prim.attributes.WEIGHTS_0;
            if (alreadyProcessedJointAccIx.has(j)) {
                return;
            }
            remapWeights(model, j, w, mapMerge(jointIxMove, jointIxTransfer));
            alreadyProcessedJointAccIx.add(j);
        });
        skin.joints = newJoints;
    });
}


const TYPE_BYTES = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5124: 4, // not allowed in glTF
    5125: 4,
    5126: 4,
};

/**
 * rapackBuffer must be called. Otherwise, unused buffer will remain allocated.
 * 
 * @param {VrmModel} model to be mutated
 * @param {number} accId inverseBindMatrices accessor id
 * @param {number} newNumJoints
 * @param {Map<number, number>} jointIdMap 
 */
function remapJointMatrices(model, accId, newNumJoints, jointIdMap) {
    console.assert(jointIdMap.size === newNumJoints);

    const matricesAcc = model.gltf.accessors[accId];
    console.assert(matricesAcc.type === "MAT4");
    const blockSize = TYPE_BYTES[matricesAcc.componentType] * 16;

    const buffer = model._getBufferView(matricesAcc.bufferView);
    console.assert(buffer.byteLength === blockSize * matricesAcc.count);
    const newBuffer = new ArrayBuffer(newNumJoints * blockSize);

    const oldView = new Uint8Array(buffer);
    const newView = new Uint8Array(newBuffer);
    for (let i = 0; i < matricesAcc.count; i++) {
        if (!jointIdMap.has(i)) {
            continue;
        }
        const newIx = jointIdMap.get(i);
        newView.set(oldView.slice(i * blockSize, (i + 1) * blockSize), newIx * blockSize);
    }

    matricesAcc.count = newNumJoints;
    model.setBufferData(matricesAcc.bufferView, newBuffer);
}

/**
 * rapackBuffer must be called. Otherwise, unused buffer will remain allocated.
 * 
 * @param {VrmModel} model to be mutated
 * @param {number} jointAccId JOINTS_0 accessor id
 * @param {number} weightAccId WEIGHTS_0 accessor id
 * @param {Map<number, number>} jointIxTransfer: dst+=src; src=0;
 */
function remapWeights(model, jointAccId, weightAccId, jointIxTransfer) {
    const jointData = readVecBuffer(model, jointAccId);
    const weightData = readVecBuffer(model, weightAccId);
    console.assert(jointData.length === weightData.length);
    const numVertex = jointData.length;

    for (let vertIx = 0; vertIx < numVertex; vertIx++) {
        const oldJW = new Map();
        for (let elemIx = 0; elemIx < 4; elemIx++) {
            const j = jointData[vertIx][elemIx];
            const w = weightData[vertIx][elemIx];
            if (j !==0 || w !== 0) {
                oldJW.set(j, w);
            }
        }

        const newJW = new Map(); // key:new joint ix, val:new weight
        for (const [j, w] of oldJW.entries()) {
            if (jointIxTransfer.has(j)) {
                const nj = jointIxTransfer.get(j);
                if (newJW.has(nj)) {
                    newJW.set(nj, newJW.get(nj) + w);
                } else {
                    newJW.set(nj, w);
                }
            }
        }
        console.assert(oldJW.size >= newJW.size);

        const js = [0, 0, 0, 0];
        const ws = [0, 0, 0, 0];
        let njIx = 0;
        for (const [j, w] of newJW.entries()) {
            js[njIx] = j;
            ws[njIx] = w;
            njIx++;
        }
        jointData[vertIx] = js;
        weightData[vertIx] = ws;
    }
    writeVecBuffer(model, jointAccId, jointData);
    writeVecBuffer(model, weightAccId, weightData);
}

/**
 * Delete all blendshape groups.
 * @returns {Promise<void>}
 */
async function stripAllEmotions(model) {
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups = [];
    model.version += 1;
}

/**
 * Strip all label/names for human.
 * @returns {Promise<void>}
 */
async function removeAllNames(model) {
    model.gltf.images.forEach((image, imageIx) => {
        delete image.name;
    });

    // me/v renderer somehow depends on material name constancy.
    // renaming like m1, m2 also doesn't work.
    /*
    model.gltf.materials.forEach((mat, matIx) => {
        mat.name = `m${matIx}`;
    });
    */
    
    model.gltf.meshes.forEach(mesh => {
        delete mesh.name;
        mesh.primitives.forEach(prim => {
            if (prim.extras && prim.extras.targetNames) {
                delete prim.extras.targetNames;
            }
        });
    });
    model.gltf.nodes.forEach(node => {
        delete node.name;
    });
    model.version += 1;
}

/**
 * @returns {Promise<void>}
 */
async function removeUnusedMorphs(model) {
    if (!isUniformPrimitive(model)) {
        console.warn("A mesh in the VRM has multiple primitives with different morphs. removeUnusedMorphs won't be executed.");
        return;
    }

    // Extract pairs to keep
    const usedMeshIdMorphIdPairs = new Set(); // meshId:morphId format.
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.forEach(group => {
        group.binds.forEach(bind => {
            const mesh = model.gltf.meshes[bind.mesh];
            usedMeshIdMorphIdPairs.add(`${bind.mesh}:${bind.index}`);
        });
    });

    // Execute deletion, with delta
    const morphRemap = new Map(); // key=meshId:morphId value=newMorphId
    model.gltf.meshes.forEach((mesh, meshId) => {
        if (mesh.primitives.length === 0 || !mesh.primitives[0].targets) {
            return;
        }

        const numMorphs = mesh.primitives[0].targets.length;
        const newTargets = mesh.primitives.map(_ => []); // for each primitive
        const newExtraTargetNames = mesh.primitives.map(_ => []); // for each primitive

        let newMorphIx = 0;
        for (let morphIx = 0; morphIx < numMorphs; morphIx++) {
            const key = `${meshId}:${morphIx}`;
            if (!usedMeshIdMorphIdPairs.has(key)) {
                continue;
            }

            morphRemap.set(key, newMorphIx);
            mesh.primitives.forEach((prim, primIx) => {
                newTargets[primIx].push(prim.targets[morphIx]);
                newExtraTargetNames.push(
                    (prim.extras && prim.extras.targetNames) ? prim.extras.targetNames[morphIx] : "");
            });
            newMorphIx++;
        }

        mesh.primitives.forEach((prim, primIx) => {
            prim.targets = newTargets[primIx];
            if (prim.extras && prim.extras.targetNames) {
                prim.extras.targetNames = newExtraTargetNames;
            }
        });        
    });
    console.log("Morph remap", morphRemap);

    // Apply delta to blendshapes.
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.forEach(group => {
        group.binds.forEach(bind => {
            const key = `${bind.mesh}:${bind.index}`;
            console.assert(morphRemap.has(key));
            bind.index = morphRemap.get(key);
        });
    });
}

/**
 * @param {VrmModel} model
 * @returns {Promise<void>}
 */
async function removeUnusedAccessors(model) {
    const deps = new VrmDependency(model);
    const usedIds = deps.getDirectlyUsedAccessors();

    const accPacking = new ArrayPacking(usedIds, model.gltf.accessors.length);
    model.gltf.accessors = accPacking.apply(model.gltf.accessors);
    model.gltf.meshes.forEach(mesh => {    
        mesh.primitives.forEach(prim => {
            prim.indices = accPacking.convert(prim.indices);
            const newAttribs = {};
            Object.entries(prim.attributes).forEach(([attribName, accId]) => {
                newAttribs[attribName] = accPacking.convert(accId);
            });
            prim.attributes = newAttribs;

            if (prim.targets) {
                prim.targets = prim.targets.map(target => {
                    const newTarget = {};
                    Object.entries(target).forEach(([attribName, accId]) => {
                        newTarget[attribName] = accPacking.convert(accId);
                    });
                    return newTarget;
                });
            }
        });
    });
    model.gltf.skins.forEach(skin => {
        skin.inverseBindMatrices = accPacking.convert(skin.inverseBindMatrices);
    });
}

/**
 * @returns {Promise<void>}
 */
async function removeUnusedTextures(model) {
    const deps = new VrmDependency(model);
    const texPacking = new ArrayPacking(deps.getDirectlyUsedTextures(), model.gltf.textures.length);

    model.gltf.textures = texPacking.apply(model.gltf.textures);
    if (model.gltf.extensions.VRM.meta && model.gltf.extensions.VRM.meta.texture !== undefined) {
        model.gltf.extensions.VRM.meta.texture = texPacking.convert(model.gltf.extensions.VRM.meta.texture);
    }
    model.gltf.materials.forEach((mat, matId) => {
        const matProps = model.gltf.extensions.VRM.materialProperties;
        if (matProps && matId < matProps.length) {
            Object.entries(matProps[matId].textureProperties).forEach(([propName, texId]) => {
                matProps[matId].textureProperties[propName] = texPacking.convert(texId);
            });
        }

        if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture) {
            const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
            mat.pbrMetallicRoughness.baseColorTexture.index = texPacking.convert(texId);
        }
        if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture) {
            const texId = mat.pbrMetallicRoughness.metallicRoughnessTexture.index;
            mat.pbrMetallicRoughness.metallicRoughnessTexture.index = texPacking.convert(texId);
        }
        if (mat.emissiveTexture) {
            const texId = mat.emissiveTexture.index;
            mat.emissiveTexture.index = texPacking.convert(texId);
        }
    });
}

async function removeUnusedImages(model) {
    const deps = new VrmDependency(model);
    const imgPacking = new ArrayPacking(deps.getDirectlyUsedImages(), model.gltf.images.length);
    model.gltf.images = imgPacking.apply(model.gltf.images);
    model.gltf.textures.forEach(tex => {
        tex.source = imgPacking.convert(tex.source);
    });
}

/**
 * @returns {Promise<void>}
 */
async function removeUnusedBufferViews(model) {
    const deps = new VrmDependency(model);
    const bvPacking = new ArrayPacking(deps.getDirectlyUsedBuffers(), model.gltf.bufferViews.length);
    model.gltf.bufferViews = bvPacking.apply(model.gltf.bufferViews);
    model.gltf.images.forEach(img => {
        img.bufferView = bvPacking.convert(img.bufferView);
    });
    model.gltf.accessors.forEach(accessor => {
        accessor.bufferView = bvPacking.convert(accessor.bufferView);
    });
}

/**
 * @param {VrmModel} model
 * @returns {boolean}
 */
function isUniformPrimitive(model) {
    return model.gltf.meshes.every(mesh => {
        if (mesh.primitives.length === 0) {
            return true;
        }

        const refPrim = mesh.primitives[0];
        return mesh.primitives.every(prim => {
            if (refPrim.targets === undefined) {
                return prim.targets === undefined;
            }
            return prim.targets.length === refPrim.targets.length;
        });
    });
}
