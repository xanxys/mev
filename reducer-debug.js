// ES6
import { setupStartDialog } from './components/start-dialog.js';

/**
 * Handle main editor UI & all state. Start dialog is NOT part of this class.
 * 
 * Design:
 *  - Canonical VRM data = VrmModel
 *  - Converter = Converts "VRM data" into ViewModel quickly, realtime.
 *  - Vue data = ViewModel. Write-operation directly goes to VRM data (and notifies converter).
 * 
 * Weight: 0~1.0(vue.js/three.js) 0~100(UI/Unity/VRM). These are typical values, they can be negative or 100+.
 */
// TODO: For some reason, computed methods are called every frame. Maybe some internal property in three.js is changing
// every frame? this is not good for performance, but is acceptable for now...
class MevReducerDebugger {
    constructor(width, height, canvasInsertionParent) {
        // Three.js canvas
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 50);
        this.camera.position.set(0, 1, -3);
        this.camera.lookAt(0, 0.9, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        // Recommended gamma values from https://threejs.org/docs/#examples/loaders/GLTFLoader
        this.renderer.gammaOutput = true;  // If set, then it expects that all textures and colors need to be outputted in premultiplied gamma.
        this.renderer.gammaFactor = 2.2;
        this.renderer.setSize(width, height);
        canvasInsertionParent.appendChild(this.renderer.domElement);
        window.onresize = _event => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.renderer.setSize(w, h);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        };

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        this.renderer.setClearColor(new THREE.Color("#f5f5f5"));
        this.scene.add(new THREE.DirectionalLight(0xffffff, 1.0));
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.3));

        // Overlay UI
        const app = this;
        this.vm = new Vue({
            el: '#vue_menu',
            data: {
                // Global
                startedLoading: false,
                vrmRoot: null, // VrmModel

                // UI mode
                isFatalError: false,
            },
            methods: {
                updateVrm: function (newVrm) {
                    this.vrmRoot = newVrm;
                    app.vrmRenderer.invalidate();
                },
                refreshPage: function () {
                    location.reload();
                },
                clickStep: function() {

                },
            },
            computed: {
                // Main page state "converter".
                finalVrmTris: function () {
                    if (this.vrmRoot === null) {
                        return "";
                    }
                    return "△" + this.vrmRoot.countTotalTris();
                },
                allWeightCandidates: function () {
                    var candidates = [];
                    this.vrmRoot.gltf.meshes.forEach((mesh, meshIndex) => {
                        mesh.primitives.forEach(prim => {
                            if (!prim.extras) {
                                return;
                            }
                            prim.extras.targetNames.forEach((morphName, morphIndex) => {
                                candidates.push({
                                    // Maybe this can be moved to menu-section-emotion?
                                    mesh: app.vrmRenderer.getMeshByIndex(meshIndex),
                                    meshIndex: meshIndex,
                                    morphIndex: morphIndex,
                                    morphName: morphName,
                                });
                            });
                        });
                    });
                    return candidates;
                },
                blendshapeMaster: function () {
                    if (this.vrmRoot === null) {
                        return null;
                    }
                    return this.vrmRoot.gltf.extensions.VRM.blendShapeMaster;
                },
                // Deprecated: Use emotionGroups
                blendshapes: function () {
                    if (this.vrmRoot === null) {
                        return [];
                    }
                    this.vrmRoot.version;

                    return this.vrmRoot.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.map(bs => {
                        const binds = bs.binds.map(bind => {
                            const mesh = this.vrmRoot.gltf.meshes[bind.mesh];
                            return {
                                meshName: mesh.name,
                                meshIndex: bind.mesh,
                                morphName: mesh.primitives[0].extras.targetNames[bind.index],
                                morphIndex: bind.index,
                                weight: bind.weight,
                            };
                        });
                        return {
                            id: blendshapeToEmotionId(bs),
                            label: bs.presetName !== "unknown" ? EMOTION_PRESET_NAME_TO_LABEL[bs.presetName] : bs.name,
                            presetName: bs.presetName,  // "unknown" can appear more than once
                            weightConfigs: binds,
                        };
                    });
                },
                emotionGroups: function () {
                    if (this.vrmRoot == null) {
                        return [];
                    }

                    const knownNames = new Set(flatten(EMOTION_PRESET_GROUPING));

                    const nameToBlendshape = new Map(this.blendshapes.map(bs => [bs.presetName, bs]));
                    const groups = EMOTION_PRESET_GROUPING.map(defaultGroupDef => {
                        return defaultGroupDef.map(name => {
                            if (nameToBlendshape.has(name)) {
                                const bs = nameToBlendshape.get(name);
                                return {
                                    id: bs.id,
                                    label: bs.label,
                                    weightConfigs: bs.weightConfigs,
                                };
                            } else {
                                console.warn("The VRM is missing standard blendshape preset: " + name + ". Creating new one.");
                                return {
                                    id: name,
                                    label: EMOTION_PRESET_NAME_TO_LABEL[name],
                                    weightConfigs: [],
                                };
                            }
                        });
                    }
                    );
                    const unknownGroup = [];
                    this.blendshapes.forEach(bs => {
                        if (knownNames.has(bs.presetName)) {
                            return;
                        }
                        // All unknown blendshape presetName must be unknown.
                        if (bs.presetName !== "unknown") {
                            console.warn("Non-comformant emotion preset name found, treating as 'unknown'", bs.presetName)
                        }

                        unknownGroup.push({
                            id: bs.id,
                            label: bs.label,
                            weightConfigs: bs.weightConfigs,
                        });
                    });
                    if (unknownGroup.length > 0) {
                        groups.push(unknownGroup);
                    }
                    return groups;
                },
                currentWeightConfigs: function () {
                    const nameToBlendshape = new Map(this.blendshapes.map(bs => [bs.id, bs]));
                    const blendshape = nameToBlendshape.get(this.currentEmotionId);
                    return blendshape ? blendshape.weightConfigs : [];
                },
                springs: function () {
                    if (this.vrmRoot === null) {
                        return [];
                    }
                    const secAnim = this.vrmRoot.gltf.extensions.VRM.secondaryAnimation;
                    return (secAnim.boneGroups.concat(secAnim.colliderGroups)).map(g => JSON.stringify(g));
                },
                parts: function () {
                    if (this.vrmRoot === null) {
                        return [];
                    }
                    this.vrmRoot.version; // force depend

                    const parts = [];
                    this.vrmRoot.gltf.meshes.forEach((mesh, meshIx) => {
                        mesh.primitives.forEach((prim, primIx) => {
                            const mat = this.vrmRoot.gltf.materials[prim.material];
                            const part = {
                                visibility: true,
                                // (meshIx, primIx) act as VRM-global prim id.
                                meshIx: meshIx,
                                primIx: primIx,
                                name: mesh.name + ":" + primIx,
                                shaderName: MevReducerDebugger._getShaderNameFromMaterial(this.vrmRoot, prim.material),
                                imageId: -1,
                                textureUrl: null,
                                numTris: "△" + this.vrmRoot.countPrimitiveTris(prim),
                            };

                            if (mat.pbrMetallicRoughness.baseColorTexture !== undefined) {
                                const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
                                const imageId = this.vrmRoot.gltf.textures[texId].source;
                                part.imageId = imageId;
                                part.textureUrl = this.vrmRoot.getImageAsDataUrl(imageId);
                            }

                            parts.push(part);
                        });
                    });
                    return parts;
                },
                partsForCurrentImage: function () {
                    return this.parts.filter(part => part.imageId === this.currentImageId);
                },
                vrmRenderer: function () {
                    return app.vrmRenderer;
                },
            },
        });
    }

    /** Executes and renders single frame and request next frame. */
    animate() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.animate());
    }

    loadFbxOrVrm(vrmFile) {
        const isFbx = vrmFile.name.toLowerCase().endsWith('.fbx');
        this.vm.startedLoading = true;
        if (isFbx) {
            // Not supported
            return;
        }

        const vrmExtIndex = vrmFile.name.toLowerCase().lastIndexOf(".vrm");
        this.vm.avatarName = vrmExtIndex >= 0 ? vrmFile.name.substr(0, vrmExtIndex) : vrmFile.name;

        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;

        // VRM
        reader.addEventListener("load", () => {
            VrmModel.deserialize(reader.result).then(vrmModel => {
                app.vrmRenderer = new VrmRenderer(vrmModel);  // Non-Vue binder of vrmModel.
                app.vrmRenderer.getThreeInstanceAsync().then(instance => {
                    this.scene.add(instance);
                    // Ideally, this shouldn't need to wait for instance.
                    // But current MevReducerDebugger VM depends A LOT on Three instance...
                    app.vm.vrmRoot = vrmModel; // Vue binder of vrmModel.
                });
            });
        });
        reader.readAsArrayBuffer(vrmFile);
    }
}

function main() {
    const app = new MevReducerDebugger(window.innerWidth, window.innerHeight, document.body);
    setupStartDialog(file => {
        document.getElementById("vue_menu").style.display = "";
        app.loadFbxOrVrm(file);
    });
    app.animate();
}

main();