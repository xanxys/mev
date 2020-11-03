// ES6
import { setupStartDialog } from './components/start-dialog.js';

/**
 * Handle main debugger UI & all state. Start dialog is NOT part of this class.
 */
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
                meshData: {
                    indices: [],
                    attr_pos: [],
                    attr_uv0: [],
                    attr_nrm: [],
                },

                // UI mode
                isFatalError: false,
            },
            methods: {
                clickStep: function() {
                },
            },
            computed: {
                numTris: function() {
                    return this.meshData.indices.length / 3;
                },
                numVerts: function() {
                    return this.meshData.attr_pos.length;
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
        this.vm.startedLoading = true;

        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;

        // VRM
        reader.addEventListener("load", () => {
            const meshData = JSON.parse(new TextDecoder().decode(reader.result));
            console.log(meshData);

            const geom = new THREE.Geometry();

            meshData.attr_pos.forEach(p => geom.vertices.push(new THREE.Vector3(p[0], p[1], p[2])));
            // TODO: normal
            //geom.attr_uv0.forEach(p => geom.faceVertexUvs.push(new THREE.Vector2(p[0], p[1])));
            meshData.attr_uv0.forEach(p => geom.faceVertexUvs.push(new THREE.Vector2(p[0], p[1])));

            for (let i = 0; i < meshData.indices.length; i+=3) {
                geom.faces.push(new THREE.Face3(meshData.indices[i + 0], meshData.indices[i + 1], meshData.indices[i + 2]));
            }

            const mat = new THREE.MeshLambertMaterial();
            geom.computeFaceNormals();
            const mesh = new THREE.Mesh(geom, mat);

            const directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
            this.scene.add( directionalLight );

            
            this.scene.add(mesh);
            app.vm.meshData = meshData;
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