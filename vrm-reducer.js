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
function extremeResizeTexture(model, maxTexSizePx) {
    const resizePromises = [];
    for (let i = 0; i < model.gltf.images.length; i++) {
        const bufferViewIx = model.gltf.images[i].bufferView;
        const imageBlob = model.getImageAsBuffer(i);

        resizePromises.push(
            Jimp.read(imageBlob)
                .then(img => img.scaleToFit(maxTexSizePx, maxTexSizePx).getBufferAsync("image/png"))
                .then(imgSmallBlob => model.setBufferData(bufferViewIx, imgSmallBlob)));
    }

    return Promise.all(resizePromises).then(_ =>model.repackBuffer());
}