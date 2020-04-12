// ES6
import {VrmModel} from "./vrm.js";

/**
 * @param {VrmModel} model: will be mutated
 * @returns {Promise<null>}
 */
export async function reduceVrm(model) {
    //// conditional lossless
    // Remove non-moving bones & weights
    // Remove nodes

    //// lossy
    // mesh merging
    // atlas-ing
    // vertex reduction
    //// misc
    // float-quantization

    // await removeAllBlendshapes(model);
    await removeUnusedMorphs(model);
    await extremeResizeTexture(model, 128);
    return null;
}

/**
 * @returns {Promise<null>}
 */
async function extremeResizeTexture(model, maxTexSizePx) {
    for (let i = 0; i < model.gltf.images.length; i++) {
        const bufferViewIx = model.gltf.images[i].bufferView;
        const imageBlob = model.getImageAsBuffer(i);

        const img = await Jimp.read(imageBlob);
        const smallBlob = await img.scaleToFit(maxTexSizePx, maxTexSizePx).getBufferAsync("image/png");
        model.setBufferData(bufferViewIx, smallBlob);
    }
    model.repackBuffer();
}


/**
 * @returns {Promise<null>}
 */
async function removeAllBlendshapes(model) {
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups = [];
    model.version += 1;
}

/**
 * @returns {Promise<null>}
 */
async function removeUnusedMorphs(model) {
    if (!isUniformPrimitive(model)) {
        console.warn("A mesh in the VRM has multiple primitives with different morphs. removeUnusedMorphs won't be executed.");
        return;
    }

    // Extract pairs to keep
    const usedMeshIdMorphIdPairs = new Set(); // meshId:morphId format.
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.forEach(group => {
        group.binds.forEach(bind => {
            const mesh = model.gltf.meshes[bind.mesh];
            usedMeshIdMorphIdPairs.add(`${bind.mesh}:${bind.index}`);
        });
    });

    // Execute deletion, with delta
    const morphRemap = new Map(); // key=meshId:morphId value=newMorphId
    model.gltf.meshes.forEach((mesh, meshId) => {
        if (mesh.primitives.length === 0 || !mesh.primitives[0].targets) {
            return;
        }

        const numMorphs = mesh.primitives[0].targets.length;
        const newTargets = mesh.primitives.map(_ => []); // for each primitive
        const newExtraTargetNames = mesh.primitives.map(_ => []); // for each primitive

        let newMorphIx = 0;
        for (let morphIx = 0; morphIx < numMorphs; morphIx++) {
            const key = `${meshId}:${morphIx}`;
            if (!usedMeshIdMorphIdPairs.has(key)) {
                continue;
            }
            
            morphRemap.set(key, newMorphIx);
            mesh.primitives.forEach((prim, primIx) => {
                newTargets[primIx].push(prim.targets[morphIx]);
                newExtraTargetNames.push(
                    (prim.extras && prim.extras.targetNames) ? prim.extras.targetNames[morphIx] : "");
            });
            newMorphIx++;
        }

        mesh.primitives.forEach((prim, primIx) => {
            prim.targets = newTargets[primIx];
            if (prim.extras && prim.extras.targetNames) {
                prim.extras.targetNames = newExtraTargetNames;
            }
        });        
    });
    console.log("Morph remap", morphRemap);

    // Apply delta to blendshapes.
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups.forEach(group => {
        group.binds.forEach(bind => {
            const key = `${bind.mesh}:${bind.index}`;
            console.assert(morphRemap.has(key));
            bind.index = morphRemap.get(key);
        });
    });
}

function isUniformPrimitive(model) {
    return model.gltf.meshes.every(mesh => {
        if (mesh.primitives.length === 0) {
            return true;
        }

        const refPrim = mesh.primitives[0];
        return mesh.primitives.every(prim => {
            if (refPrim.targets === undefined) {
                return prim.targets === undefined;
            }
            return prim.targets.length === refPrim.targets.length;
        });
    });
}
