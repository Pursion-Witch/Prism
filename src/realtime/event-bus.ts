import type { PrismSocketServer } from './socket';
import type { AISupervisionEventPayload, PriceUpdate, PriceUpdateBatchPayload } from '../types/realtime';

export class RealtimeEventBus {
  constructor(private readonly io: PrismSocketServer) {}

  emitPriceUpdates(updates: ReadonlyArray<PriceUpdate>, timestamp = new Date()): void {
    if (updates.length === 0) {
      return;
    }

    const payload: PriceUpdateBatchPayload = {
      updates: [...updates],
      timestamp: timestamp.toISOString()
    };
    this.io.emit('price-update', payload);
  }

  emitAISupervision(event: AISupervisionEventPayload): void {
    this.io.emit('ai-supervision', event);
  }
}
