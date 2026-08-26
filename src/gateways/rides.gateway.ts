import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { AppEnv } from '@/config/env';
import { RidesService } from '@/modules/rides/rides.service';

interface SocketAuth {
  userId: string;
  role: 'rider' | 'driver' | 'admin' | 'gov';
}

/**
 * Socket.IO gateway for live trip tracking.
 * - Rider on trip: emits `ride:ping` every ~5s with lat/lng
 * - Contacts watching via watchToken: join `watch:<token>` room, receive `ride:location`
 *
 * If the socket disconnects, the client falls back to HTTP POST /rides/:id/ping every 30s.
 */
@WebSocketGateway({
  namespace: '/rides',
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RidesGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly rides: RidesService,
  ) {}

  async handleConnection(client: Socket) {
    const auth = client.handshake.auth || {};
    const token: string | undefined = auth.token;
    const watchToken: string | undefined = auth.watchToken;

    try {
      if (token) {
        const payload = await this.jwt.verifyAsync<{ sub: string; role: SocketAuth['role'] }>(token, {
          secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        });
        (client.data as { auth: SocketAuth }).auth = { userId: payload.sub, role: payload.role };
        this.logger.log(`WS connect user=${payload.sub} sid=${client.id}`);
        return;
      }
      if (watchToken) {
        await this.rides.watchByToken(watchToken); // throws if invalid
        (client.data as { watchToken: string }).watchToken = watchToken;
        void client.join(`watch:${watchToken}`);
        this.logger.log(`WS connect watcher token=${watchToken.slice(0, 8)}… sid=${client.id}`);
        return;
      }
      throw new Error('No credentials');
    } catch (err) {
      this.logger.warn(`WS auth failed sid=${client.id}: ${(err as Error).message}`);
      client.emit('error', { code: 'UNAUTHENTICATED', message: 'Bad or missing credentials' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WS disconnect sid=${client.id}`);
  }

  @SubscribeMessage('ride:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId: string }) {
    const auth = (client.data as { auth?: SocketAuth }).auth;
    if (!auth) throw new WsException({ code: 'UNAUTHENTICATED', message: 'Not authed' });
    if (!data?.rideId) throw new WsException({ code: 'INVALID_INPUT', message: 'rideId required' });
    void client.join(`ride:${data.rideId}`);
    return { ok: true, room: `ride:${data.rideId}` };
  }

  @SubscribeMessage('ride:ping')
  async onPing(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown) {
    const auth = (client.data as { auth?: SocketAuth }).auth;
    if (!auth) throw new WsException({ code: 'UNAUTHENTICATED', message: 'Not authed' });

    const parsed = z
      .object({
        rideId: z.string(),
        lat: z.number().gte(-90).lte(90),
        lng: z.number().gte(-180).lte(180),
        accuracyMeters: z.number().nonnegative().optional(),
        speedMps: z.number().nonnegative().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      throw new WsException({ code: 'VALIDATION_ERROR', message: 'Bad ping payload' });
    }

    try {
      await this.rides.ping(
        auth.userId,
        parsed.data.rideId,
        {
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          accuracyMeters: parsed.data.accuracyMeters,
          speedMps: parsed.data.speedMps,
          source: 'socket',
        },
        'ws',
      );
    } catch (err) {
      throw new WsException({
        code: (err as any)?.code ?? 'INTERNAL_ERROR',
        message: (err as Error).message,
      });
    }

    const payload = {
      rideId: parsed.data.rideId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      at: new Date().toISOString(),
    };
    this.server.to(`ride:${parsed.data.rideId}`).emit('ride:location', payload);
    const watchTokens = await this.rides.listActiveWatchTokens(parsed.data.rideId);
    for (const t of watchTokens) {
      this.server.to(`watch:${t}`).emit('ride:location', payload);
    }
    return { ok: true };
  }
}
