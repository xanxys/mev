
/**
 * Converts {THREE.Object3D} into human-readable object tree multi-line string.
 * @param {THREE.Object3D} obj
 */
export function objectToTreeDebug(obj) {
    /**
     * @param {{ name: any; type: any; children: any[]; }} o
     */
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
 * @param {any[][]} arr
 * @returns {any[]}
 */
export function flatten(arr) {
    return [].concat.apply([], arr);
}

/**
 * @param {Object} blendshape in VRM extension
 * @returns {string}
 */
export function blendshapeToEmotionId(blendshape) {
    return blendshape.presetName !== "unknown" ? blendshape.presetName : blendshape.name;
}
