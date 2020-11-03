// ES6
import { setupStartDialog } from './components/start-dialog.js';
import { MinHeap, setSub, mapMerge, multimapAdd} from "./vrm-reducer/algorithm.js";


class ArrayPacking {
    /**
     * @param {Set<number>} usedIxs
     * @param {number} length
     */
    constructor(usedIxs, length) {
        console.assert(0 <= length);
        usedIxs.forEach(ix => console.assert(0 <= ix && ix < length));
        this.length = length;
        
        const mapping = new Map();
        let newIx = 0;
        for (const oldIx of Array.from(usedIxs).sort((a, b) => a - b)) {
            mapping.set(oldIx, newIx);
            newIx++;
        }
        this.mapping = mapping;
    }

    convert(oldIx) {
        console.assert(this.mapping.has(oldIx));
        return this.mapping.get(oldIx);
    }

    /**
     * @param {any[]} array
     * @returns {any[]} packed array
     */
    apply(array) {
        console.assert(array.length === this.length, `expected:${this.length} observed:${array.length}`);
        return array.filter((_, ix) => this.mapping.has(ix));
    }
}

class IndexMergeTracker {
    constructor() {
        this.mapping = new Map();
    }

    /**
     * 
     * @param {number} to: old index
     * @param {number} from: old index
     */
    mergePair(to, from) {
        to = this.resolve(to);
        from = this.resolve(from);
        if (to === from) {
            // it's possible they're already merged indirectly.
            // (e.g. after mergePair(0, 1), mergePair(1, 2), resolve(1) == resolve(2) == 0)
            return;
        }
        this.mapping.set(from, to);
    }

    /**
     * Lookup latest index corresponding to ix.
     * @param {number} ix: index in some merging state
     */
    resolve(ix) {
        if (!this.mapping.has(ix)) {
            return ix;
        }

        const latestIx = this.resolve(this.mapping.get(ix));
        this.mapping.set(ix, latestIx); // update cache to accelerate future resolve
        return latestIx;
    }
}


/**
 * Reduces the number of triangles somewhat smartly.
 * "Surface Simplification Using Quadric Error Metrics" (1997)
 * https://www.cs.cmu.edu/~./garland/Papers/quadrics.pdf
 * 
 * @param {number} target number of vertices (0.3: reduce to 30% of vertices)
 */
function reduceMesh(meshData, target) {
    function initErrorMatrix() {
        return new Float64Array(16); // row major (m11, m12, m13, m14, m21, ...)
    }
    function accumErrorMatrix(m, plane) {
        console.assert(m.length === 16);
        console.assert(plane.length === 4);

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                m[i * 4 + j] += plane[i] * plane[j];
            }
        }
    }
    function getError(m, v) {
        console.assert(m.length === 16);
        console.assert(v.length === 3);
        v = [v[0], v[1], v[2], 1];

        const u = [0, 0, 0, 0]; // <- mul(m, v)
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                u[i] += m[i * 4 + j] * v[j];
            }
        }
        let s = 0; // <- dot(v, u)
        for (let i = 0; i < 4; i++) {
            s += v[i] * u[i];
        }
        return Math.max(s, 0); // since this is quadaratic op, result must be >=0 (negative result is due to numerical error)
    }
    function combineErrorMatrix(m0, m1) {
        const mcombined = new Float64Array(16);
        for (let i = 0; i < 16; i++) {
            mcombined[i] = m0[i] + m1[i];
        }
        return mcombined;
    }

    // assuming CCW triangle
    function v3sub(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }
    function v3normalize(a) {
        const k = 1 / Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        return [a[0] * k, a[1] * k, a[2] * k];
    }
    function v3cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function v3dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    // returns [a,b,c,d] such that ax + by + cz + d = 0, |(a,b,c)| = 1
    function computePlane(p0, p1, p2) {
        const n = v3normalize(v3cross(v3sub(p1, p0), v3sub(p2, p0)));
        const d = -v3dot(p0, n);
        return [n[0], n[1], n[2], d];
    }

    const pos = meshData.attr_pos;
    const tris = meshData.indices;
    console.assert(tris.length % 3 === 0);

    const vertexErrorMatrix = new Map(); // vix:error matrix
    for (let i = 0; i < tris.length; i+=3) {
        const vix0 = tris[i + 0];
        const vix1 = tris[i + 1];
        const vix2 = tris[i + 2];
        const plane = computePlane(pos[vix0], pos[vix1], pos[vix2]);
        for (const vix of [vix0, vix1, vix2]) {
            const m = vertexErrorMatrix.get(vix) ?? initErrorMatrix();
            accumErrorMatrix(m, plane);
            vertexErrorMatrix.set(vix, m);
        }
    }
    console.log("vertex error matrix", vertexErrorMatrix);

    const vertexMergeTracker = new IndexMergeTracker();

    const vps = new Set(); // vix(small):vix(large)
    function encodeVPair(va, vb) {
        return va < vb ? `${va}:${vb}` : `${vb}:${va}`;
    }
    function decodeVPair(vp) {
        return vp.split(':').map(s => parseInt(s));
    }

    function computeVPError(vix0, vix1) {
        const mcombined = combineErrorMatrix(vertexErrorMatrix.get(vix0), vertexErrorMatrix.get(vix1));
        // TODO: Solve for quadratic minimum.
        const e0 = getError(mcombined, pos[vix0]);
        const e1 = getError(mcombined, pos[vix1]);
        if (e0 < e1) {
            return [e0, vix0];
        } else {
            return [e1, vix1];
        }
    }

    const vpReductionHeap = new MinHeap();
    const vertexToVps = new Map();
    for (let i = 0; i < tris.length; i+=3) {
        const vix0 = tris[i + 0];
        const vix1 = tris[i + 1];
        const vix2 = tris[i + 2];
        vps.add(encodeVPair(vix0, vix1));
        vps.add(encodeVPair(vix1, vix2));
        vps.add(encodeVPair(vix2, vix0));
        vpReductionHeap.insert(encodeVPair(vix0, vix1), computeVPError(vix0, vix1)[0]);
        vpReductionHeap.insert(encodeVPair(vix1, vix2), computeVPError(vix1, vix2)[0]);
        vpReductionHeap.insert(encodeVPair(vix2, vix0), computeVPError(vix2, vix0)[0]);

        multimapAdd(vertexToVps, vix0, encodeVPair(vix0, vix1), encodeVPair(vix2, vix0));
        multimapAdd(vertexToVps, vix1, encodeVPair(vix1, vix2), encodeVPair(vix0, vix1));
        multimapAdd(vertexToVps, vix2, encodeVPair(vix2, vix0), encodeVPair(vix1, vix2));
    }
    console.log("VPRedH", vpReductionHeap);

    // TODO: Re-compute error after each reduction.
    const numReductionIter = 50; // Math.floor(vps.size * (1 - target))
    for (let i = 0; i < numReductionIter; i++) {
        const [vp, err] = vpReductionHeap.popmin();
        let [v0, v1] = decodeVPair(vp);

        const diff = v3sub(pos[v0], pos[v1]);
        const vlen = Math.sqrt(v3dot(diff, diff));
        console.log(`Reducing ${v0},${v1} err=${err}, d=${vlen}`);

        v0 = vertexMergeTracker.resolve(v0);
        v1 = vertexMergeTracker.resolve(v1);
        if (v0 === v1) {
            continue; // VP candidate became degenerate due to previous VP collapses.
        }

        const [_, vdst] = computeVPError(v0, v1);
        const vsrc = (vdst === v0) ? v1 : v0;

        const mcombined = combineErrorMatrix(vertexErrorMatrix.get(v0), vertexErrorMatrix.get(v1));
        vertexMergeTracker.mergePair(vdst, vsrc);
        vertexErrorMatrix.set(vdst, mcombined);
        multimapAdd(vertexToVps, vdst, ...(vertexToVps.get(vsrc) || []));

        // Recompute error heap.
        const affectedVps = new Set(vertexToVps.get(vdst) || []);
        for (const vp of affectedVps) {
            let [v0, v1] = decodeVPair(vp);
            v0 = vertexMergeTracker.resolve(v0);
            v1 = vertexMergeTracker.resolve(v1);
            const [err, _] = computeVPError(v0, v1);

            // WARNING: This will result in O(V^2 log(V)) time.
            for (let eix = 0; eix < vpReductionHeap.size(); eix++) {
                const e = vpReductionHeap.tree[eix];
                if (affectedVps.has(e[0])) {
                    if (e[1] < err) { // error nerve become smaller, that's why fix_down is enough.
                        vpReductionHeap.tree[eix][1] = err;
                        vpReductionHeap._fix_invariance_down(eix);
                    }
                    break;
                }
            }
        }
    }

    // remove degenerate tris
    // Encode triangle's identity, assuming cyclic symmetry. (but not allowing flipping)
    function encodeTriKey(v0, v1, v2) {
        const vmin = Math.min(v0, v1, v2);
        if (v0 === vmin) {
            return `${v0}:${v1}:${v2}`;
        } else if (v1 === vmin) {
            return `${v1}:${v2}:${v0}`;
        } else {
            return `${v2}:${v0}:${v1}`;
        }
    }
    const triKeys = new Set();
    let newTris = [];
    for (let i = 0; i < tris.length; i+=3) {
        const vix0 = vertexMergeTracker.resolve(tris[i + 0]);
        const vix1 = vertexMergeTracker.resolve(tris[i + 1]);
        const vix2 = vertexMergeTracker.resolve(tris[i + 2]);
        if (vix0 === vix1 || vix1 === vix2 || vix2 === vix0) {
            continue; // omit
        }
        const key = encodeTriKey(vix0, vix1, vix2);
        if (triKeys.has(key)) {
            // Two different triangles can degenerate into single triangle after 3 VP collapses.
            continue; // omit
        }
        // accept
        newTris.push(vix0, vix1, vix2);
        triKeys.add(key);
    }
    console.assert(newTris.length <= tris.length);
    
    const allvs = new Set(newTris);
    const vertexPacking = new ArrayPacking(allvs, meshData.attr_pos.length);
    console.log(vertexPacking);

    return {
        indices: newTris.map(vix => vertexPacking.convert(vix)),
        attr_pos: vertexPacking.apply(meshData.attr_pos),
        attr_nrm: vertexPacking.apply(meshData.attr_nrm),
        attr_uv0: vertexPacking.apply(meshData.attr_uv0),
    };
}

function stripUnusedVerices(meshData) {
    const vertexPacking = new ArrayPacking(new Set(meshData.indices), meshData.attr_pos.length);
    return {
        indices: meshData.indices.map(vix => vertexPacking.convert(vix)),
        attr_pos: vertexPacking.apply(meshData.attr_pos),
        attr_nrm: vertexPacking.apply(meshData.attr_nrm),
        attr_uv0: vertexPacking.apply(meshData.attr_uv0),
    };
}

/**
 * Handle main debugger UI & all state. Start dialog is NOT part of this class.
 */
class MevReducerDebugger {
    constructor(width, height, canvasInsertionParent) {
        // Three.js canvas
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 50);
        this.camera.position.set(0, 1, -3);
        this.camera.lookAt(0, 0.9, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        // Recommended gamma values from https://threejs.org/docs/#examples/loaders/GLTFLoader
        this.renderer.gammaOutput = true;  // If set, then it expects that all textures and colors need to be outputted in premultiplied gamma.
        this.renderer.gammaFactor = 2.2;
        this.renderer.setSize(width, height);
        canvasInsertionParent.appendChild(this.renderer.domElement);
        window.onresize = _event => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.renderer.setSize(w, h);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        };

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        this.renderer.setClearColor(new THREE.Color("#f5f5f5"));
        this.scene.add(new THREE.DirectionalLight(0xffffff, 1.0));
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.3));

        this.asyncFont = new Promise((resolve, reject) => {
            const loader = new THREE.FontLoader();
            loader.load( '/ui_asset/helvetiker_regular.typeface.json', resolve);
        });

        // Overlay UI
        const app = this;
        this.vm = new Vue({
            el: '#vue_menu',
            data: {
                // Global
                startedLoading: false,
                meshData: {
                    indices: [],
                    attr_pos: [],
                    attr_uv0: [],
                    attr_nrm: [],
                },

                // UI mode
                isFatalError: false,
            },
            methods: {
                clickStripVertices: function() {
                    this.meshData = stripUnusedVerices(this.meshData);
                    this._regenerateThreeModel();
                },
                clickStep: function() {
                },
                clickReduce: function() {
                    this.meshData = reduceMesh(this.meshData, 0.5);
                    console.log(this.meshData);
                    this._regenerateThreeModel();
                },
                _regenerateThreeModel: function() {
                    const threeMeshObjectName = 'meshdata-vis';
                    const prevMesh = app.scene.getObjectByName(threeMeshObjectName);
                    if (prevMesh) {
                        app.scene.remove(prevMesh);
                    }

                    const geom = new THREE.Geometry();
                    this.meshData.attr_pos.forEach(p => geom.vertices.push(new THREE.Vector3(p[0], p[1], p[2])));
                    this.meshData.attr_uv0.forEach(p => geom.faceVertexUvs.push(new THREE.Vector2(p[0], p[1])));
        
                    for (let i = 0; i < this.meshData.indices.length; i+=3) {
                        geom.faces.push(new THREE.Face3(this.meshData.indices[i + 0], this.meshData.indices[i + 1], this.meshData.indices[i + 2]));
                    }
        
                    const mat = new THREE.MeshLambertMaterial();
                    const matWireframe = new THREE.MeshBasicMaterial({
                        wireframe: true,
                        wireframeLinewidth: 3,
                        color: new THREE.Color('coral'),
                    });
                    geom.computeFaceNormals();

                    //
                    const container = new THREE.Object3D();
                    container.name = threeMeshObjectName;

                    // Add tris
                    container.add(new THREE.Mesh(geom, mat));
                    container.add(new THREE.Mesh(geom, matWireframe));

                    // Add index texts
                    const textMat = new THREE.MeshBasicMaterial({color: new THREE.Color('black')});
                    app.asyncFont.then(font => {
                        this.meshData.attr_pos.slice(0, 500).forEach((pos, ix) => {
                            const geom = new THREE.TextGeometry(`${ix}`, {
                                font: font,
                                size: 0.001,
                                height: 0.0001,
                                curveSegments: 4,
                            });
                            const o = new THREE.Mesh(geom, textMat);
                            o.position.set(...pos);

                            container.add(o);
                        });
                    });
                    
                    app.scene.add(container);
                },
                _focus: function() {
                    app.controls.target = new THREE.Vector3(...this.meshData.attr_pos[0]);
                },
            },
            computed: {
                numTris: function() {
                    return this.meshData.indices.length / 3;
                },
                numVerts: function() {
                    return this.meshData.attr_pos.length;
                },
            },
        });
    }

    /** Executes and renders single frame and request next frame. */
    animate() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.animate());
    }

    loadFbxOrVrm(vrmFile) {
        this.vm.startedLoading = true;

        // three-vrm currently doesn't have .parse() method, need to convert to data URL...
        // (inefficient)
        const reader = new FileReader();
        const app = this;

        // VRM
        reader.addEventListener("load", () => {
            const meshData = JSON.parse(new TextDecoder().decode(reader.result));
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
            this.scene.add(directionalLight);

            app.vm.meshData = meshData;
            app.vm._regenerateThreeModel();
            app.vm._focus();
        });
        reader.readAsArrayBuffer(vrmFile);
    }
}

function main() {
    const app = new MevReducerDebugger(window.innerWidth, window.innerHeight, document.body);
    setupStartDialog(file => {
        document.getElementById("vue_menu").style.display = "";
        app.loadFbxOrVrm(file);
    });
    app.animate();
}

main();