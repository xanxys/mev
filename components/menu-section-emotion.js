import { traverseMorphableMesh } from '/mev-util.js';

Vue.component(
    "menu-section-emotion", {
        template: "#menu_section_emotion",
        props: ["presetName", "allWeightCandidates", "weightConfigs", "blendshapeMaster"],
        data: function () {
            return {
                searchQuery: "",
            };
        },
        methods: {
            onChangeWeight: function (event, weightConfig) {
                const newWeight = event.srcElement.valueAsNumber * 0.01;

                traverseMorphableMesh(weightConfig.meshRef, mesh => {
                    mesh.morphTargetInfluences[weightConfig.morphIndex] = newWeight;
                });
                this.blendshapeMaster.blendShapeGroups.forEach(bs => {
                    if (bs.presetName !== this.presetName) {
                        return;
                    }
                    bs.binds.forEach(bind => {
                        if (bind.mesh === weightConfig.meshRef && bind.index === weightConfig.morphIndex) {
                            bind.weight = newWeight * 100;
                        }
                    });
                });
            },
            clickAddWeight: function () {
                // TODO: Display search box & focus.
            },
            addWeight: function (weightCandidate) {
                this.blendshapeMaster.blendShapeGroups.forEach(bs => {
                    if (bs.presetName !== this.presetName) {
                        return;
                    }
                    bs.binds.push({
                        weight: 100.0,
                        index: weightCandidate.morphIndex,
                        mesh: weightCandidate.mesh,
                    });
                });
            },
        },
        computed: {
            weightCandidates: function () {
                const morphNamesInUse = new Set(this.weightConfigs.map(config => config.morphName));
                return this.allWeightCandidates
                    .filter(candidate => !morphNamesInUse.has(candidate.morphName) && candidate.morphName.indexOf(this.searchQuery) >= 0);
            },
        }
    },
);