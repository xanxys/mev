/**

 */

let firstTime = true;

function multimapAdd(map, k, ...deltaVs) {
    let vs = map.get(k) || [];
    vs.push(...deltaVs);
    map.set(k, vs);
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
                vrmModel.gltf.materials.forEach(mat => {
                    const matName = `mat(${mat.name})`;
                    if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture) {
                        const texId = mat.pbrMetallicRoughness.baseColorTexture.index;
                        multimapAdd(textureUsage, texId, `${matName}.baseColor`);
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
                    mesh.primitives.forEach((prim, primId) => {
                        multimapAdd(accessorUsage, prim.indices, `mesh(${mesh.name}).prim[${primId}].indices`);

                        Object.entries(prim.attributes).forEach(([attribName, accId]) => {
                            multimapAdd(accessorUsage, accId, `mesh(${mesh.name}).prim[${primId}].${attribName}`);
                        });

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