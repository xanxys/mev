Vue.component(
    "menu-section-image", {
        template: "#menu_section_image",
        props: ["vrm", "imageId"],
        data: function () {
            return {
            };
        },
        methods: {
            clickUpload: function () {
            },
            clickDownload: function () {
                const name = this.vrm.gltf.images[this.imageId].name;
                const filename = name === "" ? "image.png" : name + ".png";
                saveAs(new Blob([this.vrm.getImageAsBuffer(this.imageId)], { type: "image/png" }), filename);
            },
        },
        computed: {
            textureUrl: function () {
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