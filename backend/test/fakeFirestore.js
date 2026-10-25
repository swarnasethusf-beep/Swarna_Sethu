/**
 * Minimal in-memory Firestore stand-in covering the subset of the Admin SDK
 * this backend uses (collections, docs, where/orderBy/limit, transactions).
 */
const crypto = require("crypto");

const DELETE = Symbol("deleteField");
const clone = (v) => structuredClone(v);
const cmp = (a, b) => (a instanceof Date ? a.getTime() : a) < (b instanceof Date ? b.getTime() : b) ? -1
  : (a instanceof Date ? a.getTime() : a) > (b instanceof Date ? b.getTime() : b) ? 1 : 0;

function createFakeFirestore() {
  const store = new Map(); // path → data

  class DocSnapshot {
    constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
    data() { return this._data === undefined ? undefined : clone(this._data); }
  }

  class QuerySnapshot {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
    forEach(fn) { this.docs.forEach(fn); }
  }

  class DocRef {
    constructor(path) { this.path = path; this.id = path.split("/").pop(); }
    collection(name) { return new CollectionRef(`${this.path}/${name}`); }
    async get() { return new DocSnapshot(this, store.has(this.path) ? clone(store.get(this.path)) : undefined); }
    async set(data, opts) { applySet(this.path, data, opts); }
    async update(data) { applyUpdate(this.path, data); }
    async delete() { store.delete(this.path); }
  }

  class Query {
    constructor(path, filters = [], order = null, max = null) { this.path = path; this.filters = filters; this.order = order; this.max = max; }
    where(field, op, value) { return new Query(this.path, [...this.filters, { field, op, value }], this.order, this.max); }
    orderBy(field, dir = "asc") { return new Query(this.path, this.filters, { field, dir }, this.max); }
    limit(n) { return new Query(this.path, this.filters, this.order, n); }
    async get() {
      const depth = this.path.split("/").length + 1;
      let docs = [...store.entries()]
        .filter(([p]) => p.startsWith(this.path + "/") && p.split("/").length === depth)
        .map(([p, d]) => new DocSnapshot(new DocRef(p), clone(d)));
      for (const { field, op, value } of this.filters) {
        docs = docs.filter((d) => {
          const v = d._data[field];
          if (v === undefined) return false;
          const c = cmp(v, value);
          return op === "==" ? c === 0 : op === ">=" ? c >= 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === "<" ? c < 0 : false;
        });
      }
      if (this.order) {
        const { field, dir } = this.order;
        docs = docs.filter((d) => d._data[field] !== undefined)
          .sort((a, b) => cmp(a._data[field], b._data[field]) * (dir === "desc" ? -1 : 1));
      }
      if (this.max != null) docs = docs.slice(0, this.max);
      return new QuerySnapshot(docs);
    }
  }

  class CollectionRef extends Query {
    doc(id) { return new DocRef(`${this.path}/${id || crypto.randomBytes(10).toString("hex")}`); }
    async add(data) { const ref = this.doc(); applySet(ref.path, data); return ref; }
  }

  function strip(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) if (v !== DELETE) out[k] = v;
    return out;
  }
  function applySet(path, data, opts) {
    const base = opts && opts.merge && store.has(path) ? store.get(path) : {};
    const merged = { ...base, ...data };
    for (const [k, v] of Object.entries(data)) if (v === DELETE) delete merged[k];
    store.set(path, clone(strip(merged)));
  }
  function applyUpdate(path, data) {
    if (!store.has(path)) { const e = new Error(`NOT_FOUND: ${path}`); e.code = 5; throw e; }
    applySet(path, data, { merge: true });
  }

  const db = {
    collection: (name) => new CollectionRef(name),
    async runTransaction(fn) {
      const writes = [];
      const t = {
        get: (refOrQuery) => refOrQuery.get(),
        set: (ref, data, opts) => writes.push(() => applySet(ref.path, data, opts)),
        update: (ref, data) => writes.push(() => applyUpdate(ref.path, data)),
        delete: (ref) => writes.push(() => store.delete(ref.path))
      };
      const result = await fn(t);
      writes.forEach((w) => w());
      return result;
    },
    _store: store
  };
  return { db, deleteField: () => DELETE };
}

module.exports = { createFakeFirestore };
