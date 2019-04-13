// ES6
import { parse_vrm, serialize_vrm } from './vrm.js';

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

        // Overlay UI
        const app = this;
        const scene = this.scene;
        const vm = new Vue({
            el: '#vue_menu',
            data: {
            },
            methods: {
                change_file: function (event) {
                    console.log(event.srcElement.files[0]);
                    const vrmFile = event.srcElement.files[0];
                    app.load_vrm(vrmFile);
                },
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

    load_vrm(vrm_file) {
        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;
        const scene = this.scene;
        reader.addEventListener('load', () => {
            const gltf_loader = new THREE.GLTFLoader();

            gltf_loader.load(
                reader.result,
                gltf_json => {
                    console.log("gltf loaded", gltf_json);
                    parse_vrm(gltf_json).then(vrm_obj => {
                        scene.add(vrm_obj);
                        app.vrm_root = vrm_obj;
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
                this.bg_color = "#f5f5f5";
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