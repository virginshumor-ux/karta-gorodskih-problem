/** localStorage with a prefix; never throws (private mode, quota). */
export const ls = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("kgp." + k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem("kgp." + k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};
