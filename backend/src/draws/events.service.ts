import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, map } from 'rxjs';

export type DrawEventType = 'draw.result' | 'draw.cancelled';

/**
 * Diffusion en direct des tirages (écran TV, lobby, joueurs) par Server-Sent Events.
 * En mémoire : avec plusieurs instances de l'API, il faudra un relais (Redis pub/sub).
 */
@Injectable()
export class DrawEventsService {
  private readonly events = new Subject<{ type: DrawEventType; data: unknown }>();

  publish(type: DrawEventType, data: unknown): void {
    this.events.next({ type, data });
  }

  stream(): Observable<MessageEvent> {
    return this.events.pipe(map(({ type, data }) => ({ type, data: data as object })));
  }
}
