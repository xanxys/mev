// ES6
import { VrmModel } from './vrm.js';

export class VrmDependency {
    /**
     * @param {VrmModel} vrmModel
     */
    constructor(vrmModel) {
        const textureUsage = new Map();
        // ROOT
        if (vrmModel.gltf.extensions.VRM.meta && vrmModel.gltf.extensions.VRM.meta.texture !== undefined) {
            multimapAdd(textureUsage, vrmModel.gltf.extensions.VRM.meta.texture, "VRM-thumbnail");
        }
        vrmModel.gltf.materials.forEach((mat, matId) => {
            const matName = `mat(${mat.name})`;
    
            const matProps = vrmModel.gltf.extensions.VRM.materialProperties;
            if (matProps && matId < matProps.length) {
                Object.entries(matProps[matId].textureProperties).forEach(([propName, texId]) => {
                    multimapAdd(
                        textureUsage, texId, `${matName}.vrm${propName}`);
                })
            }
    
            if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture) {
                const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
                multimapAdd(textureUsage, texId, `${matName}.pbr_baseColor`);
            }
            if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture) {
                const texId = mat.pbrMetallicRoughness.metallicRoughnessTexture.index;
                multimapAdd(textureUsage, texId, `${matName}.pbr_roughness`);
            }
            if (mat.emissiveTexture) {
                multimapAdd(textureUsage, mat.emissiveTexture.index, `${matName}.emission`);
            }
        });
        console.log("texture", textureUsage);
    
        const imageUsage = new Map();
        vrmModel.gltf.textures.forEach((tex, texId) => {
            const imgId = tex.source;
            const texRef = "tex";
            if (textureUsage.has(texId)) {
                multimapAdd(imageUsage, imgId, ...textureUsage.get(texId).map(usage => `${texRef} as ${usage}`));
            } else {
                // TODO: want to include "(not referenced)" when material texture scanning become exhaustive.
                multimapAdd(imageUsage, imgId, `${texRef}`);
            }
        });
        console.log("image", imageUsage);
    
        const accessorUsage = new Map();
        vrmModel.gltf.meshes.forEach((mesh, meshId) => {
            if (mesh.primitives.length === 0) {
                return;
            }
            const referencePrim = mesh.primitives[0];
    
            if (mesh.primitives.every(prim => prim.indices === referencePrim.indices)) {
                multimapAdd(accessorUsage, referencePrim.indices, `mesh(${mesh.name}).prim[*].indices`);
            } else {
                mesh.primitives.forEach((prim, primId) => {
                    multimapAdd(accessorUsage, prim.indices, `mesh(${mesh.name}).prim[${primId}].indices`);
                });
            }
    
            if (mesh.primitives.every(prim => sameObject(prim.attributes, referencePrim.attributes))) {
                Object.entries(referencePrim.attributes).forEach(([attribName, accId]) => {
                    multimapAdd(accessorUsage, accId, `mesh(${mesh.name}).prim[*].${attribName}`);
                });
            } else {
                mesh.primitives.forEach((prim, primId) => {
                    Object.entries(prim.attributes).forEach(([attribName, accId]) => {
                        multimapAdd(accessorUsage, accId, `mesh(${mesh.name}).prim[${primId}].${attribName}`);
                    });
                });
            }
    
            mesh.primitives.forEach((prim, primId) => {
                if (prim.targets) {
                    prim.targets.forEach((target, targetId) => {
                        Object.entries(target).forEach(([attribName, accId]) => {
                            multimapAdd(accessorUsage, accId, `mesh(${mesh.name}).prim[${primId}].morph[${targetId}].${attribName}`);
                        });
                    });                        
                }
            });
        });
        vrmModel.gltf.skins.forEach((skin, skinId) => {
            multimapAdd(accessorUsage, skin.inverseBindMatrices, `skin(${skin.name}).bindMatrix`);
        });
        this.accessorUsage = accessorUsage;
        console.log("accessor", accessorUsage);
    
        const viewUsage = new Map();
        vrmModel.gltf.images.forEach((img, imgId) => {
            const viewId = img.bufferView;
            const imgRef = `img(${img.name},${img.mimeType})`;
            if (imageUsage.has(imgId)) {
                multimapAdd(viewUsage, viewId, ...imageUsage.get(imgId).map(usage => `${imgRef} as ${usage}`));
            } else {
                multimapAdd(viewUsage, viewId, `${imgRef} (not referenced)`);
            }
        });
        vrmModel.gltf.accessors.forEach((accessor, accId) => {
            const viewId = accessor.bufferView;
            const accRef = `accessor(${accessor.type},${accessor.byteOffset})`;
            if (accessorUsage.has(accId)) {
                multimapAdd(viewUsage, viewId, ...accessorUsage.get(accId).map(usage => `${accRef} as ${usage}`));
            } else {
                multimapAdd(viewUsage, viewId, `${accRef} (not referenced)`);
            }
        });
        console.log("view", viewUsage);
        this.viewUsage = viewUsage;
    }

    getDirectlyUsedAccessors() {
        return new Set(this.accessorUsage.keys());
    }

    /**
     * @returns {Set<number>}
     */
    getUsedBufferViewIds() {
        const result = new Set();
        for (let [viewId, usages] of this.viewUsage) {
            if (usages.length == 0) {
                continue;
            }
            // TODO: Do root-check more reliably.
            if (usages.length == 1 && usages[0].endsWith("(not referenced)")) {
                continue;
            }
            result.add(viewId);
        }
        return result;
    }
}

function multimapAdd(map, k, ...deltaVs) {
    let vs = map.get(k) || [];
    vs.push(...deltaVs);
    map.set(k, vs);
}

function sameObject(a, b) {
    if (Object.entries(a).length !== Object.entries(b).length) {
        return false;
    }
    for (const k in a) {
        if (a[k] !== b[k]) {
            return false;
        }
    }
    return true;
}
