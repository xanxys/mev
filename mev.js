"use strict";

/**
 * @return {Promise<ArrayBuffer>} vrm (.glb format) blob
 */
function serialize_vrm(three_vrm_data) {
    // TODO: Create proper VRM serializer.

    //console.log("Serializer", three_vrm_data.parser.json);
    //"glTF"

    const exporter = new THREE.GLTFExporter();
    const options = {
        binary: true,
        includeCustomExtensions: true,
        topLevelExtensions: {
            VRM: three_vrm_data.parser.json.extensions.VRM,
        }
    };

    const scene = new THREE.Scene();
    // We push directly to children instead of calling `add` to prevent
    // modify the .parent and break its original scene and hierarchy
    scene.children.push(three_vrm_data.model);
    return new Promise((resolve, reject) => {
        exporter.parse(scene, gltf => {
            console.log(gltf);
            resolve(gltf);
        }, options);
    });
}

/**
 * VRM extension attached to root {Object3D} userData.
 * All glTF id references are replaced by actual instance refs.
 * 
 * https://dwango.github.io/vrm/vrm_spec
 */
class VrmExtension {
    /**
     * @param {THREE.VRM} VRM object given by THREE.VRMLoader
     */
    constructor(vrm) {
        console.log("Parsing VRM extension");
        this.vrm = vrm;
        const ext = vrm.parser.json.extensions.VRM;

        // TODO: Write parser
        this.blendShapeMaster = this._convert_blendshape(ext.blendShapeMaster);
        this.humanoid = this._convert_humanoid(ext.humanoid);
        this.firstPerson = this._convert_firstperson(ext.firstPerson);
        this.materialProperties = ext.materialProperties;
        this.meta = ext.meta;
        this.secondaryAnimation = {};
    }

    _convert_blendshape(blendshape) {
        return {
            blendShapeGroups:
                blendshape.blendShapeGroups.map(group => this._convert_blendshape_group(group)),
        };
    }

    _convert_blendshape_group(group) {
        return {
            name: group.name,
            presetName: group.presetName,
            binds: group.binds.map(bind => this._convert_blendshape_bind(bind)),
            materialValues: group.materialValues,
        };
    }

    _convert_blendshape_bind(bind) {
        return {
            mesh: this.vrm.meshes[bind.mesh],
            index: bind.index, // (probably) morph target index of the mesh.
            weight: bind.weight,
        };
    }

    // https://github.com/dwango/UniVRM/blob/master/specification/0.0/schema/vrm.humanoid.schema.json
    _convert_humanoid(humanoid) {
        return {
            humanBones: humanoid.humanBones.map(bone => this._convert_humanoid_bone(bone)),
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

    _convert_humanoid_bone(bone) {
        return {
            bone: bone.bone,
            node: this.vrm.nodes[bone.node],
            useDefaultValues: bone.useDefaultValues,
            min: bone.min,
            max: bone.max,
            center: bone.center,
            axisLength: bone.axisLength,
        };
    }

    _convert_firstperson(firstperson) {
        return {
            firstPersonBone: this.vrm.nodes[firstperson.firstPersonBone],
            firstPersonBoneOffset: firstperson.firstPersonBoneOffset,
            meshAnnotations: firstperson.meshAnnotations.map(annot => this._convert_firstperson_meshannotation(annot)),
            lookAtTypeName: firstperson.lookAtTypeName,
            lookAtHorizontalInner: firstperson.lookAtHorizontalInner,
            lookAtVerticalDown: firstperson.lookAtVerticalDown,
            lookAtVerticalUp: firstperson.lookAtVerticalUp,
        };
    }

    _convert_firstperson_meshannotation(annot) {
        return {
            mesh: this.vrm.meshes[annot.mesh],
            firstPersonFlag: annot.firstPersonFlag,
        };
    }
}

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
                    serialize_vrm(app.vrm).then(glb_buffer => {
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
                },
                () => { },
                error => {
                    console.log("gltf load failed", error);
                });


            loader.load(reader.result,
                vrm => {
                    console.log("VRM loaded", vrm);
                    vrm.model.userData.vrm = new VrmExtension(vrm);
                    console.log("EXT=", vrm.model.userData.vrm);
                    scene.add(vrm.model);

                    console.log(vrm.textures);

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