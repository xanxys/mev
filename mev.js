"use strict";

/**
 * @return {Promise<ArrayBuffer>}
 */
function serialize_glb(obj) {
    const outputJSON = obj.json;
    const buffers = obj.buffers;

    function getPaddedBufferSize(bufferSize) {
        return Math.ceil(bufferSize / 4) * 4;
    }

    function getPaddedArrayBuffer(arrayBuffer, paddingByte) {
        paddingByte = paddingByte || 0;
        var paddedLength = getPaddedBufferSize(arrayBuffer.byteLength);

        if (paddedLength !== arrayBuffer.byteLength) {
            var array = new Uint8Array(paddedLength);
            array.set(new Uint8Array(arrayBuffer));

            if (paddingByte !== 0) {
                for (var i = arrayBuffer.byteLength; i < paddedLength; i++) {
                    array[i] = paddingByte;
                }
            }
            return array.buffer;
        }
        return arrayBuffer;
    }

    function stringToArrayBuffer(text) {
        if (window.TextEncoder !== undefined) {
            return new TextEncoder().encode(text).buffer;
        }

        var array = new Uint8Array(new ArrayBuffer(text.length));
        for (var i = 0, il = text.length; i < il; i++) {
            var value = text.charCodeAt(i);
            // Replacing multi-byte character with space(0x20).
            array[i] = value > 0xFF ? 0x20 : value;
        }
        return array.buffer;
    }

    // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

    // Merge buffers.
    const blob = new Blob(buffers, { type: 'application/octet-stream' });

    // Update bytelength of the single buffer.
    outputJSON.buffers[0].byteLength = blob.size;

    const GLB_HEADER_BYTES = 12;
    const GLB_HEADER_MAGIC = 0x46546C67;
    const GLB_VERSION = 2;

    const GLB_CHUNK_PREFIX_BYTES = 8;
    const GLB_CHUNK_TYPE_JSON = 0x4E4F534A;
    const GLB_CHUNK_TYPE_BIN = 0x004E4942;

    return new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onloadend = function () {
            // Binary chunk.
            var binaryChunk = getPaddedArrayBuffer(reader.result);
            var binaryChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
            binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true);
            binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

            // JSON chunk.
            var jsonChunk = getPaddedArrayBuffer(stringToArrayBuffer(JSON.stringify(outputJSON)), 0x20);
            var jsonChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
            jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true);
            jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true);

            // GLB header.
            var header = new ArrayBuffer(GLB_HEADER_BYTES);
            var headerView = new DataView(header);
            headerView.setUint32(0, GLB_HEADER_MAGIC, true);
            headerView.setUint32(4, GLB_VERSION, true);
            var totalByteLength = GLB_HEADER_BYTES
                + jsonChunkPrefix.byteLength + jsonChunk.byteLength
                + binaryChunkPrefix.byteLength + binaryChunk.byteLength;
            headerView.setUint32(8, totalByteLength, true);

            var glbBlob = new Blob([
                header,
                jsonChunkPrefix,
                jsonChunk,
                binaryChunkPrefix,
                binaryChunk
            ], { type: 'application/octet-stream' });

            var glbReader = new window.FileReader();
            glbReader.readAsArrayBuffer(glbBlob);
            glbReader.onloadend = function () {
                resolve(glbReader.result);
            };
        };
        reader.readAsArrayBuffer(blob);
    });
}

/**
 * @return {Promise<ArrayBuffer>} vrm (.glb format) blob
 */
function serialize_vrm(three_vrm_data, vrm_ext) {
    // TODO: Create proper VRM serializer.

    //console.log("Serializer", three_vrm_data.parser.json);
    //"glTF"

    const exporter = new THREE.GLTFExporter();
    const options = {
        binary: true,
        includeCustomExtensions: true,
    };

    const scene = new THREE.Scene();
    // We push directly to children instead of calling `add` to prevent
    // modify the .parent and break its original scene and hierarchy
    scene.children.push(three_vrm_data.model);
    const gltf_and_buffers = new Promise((resolve, reject) => {
        exporter.parse(scene, gltf => {
            console.log(gltf);
            resolve(gltf);
        }, options);
    });

    function augment_data(obj) {
        console.log("augmenting", obj, "with", vrm_ext);
        if (obj.json.extensionsUsed === undefined) {
            obj.json.extensionsUsed = [];
        }
        if (obj.json.extensions === undefined) {
            obj.json.extensions = {};
        }

        obj.json.extensions["VRM"] =
            {
                blendShapeMaster: {
                    blendShapeGroups: [],
                },
                humanoid: vrm_ext.vrm.parser.json.extensions.VRM.humanoid, // HACK
                firstPerson: vrm_ext.vrm.parser.json.extensions.VRM.firstPerson, // HACK
                materialProperties: obj.json.materials.map(mat => {
                    return {
                        name: mat.name,
                        shader: "UnlitTexture",
                        renderQueue: 2000,
                        floatProperties: {},
                        vectorProperties: {},
                        textureProperties: {},
                        keywordMap: {},
                        tagMap: {},
                    };
                }),
                meta: vrm_ext.meta,
                secondaryAnimation: {},
                exporterVersion: "me/v",
            };
        obj.json.extensionsUsed = Array.from(new Set(["VRM", ...obj.json.extensionsUsed]));
        return obj;
    }

    return gltf_and_buffers.then(augment_data).then(serialize_glb);
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
                },
                () => { },
                error => {
                    console.log("gltf load failed", error);
                });


            loader.load(reader.result,
                vrm => {
                    console.log("VRM loaded", vrm);
                    app.vrm_ext = new VrmExtension(vrm);
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