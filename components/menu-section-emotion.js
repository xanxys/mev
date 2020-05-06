"use strict";
import { blendshapeToEmotionId } from '../mev-util.js';

Vue.component(
    "menu-section-emotion", {
        template: "#menu_section_emotion",
        props: ["vrmRenderer", "emotionId", "allWeightCandidates", "weightConfigs", "blendshapeMaster"],
        data: function () {
            return {
                searching: false,
                searchQuery: "",
            };
        },
        methods: {
            onChangeWeight: function (event, weightConfig) {
                const newWeight = event.srcElement.valueAsNumber * 0.01;
                this.blendshapeMaster.blendShapeGroups.forEach(bs => {
                    if (blendshapeToEmotionId(bs) !== this.emotionId) {
                        return;
                    }
                    bs.binds.forEach(bind => {
                        if (bind.mesh === weightConfig.meshIndex && bind.index === weightConfig.morphIndex) {
                            bind.weight = newWeight * 100;
                        }
                    });
                });
                this.vrmRenderer.invalidateWeight();
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
                this.vrmRenderer.invalidateWeight();
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