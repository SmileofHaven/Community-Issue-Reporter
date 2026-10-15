'use strict';
/* Minimal in-memory stand-in for the slice of Firestore + Auth that the API uses. Test-only. */

const DELETE = { __delete: true };

class Timestamp {
  constructor(ms) { this.ms = ms; }
  static now() { return new Timestamp(Date.now()); }
  toDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
}

function create(tokens) {
  const store = new Map();

  function apply(path, upd) {
    const cur = Object.assign({}, store.get(path) || {});
    Object.keys(upd).forEach((k) => { if (upd[k] === DELETE) { delete cur[k]; } else { cur[k] = upd[k]; } });
    store.set(path, cur);
  }
  const snapOf = (path) => ({
    id: path.split('/').pop(),
    exists: store.has(path),
    data: () => (store.has(path) ? Object.assign({}, store.get(path)) : undefined)
  });
  const docRef = (path) => ({
    path,
    get: async () => snapOf(path),
    set: async (data, opts) => { if (opts && opts.merge) { apply(path, data); } else { store.set(path, Object.assign({}, data)); } },
    update: async (upd) => { if (!store.has(path)) { throw new Error('NOT_FOUND'); } apply(path, upd); },
    delete: async () => { store.delete(path); }
  });

  function query(col, st) {
    st = st || { filters: [], order: null, start: null, end: null, lim: Infinity };
    const next = (patch) => query(col, Object.assign({}, st, patch));
    return {
      where: (f, op, v) => { if (op !== '==') { throw new Error('fake supports =='); } return next({ filters: st.filters.concat([[f, v]]) }); },
      orderBy: (f, dir) => next({ order: [f, dir || 'asc'] }),
      startAt: (v) => next({ start: v }),
      endAt: (v) => next({ end: v }),
      limit: (n) => next({ lim: n }),
      get: async () => {
        let rows = [];
        store.forEach((data, path) => {
          const parts = path.split('/');
          if (parts.length === 2 && parts[0] === col) { rows.push({ path, data }); }
        });
        rows = rows.filter((r) => st.filters.every(([f, v]) => r.data[f] === v));
        if (st.order) {
          const [f, dir] = st.order;
          rows = rows.filter((r) => r.data[f] !== undefined);
          if (st.start !== null) { rows = rows.filter((r) => r.data[f] >= st.start); }
          if (st.end !== null) { rows = rows.filter((r) => r.data[f] <= st.end); }
          rows.sort((a, b) => {
            const x = a.data[f], y = b.data[f];
            const c = x instanceof Timestamp ? x.ms - y.ms : (x < y ? -1 : x > y ? 1 : 0);
            return dir === 'desc' ? -c : c;
          });
        }
        return { docs: rows.slice(0, st.lim).map((r) => snapOf(r.path)) };
      }
    };
  }

  const db = {
    doc: docRef,
    collection: (name) => query(name),
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      set: (ref, data, opts) => ref.set(data, opts),
      update: (ref, upd) => ref.update(upd)
    })
  };
  const admin = { firestore: { Timestamp, FieldValue: { delete: () => DELETE } } };
  const auth = {
    verifyIdToken: async (t) => { if (!tokens[t]) { throw new Error('bad token'); } return tokens[t]; }
  };
  return { store, exports: { getAdmin: () => admin, getDb: () => db, getAuth: () => auth }, Timestamp };
}

module.exports = { create };
