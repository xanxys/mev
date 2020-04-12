// ES6
import { deserializeGlb, serializeGlb } from './gltf.js';

/**
 * 
 * @param {THREE.Object3D} obj 
 */
function summarizeObject(obj) {
    const stats = {
        numObjects: 0,
        perTypeNumObjects: {},
    };
    obj.traverse(o => {
        stats.numObjects++;
        stats.perTypeNumObjects[o.type] = (stats.perTypeNumObjects[o.type] || 0) + 1;
    });
    return stats;
}

class VrmIdentityTester {
    constructor() {
        this.testDataRepository = "http://localhost:8080";
    }

    run() {
        window.fetch(this.testDataRepository + "/index.json", { mode: "cors" })
            .then(response => response.json())
            .then(testDataIndex => {
                console.log("Downloaded:", testDataIndex);

                testDataIndex.vrm.forEach(file => {
                    QUnit.test("GLB-s/d/s/d-identity: " + file, assert => {
                        const done = assert.async();

                        const vrmUrl = this.testDataRepository + "/" + file;
                        window.fetch(vrmUrl, { mode: "cors" })
                            .then(response => response.arrayBuffer())
                            .then(origGlb => {
                                const baseGlb = serializeGlb(deserializeGlb(origGlb));
                                const reserializedGlb = serializeGlb(deserializeGlb(baseGlb));
                                // origGlb == baseGlb is too strict;
                                // JSON.encode difference e.g. https://gyazo.com/594c683bcc51ae4b1f466e028f45fb80
                                assert.equal(reserializedGlb.byteLength, baseGlb.byteLength);
                                done();
                            });
                    });
                });
            });
    }
}

function main() {
    new VrmIdentityTester().run();
}

main();
