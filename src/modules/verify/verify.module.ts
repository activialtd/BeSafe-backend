import { Module } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { VerifyService } from './verify.service';

@Module({
  controllers: [VerifyController],
  providers: [VerifyService],
  exports: [VerifyService],
})
export class VerifyModule {}
