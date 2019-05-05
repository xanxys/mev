import { traverseMorphableMesh, blendshapeToEmotionId } from '/mev-util.js';

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
                this.blendshapeMaster.blendShapeGroups.forEach(bs => {
                    if (bs.id !== this.emotionId) {
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
                    .filter(candidate => !morphNamesInUse.has(candidate.morphName) &&
                        candidate.morphName.toLowerCase().indexOf(this.searchQuery.toLowerCase()) >= 0);
            },
        }
    },
);