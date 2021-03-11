// ES6
import { VrmDependency } from '../vrm-core/deps.js';

let detailsDialog = null;

export function setupDetailsDialog(vrmModel) {
    document.getElementById("vue_details_dialog").style.display = "block";

    if (detailsDialog === null) {
        detailsDialog = new Vue({
            el: "#vue_details_dialog",                    
            data: {
                currentTab: "BUFFER",
                detailsText: "",
                morphDetails: "",
                boneDetails: "",
            },
            methods: {
                clickTab: function(tab) {
                    this.currentTab = tab;
                },
                clickCloseButton: function() {
                    document.getElementById("vue_details_dialog").style.display = "none";
                },
                updateDetails: function(vrmModel) {
                    this.detailsText = prettyPrintVrmSizeDetails(vrmModel);
                    this.morphDetails = prettyPrintMorphDetails(vrmModel);
                    this.boneDetails = prettyPrintBoneDetails(vrmModel);
                },
            }
        });
    }
    detailsDialog.updateDetails(vrmModel);
}

/**
 * @param {VrmModel} vrmModel
 * @returns {string}: Human readable multi-line detail about file size composition at bufferview granularity.
 */
function prettyPrintVrmSizeDetails(vrmModel) {
    const deps = new VrmDependency(vrmModel);

    // Chunks
    let details = "";
    details += "Chunks\n";
    details += "  " + JSON.stringify(vrmModel.gltf).length.toLocaleString("en-US") + " byte (JSON)\n";
    vrmModel.buffers.forEach(buffer => details += "  " + buffer.byteLength.toLocaleString("en-US") + " byte (binary)\n");

    const viewUsage = deps.viewUsage;
    vrmModel.gltf.bufferViews.forEach((view, viewId) => {
        details += "    "  + view.byteLength.toLocaleString("en-US") + " byte\n";
        if (viewUsage.has(viewId)) {
            viewUsage.get(viewId).forEach(usage => {
                details += "      as "  + usage + "\n";
            });
        } else {
            details += "      (not referenced)\n";
        }
    });

    return details;
}

/**
 * @param {VrmModel} vrmModel
 * @returns {string}: Human readable multi-line detail about morphs & blendshapes.
 */
function prettyPrintMorphDetails(vrmModel) {
    let details = "";
    const usedMeshIdMorphIdPairs = new Set(); // meshId:morphId format.

    vrmModel.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.forEach(group => {
        details += `${group.name}\n`;
        group.binds.forEach(bind => {
            const mesh = vrmModel.gltf.meshes[bind.mesh];
            let morphName = maybeGetMorphName(vrmModel, bind.mesh, bind.index);
            morphName = morphName === null ? "" : `(${morphName})`;
            details += `  mesh(${mesh.name}).morph[${bind.index}${morphName}] ${bind.weight}\n`;
            usedMeshIdMorphIdPairs.add(`${bind.mesh}:${bind.index}`);
        });
    });

    details += "Unused morphs\n";
    vrmModel.gltf.meshes.forEach((mesh, meshId) => {
        if (mesh.primitives.length === 0 || !mesh.primitives[0].targets) {
            return;
        }

        mesh.primitives[0].targets.forEach((morph, morphId) => {
            const key = `${meshId}:${morphId}`;
            if (!usedMeshIdMorphIdPairs.has(key)) {
                let morphName = maybeGetMorphName(vrmModel, meshId, morphId);
                morphName = morphName === null ? "" : `(${morphName})`;
                details += `  mesh(${mesh.name}).morph[${morphId}${morphName}]\n`;
            }
        });
    });

    return details;
}


/**
 * 
 * @param {VrmModel} vrmModel 
 * @returns {string} Human readable multi-line detail about bone hierarchy.
 */
function prettyPrintBoneDetails(vrmModel) {
    console.log("m", vrmModel);

    const skeletons = new Map(); // key:nodeIx, val:skinName
    vrmModel.gltf.skins.forEach((skin, skinIx) => {
        const nodeIx = skin.skeleton;
        if (nodeIx === undefined) {
            return;
        }

        let skelName = "";
        if (skeletons.has(nodeIx)) {
            skelName = skeletons.get(nodeIx) + ",";
        }
        skelName += `skin(${skinIx})`;
        skeletons.set(nodeIx, skelName);
    });

    const humanBones = new Map(); // key:nodeIx, val:nodeName
    vrmModel.gltf.extensions.VRM.humanoid.humanBones.forEach(hb => {
        humanBones.set(hb.node, hb.bone);
    });

    const secAnimBones = new Map();
    if (vrmModel.gltf.extensions.VRM.secondaryAnimation !== undefined) {
        vrmModel.gltf.extensions.VRM.secondaryAnimation.boneGroups.forEach((bg, bgIx) => {
            const bgName = `spring(${bgIx})`;
            bg.bones.forEach(boneIx => {
                secAnimBones.set(boneIx, bgName);
            });
        });
        vrmModel.gltf.extensions.VRM.secondaryAnimation.colliderGroups.forEach((colg, colgIx) => {
            const colgName = `colliders(${colgIx})`;
            secAnimBones.set(colg.node, colgName);
        });
    }

    let details = "";
    function dumpNode(nodeIx, indent) {
        const node = vrmModel.gltf.nodes[nodeIx];
        const nodeName = (node.name || "node") + `(${nodeIx})`;
        const status = 
            (node.skin !== undefined ? "skin" : "") +
            (node.mesh !== undefined ? "mesh" : "") +
            (nodeIx === vrmModel.gltf.extensions.VRM.firstPerson.firstPersonBone ? "[firstperson]" : "") +
            (skeletons.has(nodeIx) ? `[skeleton root(${skeletons.get(nodeIx)})]` : "") +
            (humanBones.has(nodeIx) ? `[${humanBones.get(nodeIx)}]` : "") +
            (secAnimBones.has(nodeIx) ? `[${secAnimBones.get(nodeIx)}]` : "");
        details += `${indent}${nodeName} ${status}\n`;
        if (node.children) {
            node.children.forEach(n => dumpNode(n, indent + " "));
        }
    }

    vrmModel.gltf.scenes.forEach((scene, sceneIx) => {
        details += `scene[${sceneIx}]\n`;

        scene.nodes.forEach(rootNode => {
            dumpNode(rootNode, " ");
        });
    });
    return details;
}

/**
 * @returns {string | null}
 */
function maybeGetMorphName(model, meshId, morphId) {
    const mesh = model.gltf.meshes[meshId];
    if (mesh.primitives.length > 0 && mesh.primitives[0].extras && mesh.primitives[0].extras.targetNames) {
        return mesh.primitives[0].extras.targetNames[morphId];
    }
    return null;
}

