/**

 */

let firstTime = true;

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

export function setupDetailsDialog(vrmModel) {
    document.getElementById("vue_details_dialog").style.display = "block";
    if (!firstTime) {
        return;
    }

    const start_dialog = new Vue({
        el: "#vue_details_dialog",
        data: {
            detailsText: "",
        },
        methods: {
            clickCloseButton: function() {
                document.getElementById("vue_details_dialog").style.display = "none";
            },
            updateDetails: function(vrmModel) {
                const textureUsage = new Map();
                vrmModel.gltf.materials.forEach((mat, matId) => {
                    const matName = `mat(${mat.name})`;

                    const matProps = vrmModel.gltf.extensions.VRM.materialProperties;
                    if (matProps && matId < matProps.length) {
                        if (matProps[matId].textureProperties._ShadeTexture !== undefined) {
                            multimapAdd(
                                textureUsage, matProps[matId].textureProperties._ShadeTexture,
                                `${matName}.shade`);
                        }
                    }

                    if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture) {
                        const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
                        multimapAdd(textureUsage, texId, `${matName}.base`);
                    }
                    if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture) {
                        const texId = mat.pbrMetallicRoughness.metallicRoughnessTexture.index;
                        multimapAdd(textureUsage, texId, `${matName}.roughness`);
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


                // Chunks
                let details = "";
                details += "Chunks\n";
                details += "  " + JSON.stringify(vrmModel.gltf).length.toLocaleString("en-US") + " byte (JSON)\n";
                vrmModel.buffers.forEach(buffer => details += "  " + buffer.byteLength.toLocaleString("en-US") + " byte (binary)\n");

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

                details += vrmModel.countTotalTris().toLocaleString("en-US") + "tris";

                this.detailsText = details;
            },
        }
    });
    firstTime = false;

    start_dialog.updateDetails(vrmModel);
}