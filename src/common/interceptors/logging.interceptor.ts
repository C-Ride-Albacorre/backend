import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const requestId = req.requestId;

    return next.handle().pipe(
      tap(() => {
        console.log(
          JSON.stringify({
            requestId,
            method: req.method,
            url: req.originalUrl,
          }),
        );
      }),
    );
  }
}
