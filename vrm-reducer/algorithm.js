"use strict";

export class MinHeap {
    constructor() {
        this.tree = new Array();
    }

    /**
     * @param {any} obj
     * @param {number} val
     */
    insert(obj, val) {
        const ix = this.tree.length;
        this.tree.push([obj, val]);
        this._fix_invariance_up(ix);
    }

    /**
     * @param {number} ix
     */
    _fix_invariance_up(ix) {
        while (ix !== 0) {
            const pix = this._parent(ix);
            const pv = this.tree[pix][1];
            const cv = this.tree[ix][1];
            if (pv <= cv) {
                return;
            }
            this._swap(ix, pix);
            ix = pix;
        }
    }

    _fix_invariance_down(ix) {
        while (true) {
            const lix = 2 * ix + 1;
            const rix = 2 * ix + 2;
            if (lix >= this.tree.length) {
                // available children: none
                return;
            }

            const cv = this.tree[ix][1];
            if (rix >= this.tree.length) {
                // available child: left
                const lv = this.tree[lix][1];
                if (cv <= lv) {
                    return;
                }
                this._swap(ix, lix);
                ix = lix;
            } else {
                // available children: left & right
                const lv = this.tree[lix][1];
                const rv = this.tree[rix][1];
                if (cv <= lv && cv <= rv) {
                    return;
                }

                if (lv < rv) {
                    this._swap(ix, lix);
                    ix = lix;
                } else {
                    this._swap(ix, rix);
                    ix = rix;
                }
            }
        }
    }

    _swap(i0, i1) {
        const e0 = this.tree[i0];
        const e1 = this.tree[i1];
        this.tree[i0] = e1;
        this.tree[i1] = e0;
    }

    /**
     * @param {number} ix
     * @returns {number} parent index of ix
     */
    _parent(ix) {
        return ix === 0 ? 0 : Math.floor((ix - 1) / 2);
    }

    size() {
        return this.tree.length;
    }

    /**
     * @returns {[any, number]}
     */
    popmin() {
        if (this.tree.length === 0) {
            throw "popmin() cannot be used for empty MinHeap";
        }
        const melem = this.tree[0];
        if (this.tree.length === 1) {
            this.tree = [];
            return melem;
        }
        this.tree[0] = this.tree[this.tree.length - 1];
        this.tree.splice(-1);
        this._fix_invariance_down(0);
        return melem;
    }
}


/**
 * Returns set difference.
 * @param {Set<any>} sa 
 * @param {Set<any>} sb 
 * @returns {Set<any>} sa - sb
 */
export function setSub(sa, sb) {
    const res = new Set(sa);
    for (let e of sb) {
        res.delete(e);
    }
    return res;
}

/**
 * Returns merged map.
 * @param {Map<any, any>} m1
 * @param {Map<any, any>} m2
 * @returns {Map<any, any>} m1 + m2 (m2 is preferred in case of key collision)
 */
export function mapMerge(m1, m2) {
    const r = new Map();
    for (let [k, v] of m1) {
        r.set(k, v);
    }
    for (let [k, v] of m2) {
        r.set(k, v);
    }
    return r;
}


/**
 * 
 * @param {Iterable} iter 
 * @param {number} k 
 * @returns {Array<any>} k randomly ordered elements uniformly picked from iter
 */
export function selectRandom(iter, k) {
    const elems = new Array(...iter);
    const n = elems.length;
    console.assert(k <= n);
    for (let i = 0; i < n; i++) {
        const j = Math.floor(Math.random() * (n - i - 1));
        [elems[i], elems[j]] = [elems[j], elems[j]];
    }
    return elems.slice(0, k);
}
