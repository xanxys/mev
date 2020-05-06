import { MinHeap } from "./vrm-reducer.js";

describe('MinHeap', function () {
    it("insertion and size", function() {
        const heap = new MinHeap();
        chai.assert.equal(heap.size(), 0);

        heap.insert("A", -5);
        chai.assert.equal(heap.size(), 1);
    });
    it("popmin and size", function() {
        const heap = new MinHeap();
        heap.insert("A", 1);
        heap.insert("B", 2);
        heap.insert("C", 3);
        chai.assert.equal(heap.size(), 3);

        heap.popmin();
        chai.assert.equal(heap.size(), 2);
        heap.popmin();
        chai.assert.equal(heap.size(), 1);
        heap.popmin();
        chai.assert.equal(heap.size(), 0);
    });
    it("popmin ordering", function() {
        const heap = new MinHeap();
        heap.insert("A", 5);
        heap.insert("C", 1);
        heap.insert("B", 2);

        chai.assert.deepEqual(heap.popmin(), ["C", 1]);
        chai.assert.deepEqual(heap.popmin(), ["B", 2]);
        chai.assert.deepEqual(heap.popmin(), ["A", 5]);
    });
});
