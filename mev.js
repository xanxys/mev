// ES6
import { parse_vrm, serialize_vrm } from './vrm.js';
import { vrmMaterials } from './vrm-materials.js';

/**
 * Converts {THREE.Object3D} into human-readable object tree.
 */
function object_to_tree_debug(obj) {
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

        this.controls = new THREE.OrbitControls(this.camera);

        this.renderer = new THREE.WebGLRenderer();
        // Recommended gamma values from https://threejs.org/docs/#examples/loaders/GLTFLoader
        this.renderer.gammaOutput = true;  // If set, then it expects that all textures and colors need to be outputted in premultiplied gamma.
        this.renderer.gammaFactor = 2.2;
        this.renderer.setSize(width, height);
        this.renderer.antialias = true;
        canvasInsertionParent.appendChild(this.renderer.domElement);

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
                avatar_height: null,
                avatar_name: "",
                parts: [],
                final_vrm_ready: false,
                final_vrm_size_approx: "",
                final_vrm_tris: "",
            },
            methods: {
                download_vrm: function (event) {
                    console.log("Download requested");
                    serialize_vrm(app.vrm_root).then(glb_buffer => {
                        saveAs(new Blob([glb_buffer], { type: "application/octet-stream" }), "test.vrm");
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

    // TODO: Rename / think whether we should separate .fbx loader function/UI.
    load_vrm(vrm_file) {
        const is_fbx = vrm_file.name.toLowerCase().endsWith('.fbx');
        this.vm.avatar_name = vrm_file.name;

        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;
        const scene = this.scene;
        reader.addEventListener('load', () => {
            if (is_fbx) {
                const fbx_loader = new THREE.FBXLoader();
                fbx_loader.load(
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
                        console.log("FBX-tree", object_to_tree_debug(fbx));
                        scene.add(fbx);
                        app.vrm_root = fbx;
                        app.vm.final_vrm_ready = true;
                        setTimeout(() => {
                            scene.add(app.create_tree_visualizer(fbx));
                            app.recalculate_final_size();
                        }, 100);
                    }
                );
                return;
            }

            const gltf_loader = new THREE.GLTFLoader();

            gltf_loader.load(
                reader.result,
                gltf_json => {
                    console.log("gltf loaded", gltf_json);
                    parse_vrm(gltf_json).then(vrm_obj => {
                        console.log("VRM-tree", object_to_tree_debug(vrm_obj));
                        scene.add(vrm_obj);
                        scene.add(app.create_tree_visualizer(vrm_obj));
                        app.vrm_root = vrm_obj;
                        app.vm.final_vrm_ready = true;
                        app.recalculate_final_size();
                    });
                },
                () => { },
                error => {
                    console.log("gltf load failed", error);
                });
        });
        reader.readAsDataURL(vrm_file);
    }

    /**
     * Creates visual tree that connects parent.position & child.position for all parent-child pairs.
     * Useful for bone visualization.
     */
    create_tree_visualizer(obj) {
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

    recalculate_final_size() {
        if (!this.vm.final_vrm_ready) {
            return;
        }

        const stats = { num_tris: 0 };
        this.vrm_root.traverse(obj => {
            if (obj.type === 'Mesh' || obj.type === 'SkinnedMesh') {
                const num_verts = obj.geometry.index === null ? obj.geometry.attributes.position.count : obj.geometry.index.count;
                if (num_verts % 3 != 0) {
                    console.warn("Unexpected GeometryBuffer format. Seems to contain non-triangles");
                }
                stats.num_tris += Math.floor(num_verts / 3);
            }
        });
        this.vm.final_vrm_tris = "△" + stats.num_tris;
        this.vm.avatar_height = (new THREE.Box3().setFromObject(this.vrm_root).getSize().y).toFixed(2) + "m";

        this.vm.parts =
            this.vrm_root.children
                .filter(obj => obj.type === 'Mesh' || obj.type === 'SkinnedMesh')
                .map(mesh => {

                    return { name: mesh.name, shaderName: mesh.material.shaderName };
                });

        serialize_vrm(this.vrm_root).then(glb_buffer => {
            this.vm.final_vrm_size_approx = (glb_buffer.byteLength * 1e-6).toFixed(1) + "MB";
        });
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

    const start_config = {
        initial_file: null
    };
    const start_dialog = new Vue({
        el: "#vue_start_dialog",
        data: {
            bg_color: "transparent",
        },
        methods: {
            file_dragover: function (event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                this.bg_color = "#f5f5f5"; // TODO: Move to HTML or CSS
            },
            file_dragleave: function (event) {
                event.preventDefault();
                this.bg_color = "transparent";
            },
            file_drop: function (event) {
                event.preventDefault();
                this.bg_color = "transparent";
                this._set_file_and_exit(event.dataTransfer.files[0]);
            },
            file_select: function (event) {
                this._set_file_and_exit(event.srcElement.files[0]);
            },
            _set_file_and_exit: function (file) {
                start_config.initial_file = file;
                this.$destroy();
                document.getElementById("vue_start_dialog").remove();
                app.load_vrm(file);
            },
        }
    });

    app.animate();
}

main();