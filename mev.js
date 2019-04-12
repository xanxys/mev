// ES6
import {parse_vrm, serialize_vrm} from './vrm.js';

class MevApplication {
    constructor(width, height, canvasInsertionParent) {
        // Three.js canvas
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 50);
        this.camera.position.set(0, 1, -3);
        this.camera.lookAt(0, 0.9, 0);

        this.controls = new THREE.OrbitControls(this.camera);

        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(width, height);
        this.renderer.antialias = true;
        canvasInsertionParent.appendChild(this.renderer.domElement);

        this.renderer.setClearColor(new THREE.Color("#ddd"));
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
                    serialize_vrm(app.vrm, app.vrm_ext).then(glb_buffer => {
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
        const loader = new THREE.VRMLoader();
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
                    parse_vrm(gltf_json).then(vrm_objs => {
                        vrm_objs.forEach(obj => scene.add(obj));
                    });
                },
                () => { },
                error => {
                    console.log("gltf load failed", error);
                });


            /*
            loader.load(reader.result,
                vrm => {
                    console.log("VRM loaded", vrm);
                    
                    vrm.model.position.set(1, 0, 0);
                    scene.add(vrm.model);

                    vrm.textures.filter(e => e !== undefined).forEach(e => {
                        e.image.width = "32";
                        document.getElementById("textures").appendChild(e.image);
                    });

                    app.vrm = vrm;
                },
                progress => {
                },
                error => {
                    console.log("VRM loading failed", error);
                });
            */
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
    app.animate();
}

main();