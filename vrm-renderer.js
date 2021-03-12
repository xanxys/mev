// ES6
import * as vrm_mat from './vrm-materials.js';
import { GLTFLoader } from './gltf-three.js';
import { VrmModel } from './vrm-core/vrm.js';
import { blendshapeToEmotionId } from './mev-util.js';

/**
 * Single instantiated view of a VrmModel as a positionable THREE.Object3D.
 * Possibly caches THREE.Object3D / Texture etc for quick invalidate.
 */
export class VrmRenderer {
    /**
     * @param {VrmModel} model 
     */
    constructor(model) {
        this.model = model;
        this.currentEmotionId = "neutral";

        this.instance = null;
        this.instanceContainer = null;

        this.originalMaterials = new Map(); // key: Object3D ID, value: material instance
        this.wireframeMaterials = new Map(); // key: Object3D ID, value: material instance
    }

    setCurrentEmotionId(emotionId) {
        this.currentEmotionId = emotionId;
    }

    setWireframe(wireframeEnabled) {
        traverseMesh(this.instance, meshObj => {
            const matKey = meshObj.uuid;
            const matCache = wireframeEnabled ? this.wireframeMaterials : this.originalMaterials;
            if (matCache.has(matKey)) {
                meshObj.material = matCache.get(matKey);
            }
        });
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
            this.generateWireframeMaterials();
            return instance;
        });
    }

    generateWireframeMaterials() {
        let wireframeMaterialsCache = new Map(); // key: original material uuid, value: wireframe material instance

        traverseMesh(this.instance, meshObj => {
            const origMatId = meshObj.material.uuid;
            let wireframeMat;
            if (wireframeMaterialsCache.has(origMatId)) {
                wireframeMat = wireframeMaterialsCache.get(origMatId);
            } else {
                const mat = meshObj.material;
                wireframeMat = new THREE.MeshBasicMaterial({
                    wireframe: true,
                    skinning: mat.skinning,
                    map: mat.map,
                }); 
                wireframeMaterialsCache.set(origMatId, wireframeMat);
            }

            this.originalMaterials.set(meshObj.uuid, meshObj.material);
            this.wireframeMaterials.set(meshObj.uuid, wireframeMat);
        });
    }

    getMeshByIndex(meshIndex) {
        return this.instance.mapper.mapper.mapMesh(meshIndex);
    }

    getNodeByIndex(nodeIndex) {
        return this.instance.mapper.mapper.mapNode(nodeIndex);
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
                (blendshape.blendShapeGroups ?? []).map(group => this._convertBlendshapeGroup(group)),
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
            humanBones: (humanoid.humanBones ?? []).map(bone => this._convertHumanoidBone(bone)),
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
        let fp = {
            firstPersonBone: this.mapper.mapNode(firstperson.firstPersonBone),
            firstPersonBoneOffset: firstperson.firstPersonBoneOffset,
            
            lookAtTypeName: firstperson.lookAtTypeName,
            lookAtHorizontalInner: firstperson.lookAtHorizontalInner,
            lookAtVerticalDown: firstperson.lookAtVerticalDown,
            lookAtVerticalUp: firstperson.lookAtVerticalUp,
        };
        if (firstperson.meshAnnotations !== undefined) {
            fp.meshAnnotations = firstperson.meshAnnotations.map(annot => this._convertFirstpersonMeshannotation(annot));
        }
        return fp;
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
