/**
 * 
 * @param {THREE.Object3D} root 
 * @param {Function<THREE.Object3D>} fn 
 */
export function traverseMorphableMesh(root, fn) {
    root.traverse(obj => {
        if (obj.type !== "Mesh" && obj.type !== "SkinnedMesh") {
            return;
        }
        if (!obj.morphTargetInfluences) {
            return;
        }
        fn(obj);
    });
}

/**
 * Flatten array of array into an array.
 * `[[1, 2], [3]] -> [1, 2, 3]`
 */
export function flatten(arr) {
    return [].concat.apply([], arr);
}