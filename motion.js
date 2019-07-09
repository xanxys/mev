import { VrmModel, VrmRenderer } from './vrm.js';

/**
 * Player of motion capture data.
 * 
 * Supports ASF/AMC format converted into (open-motion.org) JSON format.
 * 
 * Example data:
 * ID: http://mocap.cs.cmu.edu/search.php?subjectnumber=%&motion=%
 * - 01_09: good complex 3D movement
 * - 09_12: walk in various direction
 * - 40_10: "wait for bus" movement (good for idle)
 * 
 * e.g. "https://s3.amazonaws.com/open-motion.herokuapp.com/json/40_10.json"
 */
export class MotionPlayer {
    constructor(asfMotionFramesJson) {
        this.motionFrames = asfMotionFramesJson.motion;
        this.motionFrameIndex = 0;
        this.retargetingYOffset = null;
    }

    /**
     * Step single frame (assuming 60 FPS). Might skip / repeat motion frames to match rendering rate.
     * @param {VrmModel?} vrmRoot 
     * @param {VrmRenderer?} vrmRenderer
     */
    stepFrame(vrmRoot, vrmRenderer) {
        // Get single frame from cyclic motion frames
        if (this.motionFrameIndex >= this.motionFrames.length) {
            this.motionFrameIndex = 0;
        }
        const currentMotion = this.motionFrames[this.motionFrameIndex];
        if (this.motionFrameIndex === 100 && this.motionFrames.length > 0) {
            console.log("Motion frame example:", currentMotion);
        }
        this.motionFrameIndex += 2;

        // TODO: apply
        if (!(vrmRoot && vrmRenderer)) {
            return;
        }
        const inst = vrmRenderer.getThreeInstance();

        // Motion data -> VRM humanoid bone name
        const lrMapping = new Map([
            ["clavicle", "Shoulder"], // almost 0
            ["humerus", "UpperArm"],
            ["radius", "LowerArm"], // {rx}
            ["wrist", "Hand"],
            ["femur", "UpperLeg"],
            ["tibia", "LowerLeg"],
            ["foot", "Foot"],
            ["toes", "Toes"],

            ["thumb", "ThumbProximal"],
        ]);
        const mapping = new Map([
            ["root", "hips"],
            ["thorax", "chest"],
            ["lowerneck", "neck"], // upperneck??
            ["head", "head"],
        ]);
        lrMapping.forEach((vrmName, motionName) => {
            mapping.set("l" + motionName, "left" + vrmName);
            mapping.set("r" + motionName, "right" + vrmName);
        });

        const vrmNameToNodeIndex =
            new Map(vrmRoot.gltf.extensions.VRM.humanoid.humanBones.map(bone => [bone.bone, bone.node]));


        // Coordinate Systems:
        // VRM/three: https://gyazo.com/19731bf972cdd0fee866ee03d8634785
        // ASF/AMC: https://gyazo.com/6e8f786af0028d6effcb6bb77202b428

        if (inst !== null) {

            // In T-pose, toe.y must be > 0 and model should be perfectly touching surface.
            let toeToFloor = 0;
            if (this.retargetingYOffset === null) {
                const nodeIndex = vrmNameToNodeIndex.get("leftToes");
                if (nodeIndex !== undefined) {
                    const bone = vrmRenderer.getNodeByIndex(nodeIndex);
                    toeToFloor = bone.getWorldPosition(new THREE.Vector3()).y;
                }
            }


            mapping.forEach((boneName, asfName) => {
                const nodeIndex = vrmNameToNodeIndex.get(boneName);
                const bone = vrmRenderer.getNodeByIndex(nodeIndex);
                const val = currentMotion[asfName];
                if (!bone) {
                    return;
                }
                if (!bone || !val) {
                    console.log("Not found", boneName, bone, asfName, val);
                    return;
                }

                if (asfName === "root") {
                    const offset = this.retargetingYOffset === null ? 0 : this.retargetingYOffset;
                    bone.position.set(-val.tx, val.ty + offset, -val.tz);
                }

                if (boneName.includes("UpperArm")) {
                    const xz = new THREE.Vector2(val.rx, val.rz);

                    const clavicleRot = 0.40; // from sekelton.rclavicle (XY)
                    const isq2 = 1 / Math.sqrt(2);

                    if (boneName === "rightUpperArm") {
                        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, isq2, isq2), val.rx);
                        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), val.ry);
                        const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, -isq2, isq2), val.rz);
                        const boneDeltaRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), clavicleRot);

                        qZ.multiply(qY);
                        qZ.multiply(qX);
                        qZ.multiply(boneDeltaRot);

                        bone.quaternion.copy(qZ);
                    } else {
                        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, -isq2, -isq2), val.rx);
                        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), val.ry);
                        const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, -isq2, isq2), val.rz);
                        const boneDeltaRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -clavicleRot);

                        qZ.multiply(qY);
                        qZ.multiply(qX);
                        qZ.multiply(boneDeltaRot);

                        bone.quaternion.copy(qZ);
                    }
                } else if (boneName.includes("leftLowerArm")) {
                    bone.quaternion.setFromEuler(new THREE.Euler(0, -val.rx, 0, "ZYX"));
                } else if (boneName.includes("rightLowerArm")) {
                    bone.quaternion.setFromEuler(new THREE.Euler(0, val.rx, 0, "ZYX"));
                } else if (boneName.includes("UpperLeg")) {
                    const legRotationZ = 0.350; // from skeleton.lfemur
                    bone.quaternion.multiplyQuaternions(
                        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), boneName === "leftUpperLeg" ? -legRotationZ : legRotationZ),
                        new THREE.Quaternion().setFromEuler(new THREE.Euler(-val.rx, val.ry, -val.rz, "ZYX"))
                    );
                } else if (boneName.includes("Foot") || boneName.includes("Toes")) {
                    bone.quaternion.setFromEuler(new THREE.Euler(-val.rx, val.rz, val.ry, "ZYX"));
                } else {
                    bone.quaternion.setFromEuler(new THREE.Euler(-val.rx || 0, val.ry || 0, -val.rz || 0, "ZYX"));
                }
            });

            // "lowerback", "upperback" -> "spine"
            {
                const nodeIndex = vrmNameToNodeIndex.get("spine");
                const bone = vrmRenderer.getNodeByIndex(nodeIndex);

                const lowerBackV = currentMotion["lowerback"];
                const lowerBackQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-lowerBackV.rx || 0, lowerBackV.ry || 0, -lowerBackV.rz || 0, "ZYX"));
                const upperBackV = currentMotion["upperback"];
                const upperBackQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-upperBackV.rx || 0, upperBackV.ry || 0, -upperBackV.rz || 0, "ZYX"));

                bone.quaternion.multiplyQuaternions(upperBackQ, lowerBackQ);
            }



            if (this.retargetingYOffset === null) {
                inst.updateMatrixWorld();

                const nodeIndex = vrmNameToNodeIndex.get("leftToes");
                const bone = vrmRenderer.getNodeByIndex(nodeIndex);
                this.retargetingYOffset = -(bone.getWorldPosition(new THREE.Vector3()).y - toeToFloor);
            }

        }
    }
}
