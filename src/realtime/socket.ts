import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { AISupervisionEventPayload, PriceUpdateBatchPayload } from '../types/realtime';

export interface ClientToServerEvents {}

export interface ServerToClientEvents {
  'alerts:new': (payload: unknown) => void;
  'metrics:new': (payload: unknown) => void;
  'price-update': (payload: PriceUpdateBatchPayload) => void;
  'ai-supervision': (payload: AISupervisionEventPayload) => void;
}

export type PrismSocketServer = Server<ClientToServerEvents, ServerToClientEvents>;

let ioInstance: PrismSocketServer | null = null;

export function initializeSocketServer(httpServer: HttpServer): PrismSocketServer {
  if (ioInstance) {
    return ioInstance;
  }

  const corsOrigin = process.env.SOCKET_IO_CORS_ORIGIN?.trim() || '*';

  ioInstance = new Server(httpServer, {
    cors: {
      origin: corsOrigin
    }
  });

  ioInstance.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`[socket] client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] client disconnected: ${socket.id} (${reason})`);
    });
  });

  return ioInstance;
}

export function getSocketServer(): PrismSocketServer {
  if (!ioInstance) {
    throw new Error('Socket server not initialized.');
  }
  return ioInstance;
}
