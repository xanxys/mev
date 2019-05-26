import { traverseMorphableMesh, blendshapeToEmotionId } from '../mev-util.js';

Vue.component(
    "menu-section-emotion", {
        template: "#menu_section_emotion",
        props: ["emotionId", "allWeightCandidates", "weightConfigs", "blendshapeMaster"],
        data: function () {
            return {
                searching: false,
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
                    if (blendshapeToEmotionId(bs) !== this.emotionId) {
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
                this.searching = true;
                // Need to delay, because searchbox is not created yet at this point.
                this.$nextTick(() => {
                    this.$refs.searchbox.focus();
                });
            },
            addWeight: function (weightCandidate) {
                const newWeight = 1.0;
                traverseMorphableMesh(weightCandidate.mesh, mesh => {
                    mesh.morphTargetInfluences[weightCandidate.morphIndex] = newWeight;
                });
                this.blendshapeMaster.blendShapeGroups.forEach(bs => {
                    if (blendshapeToEmotionId(bs) !== this.emotionId) {
                        return;
                    }
                    bs.binds.push({
                        weight: newWeight * 100,
                        index: weightCandidate.morphIndex,
                        mesh: weightCandidate.meshIndex,
                    });
                });
            },
        },
        computed: {
            weightSearchResults: function () {
                const morphNamesInUse = new Set(this.weightConfigs.map(config => config.morphName));
                return this.allWeightCandidates
                    .map(candidate => {
                        if (morphNamesInUse.has(candidate.morphName)) {
                            return null;
                        }
                        const hitIndex = candidate.morphName.toLowerCase().indexOf(this.searchQuery.toLowerCase());
                        if (hitIndex < 0) {
                            return null;
                        }

                        const hitEndIndex = hitIndex + this.searchQuery.length;
                        return {
                            weightCandidate: candidate,
                            namePreHighlight: candidate.morphName.substr(0, hitIndex),
                            nameHighlight: candidate.morphName.substr(hitIndex, this.searchQuery.length),
                            namePostHighlight: candidate.morphName.substr(hitEndIndex, candidate.morphName.length - hitEndIndex),
                        };
                    })
                    .filter(result => result !== null);
            },
        }
    },
);