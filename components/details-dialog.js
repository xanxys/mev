/**

 */

let firstTime = true;

export function setupDetailsDialog(vrmModel) {
    document.getElementById("vue_details_dialog").style.display = "block";
    if (!firstTime) {
        return;
    }

    const start_dialog = new Vue({
        el: "#vue_details_dialog",
        data: {
            detailsText: "",
        },
        methods: {
            clickCloseButton: function() {
                document.getElementById("vue_details_dialog").style.display = "none";
            },
            updateDetails: function(vrmModel) {
                this.detailsText = vrmModel.countTotalTris() + "tris";


            },
        }
    });
    firstTime = false;

    start_dialog.updateDetails(vrmModel);
}