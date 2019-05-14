// ES6
import { deserializeVrm, serializeVrm } from './vrm.js';

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
                    QUnit.test("sd-identity: " + file, assert => {
                        const done = assert.async();

                        const vrmUrl = this.testDataRepository + "/" + file;
                        window.fetch(vrmUrl, { mode: "cors" })
                            .then(response => response.arrayBuffer())
                            .then(deserializeVrm)
                            .then(origVrm => {
                                return serializeVrm(origVrm)
                                    .then(deserializeVrm)
                                    .then(sdVrm => {
                                        // TODO: compare
                                        const origSummary = summarizeObject(origVrm);
                                        const sdSummary = summarizeObject(sdVrm);

                                        assert.deepEqual(sdSummary, origSummary);
                                        done();
                                    })
                                    .catch(err => {
                                        assert.ok(false, err);
                                        done();
                                    });
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
