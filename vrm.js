// ES6
import * as vrm_mat from './vrm-materials.js';

/**
 * Similar to root.traverse(fn), but only executes fn when object is a mesh.
 * @param {THREE.Object3D} root 
 * @param {Function<THREE.Object3D>} fn 
 */
function traverseMesh(root, fn) {
    root.traverse(obj => {
        if (obj.type !== "Mesh" && obj.type !== "SkinnedMesh") {
            return;
        }
        fn(obj);
    });
}

/**
 * Serialize glTF JSON & binary buffers into a single binary (GLB format).
 * Spec: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification
 * @return {Promise<ArrayBuffer>}
 */
function serializeGlb(obj) {
    const outputJSON = obj.json;
    const buffers = obj.buffers;

    function getPaddedBufferSize(bufferSize) {
        return Math.ceil(bufferSize / 4) * 4;
    }

    function getPaddedArrayBuffer(arrayBuffer, paddingByte) {
        paddingByte = paddingByte || 0;
        var paddedLength = getPaddedBufferSize(arrayBuffer.byteLength);
        if (paddedLength === arrayBuffer.byteLength) {
            return arrayBuffer;
        }

        const array = new Uint8Array(paddedLength);
        array.set(new Uint8Array(arrayBuffer));
        if (paddingByte !== 0) {
            for (var i = arrayBuffer.byteLength; i < paddedLength; i++) {
                array[i] = paddingByte;
            }
        }
        return array.buffer;
    }

    // Merge buffers.
    const blob = new Blob(buffers, { type: 'application/octet-stream' });

    // Update bytelength of the single buffer.
    outputJSON.buffers[0].byteLength = blob.size;

    const GLB_HEADER_BYTES = 12;
    const GLB_HEADER_MAGIC = 0x46546C67;
    const GLB_VERSION = 2;

    const GLB_CHUNK_PREFIX_BYTES = 8;
    const GLB_CHUNK_TYPE_JSON = 0x4E4F534A;
    const GLB_CHUNK_TYPE_BIN = 0x004E4942;

    return new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onloadend = function () {
            // Binary chunk.
            var binaryChunk = getPaddedArrayBuffer(reader.result);
            var binaryChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
            binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true);
            binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

            // JSON chunk.
            var jsonChunk = getPaddedArrayBuffer(new TextEncoder().encode(JSON.stringify(outputJSON)).buffer, 0x20);
            var jsonChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
            jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true);
            jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true);

            // GLB header.
            var header = new ArrayBuffer(GLB_HEADER_BYTES);
            var headerView = new DataView(header);
            headerView.setUint32(0, GLB_HEADER_MAGIC, true);
            headerView.setUint32(4, GLB_VERSION, true);
            var totalByteLength = GLB_HEADER_BYTES
                + jsonChunkPrefix.byteLength + jsonChunk.byteLength
                + binaryChunkPrefix.byteLength + binaryChunk.byteLength;
            headerView.setUint32(8, totalByteLength, true);

            var glbBlob = new Blob([
                header,
                jsonChunkPrefix,
                jsonChunk,
                binaryChunkPrefix,
                binaryChunk
            ], { type: 'application/octet-stream' });

            var glbReader = new window.FileReader();
            glbReader.readAsArrayBuffer(glbBlob);
            glbReader.onloadend = function () {
                resolve(glbReader.result);
            };
        };
        reader.readAsArrayBuffer(blob);
    });
}

/**
 * @param {THREE.Object3D} vrmRoot, must have .vrm_ext field
 * @return {Promise<ArrayBuffer>} vrm (.glb format) blob
 */
export function serializeVrm(vrmRoot) {
    const exporter = new THREE.GLTFExporter();
    const options = {
        includeCustomExtensions: true,
    };

    const scene = new THREE.Scene();
    // Push directly to children instead of calling `add` to prevent
    // modify the .parent and break its original scene and hierarchy
    scene.children.push(vrmRoot);
    const gltf_and_buffers = new Promise((resolve, reject) => {
        exporter.parse(scene, gltf => {
            console.log(gltf);
            resolve(gltf);
        }, options);
    });

    function attachVrmExtension(gltfResult) {
        console.log("Attaching VRM", vrmRoot.vrmExt, "to", gltfResult);
        if (gltfResult.json.extensionsUsed === undefined) {
            gltfResult.json.extensionsUsed = [];
        }
        if (gltfResult.json.extensions === undefined) {
            gltfResult.json.extensions = {};
        }

        const refToId = new VrmExtensionMapper({
            mapNode: nodeRef => {
                const nodeId = gltfResult.nodeMap.get(nodeRef);
                if (nodeId === undefined) {
                    console.warn("mapNode failed (not found in nodeMap)", nodeRef);
                    return 0;
                } else {
                    return nodeId;
                }
            },
            mapMesh: meshRef => {
                // Looks suspicious. Why skins instead of meshes?
                const skinId = gltfResult.skins.findIndex(e => e === meshRef[0]);
                if (skinId < 0) {
                    console.error("mapNode failed (not found in skins)", meshRef);
                    return 0;
                } else {
                    return skinId;
                }
            },
            mapTexture: texRef => {
                for (const [tex, texId] of gltfResult.cachedData.textures.entries()) {
                    if (texRef === tex) {
                        return texId;
                    }
                }
                console.error("mapTexture failed (not found)", texRef);
                return 0;
            },
        });

        const extWithIds = refToId.convertVrm(vrmRoot.vrmExt);
        extWithIds["exporterVersion"] = "me/v";

        gltfResult.json.extensions["VRM"] = extWithIds;
        gltfResult.json.extensionsUsed = Array.from(new Set(["VRM", ...gltfResult.json.extensionsUsed]));
        return gltfResult;
    }

    return gltf_and_buffers.then(attachVrmExtension).then(serializeGlb);
}

/**
 * Deserialize VRM blob and return root of three.js object with .vrmExt field.
 * @param {ArrayBuffer} data 
 * @return {Promise<THREE.Object3D>} VRM root
 */
export function deserializeVrm(data) {
    return new Promise((resolve, reject) => {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.parse(
            data,
            "", // path
            gltfJson => {
                parseVrm(gltfJson).then(resolve);
            },
            reject);
    });
}

/**
 * 
 * @param {Object} gltf object returned by THREE.GLTFLoader
 * @return {Promise<THREE.Object3D>} will have .vrmExt field.
 */
function parseVrm(gltf) {
    console.log("Parsing glTF as VRM", gltf);

    const dataPromise = Promise.all([
        Promise.all(
            new Array(gltf.parser.json.nodes.length).fill().map((_, id) => gltf.parser.getDependency('node', id))),
        Promise.all(
            new Array(gltf.parser.json.meshes.length).fill().map((_, id) => gltf.parser.getDependency('mesh', id))),
        Promise.all(
            new Array((gltf.parser.json.textures || []).length).fill().map((_, id) => gltf.parser.getDependency('texture', id)))]);

    return dataPromise.then(value => {
        const [nodes, meshes, textures] = value;
        const ref_to_real = new VrmExtensionMapper({
            mapNode: id => nodes[id],
            mapMesh: id => meshes[id],
            mapTexture: id => textures[id],
        });
        const vrm = ref_to_real.convertVrm(gltf.parser.json.extensions.VRM);

        gltf.parser.json.extensions.VRM.materialProperties.forEach(matProp => {
            if (matProp.shader === "VRM_USE_GLTFSHADER") {
                return;
            }

            // Check if this material is being applied to morphable mesh or not.
            const stats = {
                numMorphable: 0,
                numNonMorphable: 0,
            };
            traverseMesh(gltf.scene, mesh => {
                if (mesh.material.name !== matProp.name) {
                    return;
                }
                if (mesh.morphTargetInfluences) {
                    stats.numMorphable++;
                } else {
                    stats.numNonMorphable++;
                }
            });

            // Fix materials.
            const matMorphable = stats.numMorphable > 0 ? new vrm_mat.VRMShaderMaterial({ morphTargets: true, skinning: true }, matProp, textures) : null;
            const matNonMorphable = stats.numNonMorphable > 0 ? new vrm_mat.VRMShaderMaterial({ morphTargets: false, skinning: true }, matProp, textures) : null;
            traverseMesh(gltf.scene, mesh => {
                if (mesh.material.name !== matProp.name) {
                    return;
                }
                if (mesh.morphTargetInfluences) {
                    mesh.material = matMorphable;
                } else {
                    mesh.material = matNonMorphable;
                }
            });
        });

        gltf.scene.vrmExt = vrm;
        return gltf.scene;
    });
}

/**
 * Traversal & mapping of glTF references (node, texture, material) in VRM extension JSON structure.
 */
class VrmExtensionMapper {
    /**
     * @param {Object} mapper, must have following methods: mapNode, mapMesh, mapTexture
     */
    constructor(mapper) {
        this.mapper = mapper;
    }

    // https://github.com/dwango/UniVRM/blob/master/specification/0.0/schema/vrm.schema.json
    convertVrm(vrm) {
        return {
            blendShapeMaster: this._convertBlendshape(vrm.blendShapeMaster),
            humanoid: this._convertHumanoid(vrm.humanoid),
            firstPerson: this._convertFirstperson(vrm.firstPerson),
            materialProperties: vrm.materialProperties.map(mat => this._convertMaterial(mat)),
            meta: vrm.meta, // TODO: meta.texture contains thumbnail image ref. Need to use mapTexture
            secondaryAnimation: {},
        };
    }

    _convertBlendshape(blendshape) {
        return {
            blendShapeGroups:
                blendshape.blendShapeGroups.map(group => this._convertBlendshapeGroup(group)),
        };
    }

    _convertBlendshapeGroup(group) {
        return {
            name: group.name,
            presetName: group.presetName,
            binds: group.binds.map(bind => this._convertBlendshapeBind(bind)),
            materialValues: group.materialValues,
        };
    }

    _convertBlendshapeBind(bind) {
        return {
            mesh: this.mapper.mapMesh(bind.mesh),
            index: bind.index, // (probably) morph target index of the mesh.
            weight: bind.weight,
        };
    }

    // https://github.com/dwango/UniVRM/blob/master/specification/0.0/schema/vrm.humanoid.schema.json
    _convertHumanoid(humanoid) {
        return {
            humanBones: humanoid.humanBones.map(bone => this._convertHumanoidBone(bone)),
            armStretch: humanoid.armStretch,
            legStretch: humanoid.legStretch,
            upperArmTwist: humanoid.upperArmTwist,
            lowerArmTwist: humanoid.lowerArmTwist,
            upperLegTwist: humanoid.upperLegTwist,
            lowerLegTwist: humanoid.lowerLegTwist,
            feetSpacing: humanoid.feetSpacing,
            hasTranslationDoF: humanoid.hasTranslationDoF, // is this ever true?
        };
    }

    _convertHumanoidBone(bone) {
        return {
            bone: bone.bone,
            node: this.mapper.mapNode(bone.node),
            useDefaultValues: bone.useDefaultValues,
            min: bone.min,
            max: bone.max,
            center: bone.center,
            axisLength: bone.axisLength,
        };
    }

    _convertFirstperson(firstperson) {
        return {
            firstPersonBone: this.mapper.mapNode(firstperson.firstPersonBone),
            firstPersonBoneOffset: firstperson.firstPersonBoneOffset,
            meshAnnotations: firstperson.meshAnnotations.map(annot => this._convertFirstpersonMeshannotation(annot)),
            lookAtTypeName: firstperson.lookAtTypeName,
            lookAtHorizontalInner: firstperson.lookAtHorizontalInner,
            lookAtVerticalDown: firstperson.lookAtVerticalDown,
            lookAtVerticalUp: firstperson.lookAtVerticalUp,
        };
    }

    _convertFirstpersonMeshannotation(annot) {
        return {
            mesh: this.mapper.mapMesh(annot.mesh),
            firstPersonFlag: annot.firstPersonFlag,
        };
    }

    _convertMaterial(mat) {
        const texProp = new Map();
        for (let texName in mat.textureProperties) {
            texProp[texName] = this.mapper.mapTexture(mat.textureProperties[texName]);
        }
        // Spec says "object", but textureProperties actually refers to glTF textures.
        return {
            name: mat.name,
            shader: mat.shader,
            renderQueue: mat.renderQueue,
            floatProperties: mat.floatProperties,
            vectorProperties: mat.vectorProperties,
            textureProperties: texProp,
            keywordMap: mat.keywordMap,
            tagMap: mat.tagMap,
        };
    }
}
