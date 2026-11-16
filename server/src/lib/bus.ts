import { EventEmitter } from 'node:events';

export type BusMessage =
  | { type: 'instance'; id: string; state: unknown }
  | { type: 'check'; id: string; state: unknown }
  | { type: 'incident'; incident: unknown }
  | { type: 'config'; scope: string }
  | { type: 'reload' };

class Bus extends EventEmitter {
  publish(msg: BusMessage) {
    this.emit('message', msg);
  }
}
export const bus = new Bus();
bus.setMaxListeners(200);
