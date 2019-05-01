// ES6
import { parseVrm, serializeVrm } from './vrm.js';
import { vrmMaterials } from './vrm-materials.js';

/**
 * Converts {THREE.Object3D} into human-readable object tree.
 */
function objectToTreeDebug(obj) {
    function convert_node(o) {
        return {
            name: o.name,
            type: o.type,
            children: o.children.map(convert_node),
        };
    }
    return JSON.stringify(convert_node(obj), null, 2);
}

/**
 * Flatten array of array into an array.
 * `[[1, 2], [3]] -> [1, 2, 3]`
 */
function flatten(arr) {
    return [].concat.apply([], arr);
}

/**
 * Handle main editor UI & all state. Start dialog is NOT part of this class.
 * 
 * Design:
 *  - Canonical VRM data = THREE.Object3D.
 *  - Converter = Converts "VRM data" into ViewModel quickly, realtime.
 *  - Vue data = ViewModel. Write-operation directly goes to VRM data (and notifies converter).
 */
// TODO: For some reason, computed methods are called every frame. Maybe some internal property in three.js is changing
// every frame? this is not good for performance, but is acceptable for now...
class MevApplication {
    constructor(width, height, canvasInsertionParent) {
        // Three.js canvas
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 50);
        this.camera.position.set(0, 1, -3);
        this.camera.lookAt(0, 0.9, 0);

        this.renderer = new THREE.WebGLRenderer();
        // Recommended gamma values from https://threejs.org/docs/#examples/loaders/GLTFLoader
        this.renderer.gammaOutput = true;  // If set, then it expects that all textures and colors need to be outputted in premultiplied gamma.
        this.renderer.gammaFactor = 2.2;
        this.renderer.setSize(width, height);
        this.renderer.antialias = true;
        canvasInsertionParent.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        this.renderer.setClearColor(new THREE.Color("#f5f5f5"));
        this.scene.add(this._create_stage());
        this.scene.add(new THREE.DirectionalLight(0xffffff, 1.0));
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.3));

        // Overlay UI
        const app = this;
        const scene = this.scene;
        Vue.component(
            "menu-section-emotion", {
                template: "#menu_section_emotion",
                data: function () {
                    return {
                        weightConfigs: [],
                    };
                },
                methods: {
                },
            },
        );
        this.vm = new Vue({
            el: '#vue_menu',
            data: {
                // Global
                vrmRoot: null,
                showEmotionPane: false,

                // Main Pane
                avatarName: "",
                avatarHeight: "",
                currentEmotion: "Neutral",
                finalVrmSizeApprox: "",

                // Emotion-Edit Pane
                editingEmotionLabel: "",
            },
            watch: {
                vrmRoot: function (newValue, oldValue) {
                    if (!this.avatarHeight) {
                        this._computeAvatarHeight();
                    }
                },
            },
            methods: {
                clickEmotion: function (emotionLabel) {
                    if (this.currentEmotion === emotionLabel) {
                        this.editingEmotionLabel = emotionLabel;
                        this.showEmotionPane = true;
                    } else {
                        this.currentEmotion = emotionLabel;
                    }
                },
                calculateFinalSizeAsync: function () {
                    serializeVrm(this.vrmRoot).then(glbBuffer => {
                        this.finalVrmSizeApprox = (glbBuffer.byteLength * 1e-6).toFixed(1) + "MB";
                    });
                },
                downloadVrm: function (event) {
                    console.log("Download requested");
                    serializeVrm(app.vrmRoot).then(glbBuffer => {
                        saveAs(new Blob([glbBuffer], { type: "application/octet-stream" }), "test.vrm");
                    });
                },
                toggleVisible: function (partName) {
                    // TODO: Think whether we should use flattened objects everywhere or retain tree.
                    const flattenedObjects = [];
                    app.vrmRoot.traverse(o => flattenedObjects.push(o));

                    flattenedObjects.filter(obj => obj.type === 'Mesh' || obj.type === 'SkinnedMesh')
                        .forEach(mesh => {
                            if (mesh.name === partName) {
                                mesh.visible = !mesh.visible;
                            }
                        });
                },
                clickBackButton: function () {
                    this.showEmotionPane = false;
                },
                _computeAvatarHeight: function () {
                    // For some reason, according to profiler,
                    // this method is computed every frame unlike others (e.g. finalVrmTris, blendshapes, parts).
                    // Maybe because this is using this.vrmRoot directly, and some filed in vrmRoot is changing every frame?
                    if (this.vrmRoot === null) {
                        return "";
                    }
                    this.avatarHeight = (new THREE.Box3().setFromObject(this.vrmRoot)).getSize(new THREE.Vector3()).y.toFixed(2) + "m";
                }
            },
            computed: {
                // Toolbar & global pane state.
                toolbarTitle: function () {
                    if (this.showEmotionPane) {
                        return "表情:" + this.editingEmotionLabel;
                    } else {
                        return this.avatarName;
                    }
                },
                showBackButton: function () {
                    return this.showEmotionPane;
                },
                showMainPane: function () {
                    return !this.showEmotionPane;
                },

                // Main page state "converter".
                finalVrmTris: function () {
                    if (this.vrmRoot === null) {
                        return "";
                    }
                    const stats = { numTris: 0 };
                    this.vrmRoot.traverse(obj => {
                        if (obj.type === 'Mesh' || obj.type === 'SkinnedMesh') {
                            const numVerts = obj.geometry.index === null ? obj.geometry.attributes.position.count : obj.geometry.index.count;
                            if (numVerts % 3 != 0) {
                                console.warn("Unexpected GeometryBuffer format. Seems to contain non-triangles");
                            }
                            stats.numTris += Math.floor(numVerts / 3);
                        }
                    });
                    return "△" + stats.numTris;
                },
                // Deprecated: Use emotionGroups
                blendshapes: function () {
                    if (this.vrmRoot === null) {
                        return [];
                    }
                    return this.vrmRoot.vrmExt.blendShapeMaster.blendShapeGroups.map(bs => {
                        const binds = bs.binds.map(bind => {
                            const targetMesh = (bind.mesh.type === "Group") ? bind.mesh.children[0] : bind.mesh;
                            const morphIndexToName = {};
                            Object.keys(targetMesh.morphTargetDictionary).forEach(key => {
                                morphIndexToName[targetMesh.morphTargetDictionary[key]] = key;
                            });
                            return {
                                m: bind.mesh.name,
                                b: morphIndexToName[bind.index],
                                w: bind.weight,
                            };
                        });
                        return {
                            name: bs.presetName,
                            content: JSON.stringify(binds),
                        };
                    });
                },
                emotionGroups: function () {
                    console.log(this.blendshapes);
                    const defaultGrouping = [
                        ["neutral"],
                        ["a", "i", "u", "e", "o"],
                        ["joy", "angry", "sorrow", "fun"],
                        ["blink", "blink_l", "blink_r"],
                        ["lookleft", "lookright", "lookup", "lookdown"],
                        // All unknown will go into the last group.
                    ];
                    const presetNameToUi = {
                        "neutral": "標準",
                        "a": "あ",
                        "i": "い",
                        "u": "う",
                        "e": "え",
                        "o": "お",
                        "joy": "喜",
                        "angry": "怒",
                        "sorrow": "哀",
                        "fun": "楽",
                        "blink": "瞬目",
                        "blink_l": "瞬目:左",
                        "blink_r": "瞬目:右",
                        // TODO: isn't this left-right etc. technical limitation of Unity? (i.e. not being able to set negative weight)?
                        // Better to automate by detecting symmetry.
                        "lookleft": "視線←",
                        "lookright": "視線→",
                        "lookup": "視線↑",
                        "lookdown": "視線↓",
                    }
                    const knownNames = new Set(flatten(defaultGrouping));

                    const nameToBlendshape = new Map(this.blendshapes.map(bs => [bs.name, bs]));
                    const groups = defaultGrouping.map(defaultGroupDef => {
                        return defaultGroupDef.map(name => {
                            if (nameToBlendshape.has(name)) {
                                return {
                                    presetName: name,
                                    label: presetNameToUi[name],
                                    content: nameToBlendshape[name],
                                };
                            } else {
                                console.warn("The VRM is missing standard blendshape preset: " + name + ". Creating new one.");
                                return {
                                    presetName: name,
                                    label: presetNameToUi[name],
                                    content: [],
                                };
                            }
                        });
                    }
                    );
                    const unknownGroup = [];
                    this.blendshapes.forEach(bs => {
                        if (!knownNames.has(bs.name)) {
                            unknownGroup.push({
                                presetName: bs.name,
                                label: bs.name,
                                content: bs.content,
                            });
                        }
                    });
                    if (unknownGroup.length > 0) {
                        groups.push(unknownGroup);
                    }

                    return groups;
                },
                parts: function () {
                    if (this.vrmRoot === null) {
                        return [];
                    }
                    const blendShapeMeshes = new Set();
                    if (this.vrmRoot.vrmExt !== undefined) {
                        this.vrmRoot.vrmExt.blendShapeMaster.blendShapeGroups.forEach(group => {
                            group.binds.forEach(bind => blendShapeMeshes.add(bind.mesh));
                        });
                    }

                    const flattenedObjects = [];
                    this.vrmRoot.traverse(o => flattenedObjects.push(o));
                    return flattenedObjects
                        .filter(obj => obj.type === 'Mesh' || obj.type === 'SkinnedMesh')
                        .map(mesh => {
                            const numVerts = mesh.geometry.index === null ? mesh.geometry.attributes.position.count : mesh.geometry.index.count;
                            const numTris = Math.floor(numVerts / 3);
                            return {
                                visibility: (mesh.visible ? "☒" : "☐") + (blendShapeMeshes.has(mesh) ? "BS" : ""),
                                name: mesh.name,
                                shaderName: mesh.material.shaderName,
                                textureUrl: (!mesh.material.map || !mesh.material.map.image) ? null : MevApplication._convertImageToDataUrlWithHeight(mesh.material.map.image, 48),
                                numTris: "△" + numTris,
                            };
                        });
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

    // It's very clear now that we need somewhat complex FBX -> VRM converter (even some UI to resolve ambiguity).
    // For now, assume FBX load show some object in the scene (sometimes) but UI functionality is broken because
    // its vrmRoot object lack VRM structure.
    loadFbxOrVrm(vrmFile) {
        const isFbx = vrmFile.name.toLowerCase().endsWith('.fbx');
        this.vm.avatarName = vrmFile.name;

        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;
        const scene = this.scene;
        reader.addEventListener('load', () => {
            if (isFbx) {
                const fbxLoader = new THREE.FBXLoader();
                fbxLoader.load(
                    reader.result,
                    fbx => {
                        console.log("FBX loaded", fbx);
                        const bb_size = new THREE.Box3().setFromObject(fbx).getSize();
                        const max_len = Math.max(bb_size.x, bb_size.y, bb_size.z);
                        // heuristics: Try to fit in 0.1m~9.9m. (=log10(max_len * K) should be 0.XXX)
                        // const scale_factor = Math.pow(10, -Math.floor(Math.log10(max_len)));
                        //console.log("FBX:size_estimator: max_len=", max_len, "scale_factor=", scale_factor);
                        const scale_factor = 0.01;
                        fbx.scale.set(scale_factor, scale_factor, scale_factor);
                        fbx.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);

                        // Fix-up materials
                        fbx.traverse(obj => {
                            if (obj.type === 'SkinnedMesh' || obj.type === 'Mesh') {
                                console.log("FBX-Fix-Material", obj.material);
                                if (obj.material instanceof Array) {
                                    obj.material = obj.material.map(m => new THREE.MeshLambertMaterial());
                                } else {
                                    obj.material = new THREE.MeshLambertMaterial();
                                }
                            }
                        });
                        console.log("FBX-tree", objectToTreeDebug(fbx));
                        scene.add(fbx);
                        app.vrmRoot = fbx;
                        app.vm.vrmRoot = fbx;
                        setTimeout(() => {
                            scene.add(app.createTreeVisualizer(fbx));
                            app.recalculateFinalSize();
                        }, 100);
                    }
                );
                return;
            }

            const gltfLoader = new THREE.GLTFLoader();

            gltfLoader.load(
                reader.result,
                gltfJson => {
                    console.log("gltf loaded", gltfJson);
                    parseVrm(gltfJson).then(vrmObj => {
                        //console.log("VRM-tree", objectToTreeDebug(vrmObj));
                        scene.add(vrmObj);
                        scene.add(app.createTreeVisualizer(vrmObj));
                        app.vrmRoot = vrmObj;
                        app.vm.vrmRoot = vrmObj;
                        app.recalculateFinalSize();
                    });
                },
                () => { },
                error => {
                    console.log("gltf load failed", error);
                });
        });
        reader.readAsDataURL(vrmFile);
    }

    /**
     * Creates visual tree that connects parent.position & child.position for all parent-child pairs.
     * Useful for bone visualization.
     */
    createTreeVisualizer(obj) {
        const geom = new THREE.Geometry();
        function traverse(o) {
            const p0 = o.getWorldPosition(new THREE.Vector3());
            o.children.forEach(c => {
                if (c.type === "Bone" && o.type === "Bone") {
                    const p1 = c.getWorldPosition(new THREE.Vector3());
                    geom.vertices.push(p0);
                    geom.vertices.push(p1);
                }
                traverse(c);
            });
        }
        traverse(obj);
        const mat = new THREE.LineBasicMaterial({ color: "red" });
        mat.depthTest = false;
        return new THREE.LineSegments(geom, mat);
    }

    recalculateFinalSize() {
        this.vm.calculateFinalSizeAsync();
    }

    static _convertImageToDataUrlWithHeight(img, targetHeight) {
        const scaling = targetHeight / img.height;
        const targetWidth = Math.floor(img.width * scaling);

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetWidth, targetHeight);
        return canvas.toDataURL("image/png");
    }

    /**
     * Creates circular stage with:
     * - normal pointing Y+ ("up" in VRM spec & me/v app)
     * - notch at Z-. ("front" in VRM spec)
     */
    _create_stage() {
        const stageGeom = new THREE.CircleBufferGeometry(1, 64);
        const stageMat = new THREE.MeshBasicMaterial({ color: "white" });
        const stageObj = new THREE.Mesh(stageGeom, stageMat);
        stageObj.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 1.5);

        const notchGeom = new THREE.CircleBufferGeometry(0.02, 16);
        const notchMat = new THREE.MeshBasicMaterial({ color: "grey" });
        const notchObj = new THREE.Mesh(notchGeom, notchMat);
        notchObj.position.set(0, 0.95, 0.001);

        stageObj.add(notchObj);
        return stageObj;
    }
}

function setupStartDialog(onFileSelected) {
    const start_dialog = new Vue({
        el: "#vue_start_dialog",
        data: {
            bgColor: "transparent",
        },
        methods: {
            fileDragover: function (event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                this.bgColor = "#f5f5f5"; // TODO: Move to HTML or CSS
            },
            fileDragleave: function (event) {
                event.preventDefault();
                this.bgColor = "transparent";
            },
            fileDrop: function (event) {
                event.preventDefault();
                this.bgColor = "transparent";
                this._setFileAndExit(event.dataTransfer.files[0]);
            },
            fileSelect: function (event) {
                this._setFileAndExit(event.srcElement.files[0]);
            },
            _setFileAndExit: function (file) {
                this.$destroy();
                document.getElementById("vue_start_dialog").remove();
                onFileSelected(file);
            },
        }
    });
}

function main() {
    const app = new MevApplication(window.innerWidth, window.innerHeight, document.body);
    setupStartDialog(file => app.loadFbxOrVrm(file));
    app.animate();
}

main();