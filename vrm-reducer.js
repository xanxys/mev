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

    await removeAllBlendshapes(model);
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
}

/**
 * @returns {Promise<null>}
 */
async function removeUnusedMorphs(model) {
}