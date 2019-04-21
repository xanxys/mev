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
 * Handle main editor UI & all state. Start dialog is NOT part of this class.
 */
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
        this.vm = new Vue({
            el: '#vue_menu',
            data: {
                avatarHeight: null,
                avatarName: "",
                parts: [],
                finalVrmReady: false,
                finalVrmSizeApprox: "",
                finalVrmTris: "",
            },
            methods: {
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
                }
            },
        });
    }

    /** Executes and renders single frame and request next frame. */
    animate() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        requestAnimationFrame(() => this.animate());
    }

    // TODO: Rename / think whether we should separate .fbx loader function/UI.
    loadVrm(vrmFile) {
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
                        app.vm.finalVrmReady = true;
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
                        app.vm.finalVrmReady = true;
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
                if (c.type === 'Bone') {
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
        if (!this.vm.finalVrmReady) {
            return;
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
        this.vm.finalVrmTris = "△" + stats.numTris;
        this.vm.avatarHeight = (new THREE.Box3().setFromObject(this.vrmRoot).getSize().y).toFixed(2) + "m";

        const blendShapeMeshes = new Set();
        if (this.vrmRoot.vrmExt !== undefined) {
            this.vrmRoot.vrmExt.blendShapeMaster.blendShapeGroups.forEach(group => {
                group.binds.forEach(bind => blendShapeMeshes.add(bind.mesh));
            });
        }

        const flattenedObjects = [];
        this.vrmRoot.traverse(o => flattenedObjects.push(o));
        this.vm.parts =
            flattenedObjects
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



        serializeVrm(this.vrmRoot).then(glbBuffer => {
            this.vm.finalVrmSizeApprox = (glbBuffer.byteLength * 1e-6).toFixed(1) + "MB";
        });
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

function main() {
    const app = new MevApplication(window.innerWidth, window.innerHeight, document.body);

    const startConfig = {
        initialFile: null
    };
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
                startConfig.initialFile = file;
                this.$destroy();
                document.getElementById("vue_start_dialog").remove();
                app.loadVrm(file);
            },
        }
    });

    app.animate();
}

main();