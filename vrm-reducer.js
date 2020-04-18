// ES6
import { VrmModel } from "./vrm-core/vrm.js";
import { VrmDependency } from "./vrm-core/deps.js";

/**
 * @param {VrmModel} model: will be mutated
 * @returns {Promise<null>}
 */
export async function reduceVrm(model) {
    // TODO:
    // merging multiple blendshapes in a blendshape group
    // Remove non-moving bones & weights
    // Remove nodes
    // mesh merging
    // atlas-ing
    // vertex reduction
    // float-quantization

    await deleteNonEssentialBones(model);
    await deleteVrmThumbnail(model);
    await extremeResizeTexture(model, 128);
    await stripAllEmotions(model);
    await removeUnusedMorphs(model);
    await removeUnusedTextures(model);
    await removeUnusedImages(model);
    await removeUnusedAccessors(model);
    await removeUnusedBufferViews(model);
    // await removeAllNames(model);
    model.repackBuffer();
    return null;
}

async function deleteVrmThumbnail(model) {
    delete model.gltf.extensions.VRM.meta.texture;
    model.version += 1;
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

async function deleteNonEssentialBones(model) {
    model.gltf.extensions.VRM.secondaryAnimation.boneGroups = [];

    // TODO:
    // Remove node, joint, bindMatrix, weight

    model.version += 1;
}

/**
 * Delete all blendshape groups.
 * @returns {Promise<null>}
 */
async function stripAllEmotions(model) {
    model.gltf.extensions.VRM.blendShapeMaster.blendShapeGroups = [];
    model.version += 1;
}

/**
 * Strip all label/names for human.
 * @returns {Promise<null>}
 */
async function removeAllNames(model) {
    model.gltf.images.forEach((image, imageIx) => {
        delete image.name;
    });

    // me/v renderer somehow depends on material name constancy.
    // renaming like m1, m2 also doesn't work.
    /*
    model.gltf.materials.forEach((mat, matIx) => {
        mat.name = `m${matIx}`;
    });
    */
    
    model.gltf.meshes.forEach(mesh => {
        delete mesh.name;
        mesh.primitives.forEach(prim => {
            if (prim.extras && prim.extras.targetNames) {
                delete prim.extras.targetNames;
            }
        });
    });
    model.gltf.nodes.forEach(node => {
        delete node.name;
    });
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

/**
 * @returns {Promise<null>}
 */
async function removeUnusedAccessors(model) {
    const deps = new VrmDependency(model);
    const usedIds = deps.getDirectlyUsedAccessors();

    // Execute deletion.
    const accIdChanges = new Map(); // key=old accId value=new accId
    let newAccs = [];
    let newAccId = 0;
    model.gltf.accessors.forEach((acc, accId) => {
        if (!usedIds.has(accId)) {
            return;
        }
        accIdChanges.set(accId, newAccId);
        newAccs.push(acc);
        newAccId++;
    });
    model.gltf.accessors = newAccs;
    console.log("accessor id changes", accIdChanges);

    // Apply changes.
    model.gltf.meshes.forEach(mesh => {    
        mesh.primitives.forEach(prim => {
            console.assert(accIdChanges.has(prim.indices));
            prim.indices = accIdChanges.get(prim.indices);
        
            const newAttribs = {};
            Object.entries(prim.attributes).forEach(([attribName, accId]) => {
                console.assert(accIdChanges.has(accId));
                newAttribs[attribName] = accIdChanges.get(accId);
            });
            prim.attributes = newAttribs;

            if (prim.targets) {
                prim.targets = prim.targets.map(target => {
                    const newTarget = {};
                    Object.entries(target).forEach(([attribName, accId]) => {
                        console.assert(accIdChanges.has(accId));
                        newTarget[attribName] = accIdChanges.get(accId);
                    });
                    return newTarget;
                });
            }
        });
    });
    model.gltf.skins.forEach(skin => {
        console.assert(accIdChanges.has(skin.inverseBindMatrices));
        skin.inverseBindMatrices = accIdChanges.get(skin.inverseBindMatrices);
    });
}

/**
 * @returns {Promise<null>}
 */
async function removeUnusedTextures(model) {
    const deps = new VrmDependency(model);
    const usedIds = deps.getDirectlyUsedTextures();

    // Execute deletion.
    const texIdChanges = new Map(); // key=old viewid value=new viewid
    let newTexs = [];
    let newTexId = 0;
    model.gltf.textures.forEach((tex, texId) => {
        if (!usedIds.has(texId)) {
            return;
        }
        texIdChanges.set(texId, newTexId);
        newTexs.push(tex);
        newTexId++;
    });
    model.gltf.textures = newTexs;
    console.log("texture id changes", texIdChanges);

    // Apply changes.
    if (model.gltf.extensions.VRM.meta && model.gltf.extensions.VRM.meta.texture !== undefined) {
        console.assert(texIdChanges.has(model.gltf.extensions.VRM.meta.texture));
        model.gltf.extensions.VRM.meta.texture = texIdChanges.get(model.gltf.extensions.VRM.meta.texture);
    }
    model.gltf.materials.forEach((mat, matId) => {
        const matProps = model.gltf.extensions.VRM.materialProperties;
        if (matProps && matId < matProps.length) {
            Object.entries(matProps[matId].textureProperties).forEach(([propName, texId]) => {
                console.assert(texIdChanges.has(texId));
                matProps[matId].textureProperties[propName] = texIdChanges.get(texId);
            });
        }

        if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture) {
            const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
            console.assert(texIdChanges.has(texId));
            mat.pbrMetallicRoughness.baseColorTexture.index = texIdChanges.get(texId);
        }
        if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture) {
            const texId = mat.pbrMetallicRoughness.metallicRoughnessTexture.index;
            console.assert(texIdChanges.has(texId));
            mat.pbrMetallicRoughness.metallicRoughnessTexture.index = texIdChanges.get(texId);
        }
        if (mat.emissiveTexture) {
            const texId = mat.emissiveTexture.index;
            console.assert(texIdChanges.has(texId));
            mat.emissiveTexture.index = texIdChanges.get(texId);
        }
    });
}

async function removeUnusedImages(model) {
    const deps = new VrmDependency(model);
    const usedIds = deps.getDirectlyUsedImages();

    // Execute deletion.
    const imgIdChanges = new Map(); // key=old viewid value=new viewid
    let newImgs = [];
    let newImgId = 0;
    model.gltf.images.forEach((img, imgId) => {
        if (!usedIds.has(imgId)) {
            return;
        }
        imgIdChanges.set(imgId, newImgId);
        newImgs.push(img);
        newImgId++;
    });
    model.gltf.images = newImgs;
    console.log("image id changes", imgIdChanges);

    // Apply changes.
    model.gltf.textures.forEach((tex, texId) => {
        console.assert(imgIdChanges.has(tex.source));
        tex.source = imgIdChanges.get(tex.source);
    });
}

/**
 * @returns {Promise<null>}
 */
async function removeUnusedBufferViews(model) {
    const deps = new VrmDependency(model);
    const usedIds = deps.getDirectlyUsedBuffers();

    // Execute deletion.
    const viewIdChanges = new Map(); // key=old viewid value=new viewid
    let newViews = [];
    let newViewId = 0;
    model.gltf.bufferViews.forEach((view, viewId) => {
        if (!usedIds.has(viewId)) {
            return;
        }
        viewIdChanges.set(viewId, newViewId);
        newViews.push(view);
        newViewId++;
    });
    model.gltf.bufferViews = newViews;
    console.log("bufferView id changes", viewIdChanges);

    // Apply changes.
    model.gltf.images.forEach(img => {
        const oldViewId = img.bufferView;
        console.assert(viewIdChanges.has(oldViewId));
        img.bufferView = viewIdChanges.get(oldViewId);
    });
    model.gltf.accessors.forEach(accessor => {
        const oldViewId = accessor.bufferView;
        console.assert(viewIdChanges.has(oldViewId));
        accessor.bufferView = viewIdChanges.get(oldViewId);
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
