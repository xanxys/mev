// ES6
import { VrmModel } from './vrm.js';

export const TYPE_RMAP = {
    5120: "i8",
    5121: "u8",
    5122: "i16",
    5123: "u16",
    5124: "i32", // not allowed in glTF
    5125: "u32",
    5126: "f32",
};

export const TYPE_FMAP = {
    "i8": 5120,
    "u8": 5121,
    "i16": 5122,
    "u16": 5123,
    "i32": 5124,
    "u32": 5125,
    "f32": 5126,
};

export class VrmDependency {
    /**
     * @param {VrmModel} vrmModel
     */
    constructor(vrmModel) {
        const textureUsage = new Map();
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
        this.textureUsage = textureUsage;
    
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
        this.imageUsage = imageUsage;
    
        const accessorUsage = new Map();
        vrmModel.gltf.meshes.forEach((mesh, meshId) => {
            if (mesh.primitives.length === 0) {
                return;
            }
            const referencePrim = mesh.primitives[0];
    
            if (mesh.primitives.every(prim => prim.indices === referencePrim.indices) && mesh.primitives.length > 1) {
                multimapAdd(accessorUsage, referencePrim.indices, `mesh(${mesh.name}).prim[*].indices`);
            } else {
                mesh.primitives.forEach((prim, primId) => {
                    multimapAdd(accessorUsage, prim.indices, `mesh(${mesh.name}).prim[${primId}].indices`);
                });
            }
    
            if (mesh.primitives.every(prim => sameObject(prim.attributes, referencePrim.attributes)) && mesh.primitives.length > 1) {
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
            
            const accAttribs = [];
            accAttribs.push(`${accessor.type}<${TYPE_RMAP[accessor.componentType]}>`);
            accAttribs.push(`len:${accessor.count}`);
            if (accessor.byteOffset !== undefined && accessor.byteOffset !== 0) {
                accAttribs.push(`ofs:${accessor.byteOffset}`);
            }
            const accRef = `accessor(${accAttribs.join(",")})`;

            if (accessorUsage.has(accId)) {
                multimapAdd(viewUsage, viewId, ...accessorUsage.get(accId).map(usage => `${accRef} as ${usage}`));
            } else {
                multimapAdd(viewUsage, viewId, `${accRef} (not referenced)`);
            }
        });
        this.viewUsage = viewUsage;
    }

    /**
     * @returns {Set<number>}
     */
    getDirectlyUsedAccessors() {
        return new Set(this.accessorUsage.keys());
    }

    /**
     * @returns {Set<number>}
     */
    getDirectlyUsedBuffers() {
        return new Set(this.viewUsage.keys());
    }

    /**
     * @returns {Set<number>}
     */
    getDirectlyUsedTextures() {
        return new Set(this.textureUsage.keys());
    }

    /**
     * @returns {Set<number>}
     */
    getDirectlyUsedImages() {
        return new Set(this.imageUsage.keys());
    }
}

/**
 * @param {Map<any, any>} map to be mutated
 * @param {any} k key
 * @param {any[]} deltaVs
 */
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
