
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // Prevent double response
    if (response.headersSent) {
      return;
    }

    let httpStatus: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorName: string = 'Internal Server Error';

    // 1. Handle Prisma errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        // Unique constraint violation
        case 'P2002': {
          httpStatus = HttpStatus.CONFLICT;

          const target = exception.meta?.target;

          if (Array.isArray(target) && target.includes('sku')) {
            message = 'A product with this SKU already exists.';
          } else {
            message = 'A record with this value already exists.';
          }

          errorName = 'Conflict';
          break;
        }

        // Record not found
        case 'P2025': {
          httpStatus = HttpStatus.NOT_FOUND;
          message = 'The requested record was not found.';
          errorName = 'Not Found';
          break;
        }

        // Foreign key constraint violation
        case 'P2003': {
          httpStatus = HttpStatus.BAD_REQUEST;
          message = 'Invalid reference. A related record does not exist.';
          errorName = 'Bad Request';
          break;
        }

        default: {
          message = 'A database operation failed.';
          errorName = 'Database Error';
          break;
        }
      }
    }

    // 2. Handle standard NestJS exceptions
    else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();

      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const responseObject = res as any;

        message =
          responseObject.message ||
          responseObject.error ||
          exception.message;

        errorName =
          responseObject.error || this.getErrorType(httpStatus);
      } else {
        message = exception.message;
      }
    }

    // 3. Handle unexpected errors
    else if (exception instanceof Error) {
      // Do not expose internal error details to clients
      message = 'Internal server error';
      errorName = 'Internal Server Error';
    }

    // Ensure array messages are readable
    const readableMessage = Array.isArray(message)
      ? message.join(', ')
      : message;

    // Log errors for debugging
    this.logger.error(
      `❌ ${httpStatus} - ${readableMessage} - ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // 4. Standardized API response
    const responseBody = {
      status: 'error',
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      error: errorName,
      message: readableMessage,
    };

    httpAdapter.reply(response, responseBody, httpStatus);
  }

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
      case 409:
        return 'Conflict';
      case 500:
        return 'Internal Server Error';
      default:
        return 'Error';
    }
  }
}
