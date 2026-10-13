import { ArgumentsHost, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter authentication availability', () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/auth/login' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  it('reports database connection exhaustion as retryable service unavailability', () => {
    new HttpExceptionFilter().catch({ code: 'P2024' }, host);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('temporarily unavailable') }),
    );
  });
  it('continues rejecting actual invalid credentials', () => {
    new HttpExceptionFilter().catch(new UnauthorizedException('Invalid credentials'), host);
    expect(status).toHaveBeenCalledWith(401);
  });
});
