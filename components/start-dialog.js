
/**
 * 
 * @param {Function<File>} onFileSelected 
 */
export function setupStartDialog(onFileSelected) {
    const start_dialog = new Vue({
        el: "#vue_start_dialog",
        data: {
            isDragover: false,
        },
        methods: {
            fileDragover: function (event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                this.isDragover = true;
            },
            fileDragleave: function (event) {
                event.preventDefault();
                this.isDragover = false;
            },
            fileDrop: function (event) {
                event.preventDefault();
                this.isDragover = false;
                this._setFileAndExit(event.dataTransfer.files[0]);
            },
            fileSelect: function (event) {
                this._setFileAndExit(event.srcElement.files[0]);
            },
            _setFileAndExit: function (file) {
                this.$destroy();
                document.getElementById("vue_start_dialog").remove();
                onFileSelected(file);
            },
        }
    });
}