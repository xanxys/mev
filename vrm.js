// ES6
import * as vrm_mat from './vrm-materials.js';
import { deserializeGlb, serializeGlb } from './gltf.js';
import { GLTFLoader, WEBGL_CONSTANTS } from './gltf-three.js';

import { blendshapeToEmotionId } from '../mev-util.js';

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
        this.repackBuffer0AssumingNonOverlappingBufferViews();
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
        this.gltf.buffers[bufferIx] = newByteBuffer.byteLength;
        this.version++;
        return {
            buffer: bufferIx,
            byteOffset: oldBuffer.byteLength,
            byteLength: data.byteLength,
        };
    }

    repackBuffer0AssumingNonOverlappingBufferViews() {
        // TODO: implement
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
        if (primitive.mode === WEBGL_CONSTANTS.TRIANGLES) {
            const accessor = this.gltf.accessors[primitive.indices];
            return accessor.count / 3;
        }
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
     * @param {number} bufferViewOx: glTF bufferView index
     * @returns {ArrayBuffer}: immutable blob slice
     */
    _getBufferView(bufferViewIx) {
        const bufferView = this.gltf.bufferViews[bufferViewIx];
        return this.buffers[bufferView.buffer].slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);
    }
}

/**
 * Single instantiated view of a VrmModel as a positionable THREE.Object3D.
 * Possibly caches THREE.Object3D / Texture etc for quick invalidate.
 */
export class VrmRenderer {
    constructor(model) {
        this.model = model;
        this.currentEmotionId = "neutral";

        this.instance = null;
        this.instanceContainer = null;
    }

    setCurrentEmotionId(emotionId) {
        this.currentEmotionId = emotionId;
    }

    /** Returns a singleton correponding to the model. No need to re-fetch after invalidate(). */
    getThreeInstance() {
        return this.instance;
    }

    getThreeInstanceAsync() {
        if (this.instance !== null) {
            return Promise.resolve(this.instance);
        }

        const gltfLoader = new GLTFLoader();
        return gltfLoader.parse(this.model.gltf, this.model.buffers[0]).then(parseVrm).then(instance => {
            this.instance = instance;
            if (this.instanceContainer !== null) {
                console.log("Re-inserting three instance");
                this.instanceContainer.add(instance);
            }
            return instance;
        });
    }

    getMeshByIndex(meshIndex) {
        return this.instance.mapper.mapper.mapMesh(meshIndex);
    }

    /** Notifies that underlying model was updated, and instance needs to change. */
    invalidate() {
        this.instanceContainer = this.instance.parent;
        this.instanceContainer.remove(this.instance);
        this.instance = null;
        this.getThreeInstanceAsync();
    }

    invalidateWeight() {
        // Reset all morph.
        traverseMorphableMesh(this.instance, mesh => mesh.morphTargetInfluences.fill(0));

        const currentBlendshape = this.model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups
            .find(bs => blendshapeToEmotionId(bs) === this.currentEmotionId);
        if (currentBlendshape === undefined) {
            return;
        }

        currentBlendshape.binds.forEach(bind => {
            traverseMorphableMesh(this.getMeshByIndex(bind.mesh), mesh => {
                mesh.morphTargetInfluences[bind.index] = bind.weight * 0.01;  // % -> actual number
            });
        });
    }
}

/**
 * Similar to root.traverse(fn), but only executes fn when object is morphable mesh.
 * @param {THREE.Object3D} root 
 * @param {Function<THREE.Object3D>} fn 
 */
function traverseMorphableMesh(root, fn) {
    root.traverse(obj => {
        if (obj.type !== "Mesh" && obj.type !== "SkinnedMesh") {
            return;
        }
        if (!obj.morphTargetInfluences) {
            return;
        }
        fn(obj);
    });
}

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
 * 
 * @param {Object} gltf object returned by THREE.GLTFLoader
 * @return {Promise<THREE.Object3D>} will have .vrmExt & .mapper field.
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
        gltf.scene.mapper = ref_to_real;
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
