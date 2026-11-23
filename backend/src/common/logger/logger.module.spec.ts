import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { LoggerModule } from './logger.module';

describe('LoggerModule', () => {
  it('redacts an authorization field in log lines', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule],
    }).compile();

    const logger = moduleRef.get(WINSTON_MODULE_NEST_PROVIDER);
    const writeSpy = jest
      .spyOn((logger as any).logger, 'write')
      .mockImplementation(() => true);

    logger.log({ authorization: 'Bearer super-secret-token' });

    expect(writeSpy).toHaveBeenCalled();
    const written = writeSpy.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(written).toContain('[REDACTED]');
    expect(written).not.toContain('super-secret-token');

    writeSpy.mockRestore();
    await moduleRef.close();
  });
});
