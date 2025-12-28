import { BalancerLottery, BalancerRotor } from "../consts.js";

export type BalancerStrategy = typeof BalancerLottery | typeof BalancerRotor | string;

export interface Balancer {
  pop(): number;
  delete(id: number): void;
  reduce(id: number): void;
  success(id: number): void;
}

export class LotteryBalancer implements Balancer {
  private readonly store: Map<number, number>;
  private readonly fails = new Set<number>();
  private readonly reduces = new Set<number>();
  private successId: number | null = null;

  constructor(items: Map<number, number>) {
    this.store = new Map(items);
  }

  pop(): number {
    if (this.store.size === 0) throw new Error("no provide items or all items are disabled");
    let total = 0;
    for (const v of this.store.values()) total += v;
    if (total <= 0) throw new Error("total provide weight must be greater than 0");

    const r0 = Math.floor(Math.random() * total);
    let r = r0;
    for (const [k, v] of this.store.entries()) {
      if (r < v) return k;
      r -= v;
    }
    throw new Error("unexpected error");
  }

  delete(id: number) {
    this.fails.add(id);
    this.store.delete(id);
  }

  reduce(id: number) {
    this.reduces.add(id);
    const v = this.store.get(id);
    if (v === undefined) return;
    this.store.set(id, v - Math.floor(v / 3));
  }

  success(id: number) {
    this.successId = id;
  }
}

export class RotorBalancer implements Balancer {
  private readonly list: number[];
  private readonly index: Map<number, number>;
  private readonly fails = new Set<number>();
  private readonly reduces = new Set<number>();
  private successId: number | null = null;

  constructor(items: Map<number, number>) {
    const entries = [...items.entries()].sort((a, b) => b[1] - a[1]);
    this.list = entries.map((e) => e[0]);
    this.index = new Map(this.list.map((id, i) => [id, i]));
  }

  pop(): number {
    if (this.list.length === 0) throw new Error("no provide items");
    return this.list[0]!;
  }

  delete(id: number) {
    this.fails.add(id);
    const i = this.index.get(id);
    if (i === undefined) return;
    this.list.splice(i, 1);
    this.reindex();
  }

  reduce(id: number) {
    this.reduces.add(id);
    const i = this.index.get(id);
    if (i === undefined) return;
    const [item] = this.list.splice(i, 1);
    if (item === undefined) return;
    this.list.push(item);
    this.reindex();
  }

  success(id: number) {
    this.successId = id;
  }

  private reindex() {
    this.index.clear();
    for (let i = 0; i < this.list.length; i++) this.index.set(this.list[i]!, i);
  }
}

type BreakerState = "closed" | "open" | "half_open";
type BreakerNode = {
  state: BreakerState;
  failCount: number;
  successCount: number;
  expiryMs: number;
};

const breakerNodes = new Map<number, BreakerNode>();
const MaxFailures = 5;
const SleepWindowMs = 60_000;
const MaxRequests = 2;

export class BreakerBalancer implements Balancer {
  constructor(private readonly inner: Balancer) {
    const now = Date.now();
    for (const [key, node] of breakerNodes.entries()) {
      if (node.state === "open" && node.expiryMs <= now) {
        breakerNodes.set(key, { state: "half_open", failCount: 0, successCount: 0, expiryMs: 0 });
      }
      if ((breakerNodes.get(key)?.state ?? "closed") === "open") {
        this.inner.delete(key);
      }
    }
  }

  pop(): number {
    const key = this.inner.pop();
    if (!breakerNodes.has(key)) breakerNodes.set(key, { state: "closed", failCount: 0, successCount: 0, expiryMs: 0 });
    return key;
  }

  delete(id: number) {
    this.failCountAdd(id);
    this.inner.delete(id);
  }

  reduce(id: number) {
    this.failCountAdd(id);
    this.inner.reduce(id);
  }

  success(id: number) {
    const node = breakerNodes.get(id);
    if (node && node.state === "half_open") {
      node.successCount += 1;
      if (node.successCount >= MaxRequests) breakerNodes.set(id, { state: "closed", failCount: 0, successCount: 0, expiryMs: 0 });
      else breakerNodes.set(id, node);
    }
    this.inner.success(id);
  }

  private failCountAdd(id: number) {
    const node = breakerNodes.get(id);
    if (!node) return;
    node.failCount += 1;
    if (node.state === "closed" && node.failCount >= MaxFailures) {
      breakerNodes.set(id, { state: "open", failCount: 0, successCount: 0, expiryMs: Date.now() + SleepWindowMs });
      return;
    }
    if (node.state === "half_open") {
      breakerNodes.set(id, { state: "open", failCount: 0, successCount: 0, expiryMs: Date.now() + SleepWindowMs });
      return;
    }
    breakerNodes.set(id, node);
  }
}

export function newBalancer(strategy: BalancerStrategy, items: Map<number, number>, breaker: boolean): Balancer {
  let b: Balancer;
  switch (strategy) {
    case BalancerRotor:
      b = new RotorBalancer(items);
      break;
    case BalancerLottery:
    default:
      b = new LotteryBalancer(items);
      break;
  }
  return breaker ? new BreakerBalancer(b) : b;
}
