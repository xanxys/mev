
/**
 * Converts {THREE.Object3D} into human-readable object tree multi-line string.
 */
export function objectToTreeDebug(obj) {
    function convert_node(o) {
        return {
            name: o.name,
            type: o.type,
            children: o.children.map(convert_node),
        };
    }
    return JSON.stringify(convert_node(obj), null, 2);
}

/**
 * Flatten array of array into an array.
 * `[[1, 2], [3]] -> [1, 2, 3]`
 */
export function flatten(arr) {
    return [].concat.apply([], arr);
}

/**
 * 
 * @param {Object} blendshape in VRM extension
 */
export function blendshapeToEmotionId(blendshape) {
    return blendshape.presetName !== "unknown" ? blendshape.presetName : blendshape.name;
}