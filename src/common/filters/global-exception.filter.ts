import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // Determine HTTP status
    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[];
    let errorName: string | undefined;

    // 🧠 Extract message & error info
    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        // Handle both validation and standard Nest errors
        message =
          (res as any).message ||
          (res as any).error ||
          'An unexpected error occurred';
        errorName = (res as any).error;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
    } else {
      message = 'Internal server error';
    }

    // Ensure array messages are readable
    const readableMessage = Array.isArray(message)
      ? message.join(', ')
      : message;

    // Log for debugging
    this.logger.error(
      `❌ ${httpStatus} - ${readableMessage} - ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Build structured error response
    const responseBody = {
      status: 'error',
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      error: errorName || this.getErrorType(httpStatus),
      message:
        httpStatus === 500
          ? 'Internal server error'
          : readableMessage || 'An error occurred',
    };

    httpAdapter.reply(response, responseBody, httpStatus);
  }

  // Optional helper for common status types
  private getErrorType(status: number): string {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 500:
        return 'Internal Server Error';
      default:
        return 'Error';
    }
  }
}
