import { Client, type Notification } from 'pg';
import type { PrismSocketServer } from './socket';

const ALERTS_CHANNEL = 'alerts_inserted';
const METRICS_CHANNEL = 'metrics_inserted';

export class PgNotifyListener {
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1_000;
  private stopping = false;

  constructor(
    private readonly io: PrismSocketServer,
    private readonly connectionString: string
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      const client = this.client;
      this.client = null;
      client.removeAllListeners();
      try {
        await client.end();
      } catch {
        // connection already closed
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopping) {
      return;
    }

    const client = new Client({ connectionString: this.connectionString });
    this.client = client;

    client.on('notification', (message) => {
      this.handleNotification(message);
    });

    client.on('error', (error) => {
      console.error('[pg-listener] client error:', error.message);
      this.scheduleReconnect();
    });

    client.on('end', () => {
      console.warn('[pg-listener] connection ended');
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${ALERTS_CHANNEL}`);
      await client.query(`LISTEN ${METRICS_CHANNEL}`);
      this.reconnectDelayMs = 1_000;
      console.log('[pg-listener] listening on alerts_inserted and metrics_inserted');
    } catch (error) {
      console.error('[pg-listener] connect failed:', error);
      try {
        await client.end();
      } catch {
        // no-op
      }

      if (this.client === client) {
        this.client = null;
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    if (this.client) {
      const staleClient = this.client;
      this.client = null;
      staleClient.removeAllListeners();
      void staleClient.end().catch(() => undefined);
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);

    console.warn(`[pg-listener] reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private handleNotification(message: Notification): void {
    if (!message.payload) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message.payload);
    } catch {
      console.warn(`[pg-listener] non-JSON payload on ${message.channel}`);
      return;
    }

    if (message.channel === ALERTS_CHANNEL) {
      this.io.emit('alerts:new', payload);
      return;
    }

    if (message.channel === METRICS_CHANNEL) {
      this.io.emit('metrics:new', payload);
    }
  }
}
