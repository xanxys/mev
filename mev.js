// ES6
import { VrmModel } from './vrm-core/vrm.js';
import { VrmRenderer } from './vrm-renderer.js';
import { setupStartDialog } from './components/start-dialog.js';
import { setupDetailsDialog } from './components/details-dialog.js';
import { } from './components/menu-section-emotion.js';
import { } from './components/menu-section-image.js';
import { flatten, blendshapeToEmotionId } from './mev-util.js';
import { MotionPlayer } from './motion.js';

const EMOTION_PRESET_GROUPING = [
    ["neutral"],
    ["a", "i", "u", "e", "o"],
    ["joy", "angry", "sorrow", "fun"],
    ["blink", "blink_l", "blink_r"],
    ["lookleft", "lookright", "lookup", "lookdown"],
    // All unknown will go into the last group.
];

const EMOTION_PRESET_NAME_TO_LABEL = {
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
    "lookleft": "目←",
    "lookright": "目→",
    "lookup": "目↑",
    "lookdown": "目↓",
};

const PANE_MODE = {
    DEFAULT: 0,
    EMOTION: 1,
    IMAGE: 2,
};

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
class MevApplication {
    constructor(width, height, canvasInsertionParent) {
        // Three.js canvas
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 50);
        this.camera.position.set(0, 1, -3);
        this.camera.lookAt(0, 0.9, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        // Recommended gamma values from https://threejs.org/docs/#examples/loaders/GLTFLoader
        this.renderer.outputEncoding = THREE.sRGBEncoding;
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
        this.setEnvironment('neutral');

        // Setup progress indicator
        new Mprogress({
            template: 3,
            parent: "#loading_progress",
        }).start();

        // Overlay UI
        const app = this;
        app.stage = new Stage(this.scene);
        app.heightIndicator = new HeightIndicator(this.scene);

        this.motionPlayer = null;
        this.prepareMotionPlayer();

        this.vm = new Vue({
            el: '#vue_menu',
            data: {
                // Global
                startedLoading: false,
                vrmRoot: null, // VrmModel

                // UI mode
                currentPane: PANE_MODE.DEFAULT,
                isFatalError: false,

                // PANE_MODE.DEFAULT
                avatarName: "",
                avatarHeight: "",
                currentEmotionId: "neutral",  // shared with PANE_MODE.EMOTION
                finalVrmSizeApprox: "",

                // PANE_MODE.IMAGE
                currentImageId: -1,
            },
            watch: {
                vrmRoot: function (newValue, oldValue) {
                    console.log("vrmRoot.watch");
                    if (newValue !== oldValue || newValue.version !== oldValue.version) {
                        console.log("Updating vrmRoot");
                        // depends on VrmRenderer
                        this._applyEmotion();
                        this._computeAvatarHeight();
                        // just slow
                        this._calculateFinalSizeAsync();
                        app.heightIndicator.setHeight(this.avatarHeight);
                        app.heightIndicator.setVisible(true);
                    }
                },
            },
            methods: {
                updateVrm: function (newVrm) {
                    this.vrmRoot = newVrm;
                    app.vrmRenderer.invalidate();
                },
                refreshPage: function () {
                    location.reload();
                },
                clickEmotion: function (emotionId) {
                    if (this.currentEmotionId === emotionId) {
                        this.currentPane = PANE_MODE.EMOTION;
                    } else {
                        this.currentEmotionId = emotionId;
                        this._applyEmotion();
                    }
                },
                clickImage: function (imageId) {
                    this.currentImageId = imageId;
                    this.currentPane = PANE_MODE.IMAGE;
                },
                _applyEmotion() {
                    app.vrmRenderer.setCurrentEmotionId(this.currentEmotionId);
                    app.vrmRenderer.invalidateWeight();
                },
                _calculateFinalSizeAsync: function () {
                    this.vrmRoot.serialize().then(buffer => {
                        this.finalVrmSizeApprox = (buffer.byteLength * 1e-6).toFixed(1) + "MB";
                    });
                },
                downloadVrm: function (event) {
                    console.log("Download requested");

                    this.vrmRoot.serialize().then(buffer => {
                        saveAs(new Blob([buffer], { type: "application/octet-stream" }), "test.vrm");
                    });
                },
                showDetails: function (event) {
                    setupDetailsDialog(this.vrmRoot);
                },
                clickBackButton: function () {
                    this.currentPane = PANE_MODE.DEFAULT;
                },
                _computeAvatarHeight: function () {
                    // For some reason, according to profiler,
                    // this method is computed every frame unlike others (e.g. finalVrmTris, blendshapes, parts).
                    // Maybe because this is using this.vrmRoot directly, and some field in vrmRoot is changing every frame?
                    if (this.vrmRoot === null) {
                        return 0;
                    }
                    // TODO: Ideally, this is calculatable without Renderer.
                    this.avatarHeight = (new THREE.Box3().setFromObject(app.vrmRenderer.getThreeInstance())).getSize(new THREE.Vector3()).y;
                }
            },
            computed: {
                isDev: function() {
                    if (window.location.hostname === "127.0.0.1") {
                        return !window.location.href.endsWith("?prd");
                    } else {
                        return window.location.href.endsWith("?dev");
                    }
                },
                // Toolbar & global pane state.
                toolbarTitle: function () {
                    switch (this.currentPane) {
                        case PANE_MODE.DEFAULT:
                            return this.avatarName;
                        case PANE_MODE.EMOTION:
                            const nameToBlendshape = new Map(this.blendshapes.map(bs => [bs.id, bs]));
                            const blendshape = nameToBlendshape.get(this.currentEmotionId);
                            return "表情:" + blendshape.label;
                        case PANE_MODE.IMAGE:
                            return "画像: " + this.vrmRoot.gltf.images[this.currentImageId].name;
                        default:
                            console.error("Unknown UI mode: ", this.currentPane);
                            return "";
                    }
                },
                showBackButton: function () {
                    return this.currentPane !== PANE_MODE.DEFAULT;
                },
                showMainPane: function () {
                    return this.currentPane === PANE_MODE.DEFAULT && this.vrmRoot !== null;
                },
                showEmotionPane: function () {
                    return this.currentPane === PANE_MODE.EMOTION;
                },
                showImagePane: function () {
                    return this.currentPane === PANE_MODE.IMAGE;
                },
                isLoading: function () {
                    return this.startedLoading && (this.vrmRoot === null && !this.isFatalError);
                },

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
                    if (!secAnim || !secAnim.boneGroups) {
                        return [];
                    }
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
                                shaderName: MevApplication._getShaderNameFromMaterial(this.vrmRoot, prim.material),
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

        this.vm_anim = new Vue({
            el: '#vue_anim_control',
            data: {
                playing: true,
                wireframeEnabled: false,
            },
            methods: {
                clickPlayButton: function() {
                    this.playing = true;
                },
                clickPauseButton: function() {
                    this.playing = false;
                },
                clickEnableWireframe: function() {
                    this.wireframeEnabled = true;
                    app.vrmRenderer.setWireframe(true);
                },
                clickDisableWireframe: function() {
                    this.wireframeEnabled = false;
                    app.vrmRenderer.setWireframe(false);
                },
                clickSetEnv: function(envName) {
                    app.setEnvironment(envName);
                },
            },
            computed: {
                showPlayButton: function () {
                    return !this.playing;
                },
                showPauseButton: function () {
                    return this.playing;
                },
            },
        });
    }

    setEnvironment(envName) {
        const NAME_ENV = 'environment';

        while (true) {
            const obj = this.scene.getObjectByName(NAME_ENV);
            if (!obj) {
                break;
            }
            this.scene.remove(obj);
        }

        switch(envName) {
            case 'neutral': {
                this.renderer.setClearColor(new THREE.Color("#f5f5f5"));

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight.name = NAME_ENV;
                this.scene.add(dirLight);
        
                const ambLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
                ambLight.name = NAME_ENV;
                this.scene.add(ambLight);

                break;    
            }
            case 'dark': {
                this.renderer.setClearColor(new THREE.Color("#222222"));

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.1);
                dirLight.name = NAME_ENV;
                this.scene.add(dirLight);
        
                const ambLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
                ambLight.name = NAME_ENV;
                this.scene.add(ambLight);

                break;
            }
            default:
                console.error('unknown environment:', envName);
        }
    }

    prepareMotionPlayer() {
        // ID: http://mocap.cs.cmu.edu/search.php?subjectnumber=%&motion=%
        // 01_09: good complex 3D movement
        // 09_12: walk in various direction
        // 40_10: "wait for bus" movement (good for idle)
        const req = new Request("https://s3.amazonaws.com/open-motion.herokuapp.com/json/40_10.json");
        fetch(req).then(response => response.json()).then(json => {
            console.log("Motion", json);
            this.motionPlayer = new MotionPlayer(json);
        });
    }

    /** Executes and renders single frame and request next frame. */
    animate() {
        this.controls.update();
        if (this.motionPlayer !== null && this.vm_anim.playing) {
            this.motionPlayer.stepFrame(this.vm.vrmRoot, this.vrmRenderer);
        }
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
                    // But current MevApplication VM depends A LOT on Three instance...
                    app.vm.vrmRoot = vrmModel; // Vue binder of vrmModel.
                });
            });
        });
        reader.readAsArrayBuffer(vrmFile);
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

    static _getShaderNameFromMaterial(vrm, matIx) {
        const mat = vrm.gltf.materials[matIx];
        if (mat.extensions !== undefined && mat.extensions.KHR_materials_unlit !== undefined) {
            const vrmShader = vrm.gltf.extensions.VRM.materialProperties[matIx].shader;
            if (vrmShader === "VRM_USE_GLTFSHADER") {
                return "Unlit*";
            } else {
                return vrmShader;
            }
        } else {
            return "Metallic-Roughness";
        }
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

}

/// Present rounded rectangle floor.
/// Shown always.
class Stage {
    constructor(scene) {
        scene.add(this._createStage());
    }

    /**
     * Creates stage with enough space for walking motion. (tied implicitly with motionPlayer)
     */
    _createStage() {
        const stageMat = new THREE.MeshLambertMaterial({color: "#f0f0f0f0" });
        const accentMat = new THREE.MeshBasicMaterial({ color: "grey" });

        const stageBaseGeom = Stage._createRoundedQuad(2, 3, 0.3);
        const stageBaseObj = new THREE.Mesh(stageBaseGeom, stageMat);

        const stageAccentGeom = Stage._createRoundedQuad(1.8, 2.8, 0.2);
        const stageAccentObj = new THREE.Mesh(stageAccentGeom, accentMat);
        stageAccentObj.position.y = 5e-3;

        const stageTopGeom = Stage._createRoundedQuad(1.78, 2.78, 0.19);
        const stageTopObj = new THREE.Mesh(stageTopGeom, stageMat);
        stageTopObj.position.y = 15e-3;

        stageBaseObj.add(stageAccentObj);
        stageBaseObj.add(stageTopObj);
        stageBaseObj.position.set(-0.2, -15e-3, 0.5);
        return stageBaseObj;
    }

    /**
     * Creates rounded quad of size [-xSize/2, xSize/2] x [-zSize/2, zSize/2] (poiting Y+).
     * @param {number} xSize 
     * @param {number} zSize 
     * @param {number} radius
     * @returns {BufferGeometry}
     */
    static _createRoundedQuad(xSize, zSize, radius) {
        const xHalf = xSize / 2;
        const zHalf = zSize / 2;
        const NUM_CORNER_SEGMENTS = 16;

        // Create N-gon as fan-like structure
        // * center: origin
        // * N-gon vertices (= num triangles): 4 (edges) + NUM_CORNER_SEGMENTS * 4 (corners)
        const NUM_TRIS = 4 + 4 * NUM_CORNER_SEGMENTS;

        //   corner=1
        //   /-----------\    corner=0
        //  /             \ <- 0
        //  |             |
        //  \            / <- N - 1
        //   \----------/ corner=3
        let perimeterVerrices = [];
        for (var cornerIx = 0; cornerIx < 4; cornerIx++) {
            const cornerCenterX = (cornerIx === 0 || cornerIx === 3) ? xHalf - radius : - (xHalf - radius);
            const cornerCenterZ = (cornerIx === 0 || cornerIx === 1) ? zHalf - radius : - (zHalf - radius);

            const angleOffset = Math.PI / 2 * cornerIx;
            for (var segmentIx = 0; segmentIx < NUM_CORNER_SEGMENTS + 1; segmentIx++) {
                const angle = angleOffset + (segmentIx / NUM_CORNER_SEGMENTS) * (Math.PI / 2);
                perimeterVerrices.push(
                    new THREE.Vector3(cornerCenterX + Math.cos(angle) * radius, 0, cornerCenterZ + Math.sin(angle) * radius));
            }
        }

        const vertPos = new Float32Array(NUM_TRIS * 3 * 3);
        for (var ix = 0; ix < NUM_TRIS; ix++) {
            // center
            vertPos[ix * 9 + 0] = 0;
            vertPos[ix * 9 + 1] = 0;
            vertPos[ix * 9 + 2] = 0;

            const p = perimeterVerrices[(ix + 1) % perimeterVerrices.length];
            vertPos[ix * 9 + 3] = p.x;
            vertPos[ix * 9 + 4] = p.y;
            vertPos[ix * 9 + 5] = p.z;

            const q = perimeterVerrices[ix];
            vertPos[ix * 9 + 6] = q.x;
            vertPos[ix * 9 + 7] = q.y;
            vertPos[ix * 9 + 8] = q.z;
        }
        const vertNrm = new Float32Array(NUM_TRIS * 3 * 3);
        for (var ix_v = 0; ix_v < NUM_TRIS * 3; ix_v++) {
            vertNrm[ix_v * 3 + 0] = 0;
            vertNrm[ix_v * 3 + 1] = 1;
            vertNrm[ix_v * 3 + 2] = 0;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(vertPos, 3));
        geom.setAttribute("normal", new THREE.BufferAttribute(vertNrm, 3));
        return geom;
    }
}

/// Present current avatar height in Scene.
/// Hidden by default.
class HeightIndicator {
    constructor(scene) {
        this.scene = scene;

        this.visible = false;
        this._createObjects(0);
    }

    setVisible(visible) {
        this.visible = visible;

        this.arrow.visible = visible;
        this.sprite.visible = visible;
    }

    setHeight(height) {
        this.scene.remove(this.arrow);
        this.scene.remove(this.sprite);
        this._createObjects(height);
    }

    _createObjects(height) {
        // Arrow
        {
            const geom = new THREE.CylinderGeometry(0.001, 0.001, 0.5, 6);
            const mat = new THREE.MeshBasicMaterial({ color: "black" });

            this.arrow = new THREE.Mesh(geom, mat);
            this.arrow.visible = this.visible;
            this.arrow.rotateX(Math.PI * 0.5);
            this.arrow.position.setY(height);
            this.scene.add(this.arrow);
        }

        // Text
        {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");
            ctx.fillColor = "black";
            ctx.font = "32px Roboto";
            ctx.fillText("身長 " + height.toFixed(2) + "m", 0, 128);

            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(0.5, 0.5, 0.5);
            sprite.position.set(0, height - 0.05, 0);

            this.sprite = sprite;
            this.sprite.visible = this.visible;
            this.scene.add(this.sprite);
        }
    }
}

function main() {
    const app = new MevApplication(window.innerWidth, window.innerHeight, document.body);
    setupStartDialog(file => {
        document.getElementById("vue_menu").style.display = "";
        document.getElementById("vue_anim_control").style.display = "flex";
        app.loadFbxOrVrm(file);
    });
    app.animate();
}

main();