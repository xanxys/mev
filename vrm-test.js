// ES6
import { deserializeVrm, serializeVrm } from './vrm.js';

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

                    window.fetch(vrmUrl, { mode: "cors" }).then(response => response.arrayBuffer()).then(vrmBlob => {
                        console.log(vrmBlob);
                        deserializeVrm(vrmBlob).then(vrm => {
                            const res = document.createElement("div");
                            const resMessage = document.createTextNode(file + " " + "OK");
                            res.appendChild(resMessage);
                            document.body.appendChild(res);
                        });
                    });
                });
            });

        // loadVrm();

        /*
        const vrmRoot  =     serializeVrm(app.vrmRoot).then(glbBuffer => {
            saveAs(new Blob([glbBuffer], { type: "application/octet-stream" }), "test.vrm");
        });
        */
    }
}

function main() {
    new VrmIdentityTester().run();
}

main();