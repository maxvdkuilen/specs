/**
 * WebSocket hub. Every client on /ws gets a personalised snapshot on connect,
 * then broadcast deltas. The snapshot builder is injected so this module has no
 * dependency on the session service.
 */
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { userIdFromCookieHeader } from './auth.js';
import type { LiveSnapshot, ServerMessage } from '../shared/types.js';

interface Client {
  ws: WebSocket;
  userId: number | null;
  alive: boolean;
}

export class Hub {
  private clients = new Set<Client>();
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly buildSnapshot: (userId: number | null) => Promise<LiveSnapshot>) {}

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          this.clients.delete(c);
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 30_000);
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const client: Client = { ws, userId: userIdFromCookieHeader(req.headers.cookie), alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));
    ws.on('message', (raw) => {
      client.alive = true;
      let msg: { type?: string } = {};
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        this.sendTo(client, { type: 'pong', serverTime: Date.now() });
      } else if (msg.type === 'resync') {
        void this.sendSnapshot(client);
      }
    });
    await this.sendSnapshot(client);
  }

  private async sendSnapshot(client: Client): Promise<void> {
    try {
      const data = await this.buildSnapshot(client.userId);
      this.sendTo(client, { type: 'snapshot', data });
    } catch (err) {
      console.error('[ws] snapshot failed', err);
    }
  }

  private sendTo(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try {
          c.ws.send(payload);
        } catch {
          /* ignore */
        }
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.wss?.close();
  }
}
