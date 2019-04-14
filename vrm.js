// ES6
import * as vrm_mat from './vrm-materials.js';

/**
 * Serialize glTF JSON & binary buffers into a single binary (GLB format).
 * Spec: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification
 * @return {Promise<ArrayBuffer>}
 */
function serialize_glb(obj) {
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
 * @param {THREE.Object3D} vrm_root, must have .vrm_ext field
 * @return {Promise<ArrayBuffer>} vrm (.glb format) blob
 */
export function serialize_vrm(vrm_root) {
    const exporter = new THREE.GLTFExporter();
    const options = {
        includeCustomExtensions: true,
    };

    const scene = new THREE.Scene();
    // Push directly to children instead of calling `add` to prevent
    // modify the .parent and break its original scene and hierarchy
    scene.children.push(vrm_root);
    const gltf_and_buffers = new Promise((resolve, reject) => {
        exporter.parse(scene, gltf => {
            console.log(gltf);
            resolve(gltf);
        }, options);
    });

    function attach_vrm_extension(gltf_result) {
        console.log("Attaching VRM", vrm_root.vrm_ext, "to", gltf_result);
        if (gltf_result.json.extensionsUsed === undefined) {
            gltf_result.json.extensionsUsed = [];
        }
        if (gltf_result.json.extensions === undefined) {
            gltf_result.json.extensions = {};
        }

        const ref_to_id = new VrmExtensionMapper({
            map_node: node_ref => {
                const node_id = gltf_result.nodeMap.get(node_ref);
                if (node_id === undefined) {
                    console.warn("map_node failed (not found in nodeMap)", node_ref);
                    return 0;
                } else {
                    return node_id;
                }
            },
            map_mesh: mesh_ref => {
                // Looks suspicious. Why skins instead of meshes?
                const skin_id = gltf_result.skins.findIndex(e => e === mesh_ref[0]);
                if (skin_id < 0) {
                    console.warn("map_node failed (not found in skins)", mesh_ref);
                    return 0;
                } else {
                    return skin_id;
                }
            },
            map_texture: tex_ref => {
                console.log("map_texture", tex_ref);
                return 0;
            },
        });

        const ext_with_ids = ref_to_id.convert_vrm(vrm_root.vrm_ext);
        ext_with_ids["exporterVersion"] = "me/v";

        gltf_result.json.extensions["VRM"] = ext_with_ids;
        gltf_result.json.extensionsUsed = Array.from(new Set(["VRM", ...gltf_result.json.extensionsUsed]));
        return gltf_result;
    }

    return gltf_and_buffers.then(attach_vrm_extension).then(serialize_glb);
}

/**
 * 
 * @param {Object} gltf object returned by THREE.GLTFLoader
 * @return {Promise<THREE.Object3D>} will have .vrm_ext field.
 */
export function parse_vrm(gltf) {
    console.log("Parsing glTF as VRM", gltf);

    const data_promise = Promise.all([
        Promise.all(
            new Array(gltf.parser.json.nodes.length).fill().map((_, id) => gltf.parser.getDependency('node', id))),
        Promise.all(
            new Array(gltf.parser.json.meshes.length).fill().map((_, id) => gltf.parser.getDependency('mesh', id))),
        Promise.all(
            new Array((gltf.parser.json.textures || []).length).fill().map((_, id) => gltf.parser.getDependency('texture', id)))]);

    return data_promise.then(value => {
        const [nodes, meshes, textures] = value;
        const ref_to_real = new VrmExtensionMapper({
            map_node: id => nodes[id],
            map_mesh: id => meshes[id],
            map_texture: id => textures[id],
        });
        const vrm = ref_to_real.convert_vrm(gltf.parser.json.extensions.VRM);
        console.log(vrm);

        gltf.parser.json.extensions.VRM.materialProperties.forEach(mat_prop => {
            if (mat_prop.shader === "VRM_USE_GLTFSHADER") {
                return;
            }

            // TODO: Property set morphTargets bool
            const mat = new vrm_mat.VRMShaderMaterial({ morphTargets: false, skinning: true });
            mat.fromMaterialProperty(mat_prop, textures);

            // TODO: This is inefficient. Fix.
            gltf.scene.traverse(obj => {
                if (obj.type !== 'Mesh' && obj.type !== 'SkinnedMesh') {
                    return;
                }
                if (obj.material.name !== mat_prop.name) {
                    return;
                }
                console.log(mat_prop);
                console.log("Fix-Material-VRM", mat, "->", obj);
                obj.material = mat;
            });
        });

        gltf.scene.vrm_ext = vrm;
        return gltf.scene;
    });
}

/**
 * Traversal & mapping of glTF references (node, texture, material) in VRM extension JSON structure.
 */
class VrmExtensionMapper {
    /**
     * @param {Object} mapper, must have following methods: map_node, map_mesh, map_texture
     */
    constructor(mapper) {
        this.mapper = mapper;
    }

    // https://github.com/dwango/UniVRM/blob/master/specification/0.0/schema/vrm.schema.json
    convert_vrm(vrm) {
        return {
            blendShapeMaster: this._convert_blendshape(vrm.blendShapeMaster),
            humanoid: this._convert_humanoid(vrm.humanoid),
            firstPerson: this._convert_firstperson(vrm.firstPerson),
            materialProperties: vrm.materialProperties.map(mat => this._convert_material(mat)),
            meta: vrm.meta,
            secondaryAnimation: {},
        };
    }

    _convert_blendshape(blendshape) {
        return {
            blendShapeGroups:
                blendshape.blendShapeGroups.map(group => this._convert_blendshape_group(group)),
        };
    }

    _convert_blendshape_group(group) {
        return {
            name: group.name,
            presetName: group.presetName,
            binds: group.binds.map(bind => this._convert_blendshape_bind(bind)),
            materialValues: group.materialValues,
        };
    }

    _convert_blendshape_bind(bind) {
        return {
            mesh: this.mapper.map_mesh(bind.mesh),
            index: bind.index, // (probably) morph target index of the mesh.
            weight: bind.weight,
        };
    }

    // https://github.com/dwango/UniVRM/blob/master/specification/0.0/schema/vrm.humanoid.schema.json
    _convert_humanoid(humanoid) {
        return {
            humanBones: humanoid.humanBones.map(bone => this._convert_humanoid_bone(bone)),
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

    _convert_humanoid_bone(bone) {
        return {
            bone: bone.bone,
            node: this.mapper.map_node(bone.node),
            useDefaultValues: bone.useDefaultValues,
            min: bone.min,
            max: bone.max,
            center: bone.center,
            axisLength: bone.axisLength,
        };
    }

    _convert_firstperson(firstperson) {
        return {
            firstPersonBone: this.mapper.map_node(firstperson.firstPersonBone),
            firstPersonBoneOffset: firstperson.firstPersonBoneOffset,
            meshAnnotations: firstperson.meshAnnotations.map(annot => this._convert_firstperson_meshannotation(annot)),
            lookAtTypeName: firstperson.lookAtTypeName,
            lookAtHorizontalInner: firstperson.lookAtHorizontalInner,
            lookAtVerticalDown: firstperson.lookAtVerticalDown,
            lookAtVerticalUp: firstperson.lookAtVerticalUp,
        };
    }

    _convert_firstperson_meshannotation(annot) {
        return {
            mesh: this.mapper.map_mesh(annot.mesh),
            firstPersonFlag: annot.firstPersonFlag,
        };
    }

    _convert_material(mat) {
        const texProp = new Map();
        for (let texName in mat.textureProperties) {
            texProp[texName] = this.mapper.map_texture(mat.textureProperties[texName]);
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
