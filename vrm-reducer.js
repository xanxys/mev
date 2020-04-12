// ES6
import {VrmModel} from "./vrm.js";

/**
 * @param {VrmModel} model: will be mutated
 * @returns {Promise<null>}
 */
export function reduceVrm(model) {
    //// conditional lossless

    // Remove Blendshape weights
    // Remove non-moving bones & weights
    // Remove nodes
    // Blendshape group reduction

    //// lossy

    // mesh merging
    // atlas-ing
    // vertex reduction

    // PNG/JPG re-compress

    //// misc

    // float-quantization

    return extremeResizeTexture(model, 128);
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
