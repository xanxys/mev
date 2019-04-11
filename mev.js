"use strict";

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
        const scene = this.scene;
        const vm = new Vue({
            el: '#vue_menu',
            data: {
            },
            methods: {
                change_file: function (event) {
                    console.log(event.srcElement.files[0]);
                    const vrmFile = event.srcElement.files[0];
                    const loader = new THREE.VRMLoader();

                    // three-vrm currently doesn't have .parse() method, need to convert to data URL...
                    // (inefficient)
                    const reader = new FileReader();
                    reader.addEventListener('load', () => {
                        loader.load(reader.result,
                            vrm => {
                                console.log("VRM loaded", vrm);
                                scene.add(vrm.model);

                                console.log(vrm.textures);

                                vrm.textures.filter(e => e !== undefined).forEach(e => {
                                    e.image.width = "200";
                                    document.getElementById("textures").appendChild(e.image);
                                });
                            },
                            progress => {
                            },
                            error => {
                                console.log("VRM loading failed", error);
                            });
                    });
                    reader.readAsDataURL(vrmFile);
                }
            },
        });
    }

    animate() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        requestAnimationFrame(() => this.animate());
    }

    // Create circular stage with:
    // * normal pointing Y+ ("up" in VRM spec & me/v app)
    // * notch at Z-. ("front" in VRM spec)
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