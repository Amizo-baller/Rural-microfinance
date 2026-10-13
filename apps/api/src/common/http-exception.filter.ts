import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const databaseUnavailable =
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(String(exception.code));
    const isHttp = exception instanceof HttpException;
    const status = databaseUnavailable
      ? HttpStatus.SERVICE_UNAVAILABLE
      : isHttp
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = `${request.method} ${request.url} -> ${status}`;
    // Validation, authentication and authorization responses are expected
    // client-side outcomes. Logging their full Express stack makes routine
    // form feedback look like a server crash and hides genuine 5xx failures.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR)
      this.logger.error(message, exception instanceof Error ? exception.stack : undefined);
    else this.logger.warn(message);
    response
      .status(status)
      .json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        error: databaseUnavailable
          ? 'The account service is temporarily unavailable. Please try again shortly.'
          : isHttp
            ? exception.getResponse()
            : 'Internal server error',
      });
  }
}
