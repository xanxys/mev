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

// TODO: Consider using https://qunitjs.com/
class VrmIdentityTester {
    constructor() {
        this.testDataRepository = "http://localhost:8080";
    }

    run() {
        window.fetch(this.testDataRepository + "/index.json", { mode: "cors" }).then(response => response.json())
            .then(testDataIndex => {
                console.log("Downloaded:", testDataIndex);
                testDataIndex.vrm.forEach(file => {
                    const vrmUrl = this.testDataRepository + "/" + file;

                    window.fetch(vrmUrl, { mode: "cors" }).then(response => response.arrayBuffer())
                        .then(deserializeVrm)
                        .then(origVrm => {
                            serializeVrm(origVrm)
                                .then(deserializeVrm)
                                .then(sdVrm => {
                                    // TODO: compare
                                    const origSummary = summarizeObject(origVrm);
                                    const sdSummary = summarizeObject(sdVrm);

                                    if (JSON.stringify(origSummary) !== JSON.stringify(sdSummary)) {
                                        this.report(file + " " + "NG" + JSON.stringify(origSummary) + "  " + JSON.stringify(sdSummary));
                                    } else {
                                        this.report(file + " " + "OK");
                                    }
                                })
                                .catch(err => {
                                    this.report(file + " " + "NG" + err);
                                });

                        });
                });
            });
    }

    report(message) {
        const res = document.createElement("div");
        const resMessage = document.createTextNode(message);
        res.appendChild(resMessage);
        document.body.appendChild(res);
    }
}

function main() {
    new VrmIdentityTester().run();
}

main();