// ES6
import {VrmModel} from "./vrm.js";

// model will be mutated
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

    extremeResizeTexture(model);
    model.version += 1;
}

function extremeResizeTexture(model) {
    for (let i = 0; i < model.gltf.images.length; i++) {
        const imageBlob = model.getImageAsBuffer(i);

        Jimp.read(imageBlob).then(img => {
            console.log("image read", i, img);
        });

    }
    


}