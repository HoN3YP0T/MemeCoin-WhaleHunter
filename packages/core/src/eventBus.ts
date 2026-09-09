import type { DomainEventMap, DomainEventName } from "./types/events.js";

type Listener<K extends DomainEventName> = (payload: DomainEventMap[K]) => void;

/** Minimal typed pub/sub bus. Deliberately synchronous so unit/integration
 * tests can assert on side effects without waiting on a microtask queue. */
export class EventBus {
  private listeners: Map<DomainEventName, Set<Listener<any>>> = new Map();

  on<K extends DomainEventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      listener(payload);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}
