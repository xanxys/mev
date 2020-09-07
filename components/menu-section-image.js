"use strict";

Vue.component(
    "menu-section-image", {
        template: "#menu_section_image",
        props: ["vrm", "imageId", "imageUsingParts"],
        data: function () {
            return {
            };
        },
        methods: {
            fileSelect: function (event) {
                const imageFile = event.srcElement.files[0];

                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    const image = this.vrm.gltf.images[this.imageId];
                    this.vrm.setBufferViewData(image.bufferView, reader.result);
                    this.$emit("vrm-change", this.vrm);
                });
                reader.readAsArrayBuffer(imageFile);
            },
            clickDownload: function () {
                const name = this.vrm.gltf.images[this.imageId].name;
                const filename = name === "" ? "image.png" : name + ".png";
                saveAs(new Blob([this.vrm.getImageAsBuffer(this.imageId)], { type: "image/png" }), filename);
            },
        },
        computed: {
            textureUrl: function () {
                this.vrm.version; // force depend
                return this.vrm.getImageAsDataUrl(this.imageId);
            },
            width: function () {
                const imgElem = document.createElement("img");
                imgElem.src = this.vrm.getImageAsDataUrl(this.imageId);
                return imgElem.width;
            },
            height: function () {
                const imgElem = document.createElement("img");
                imgElem.src = this.vrm.getImageAsDataUrl(this.imageId);
                return imgElem.height;
            },
        },
    },
);