import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { maskForGuest } from '@manage/shared';
import { map, type Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.types';
import { forbidden } from './errors';

/**
 * Guests are read only and never see the customer's mobile, the owner's full name, the full
 * chassis/VIN or amounts (reconstruction scenario, owner 2026-11-25). Every JSON answer of a
 * guest-only session is masked here, after the handler, so no screen can leak them by forgetting a
 * check; files (Excel, PDF, admission-card originals) are refused because they cannot be masked.
 * Registered after the idempotency interceptor, so a replayed answer is the masked one.
 */
@Injectable()
export class GuestMaskInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    const guestOnly = !!user && !user.isOwner && user.roles.length > 0 && user.roles.every((r) => r === 'guest');
    if (!guestOnly) return next.handle();
    return next.handle().pipe(map((body: unknown) => {
      if (body instanceof StreamableFile || Buffer.isBuffer(body) || body instanceof Uint8Array) throw forbidden('دسترسی مهمان فایل خروجی ندارد');
      return maskForGuest(body);
    }));
  }
}
