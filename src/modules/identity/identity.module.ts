import { Global, Module } from '@nestjs/common';
import { IdentityService, MonoAdapter, VerifyMeAdapter } from './identity.service';

@Global()
@Module({
  providers: [MonoAdapter, VerifyMeAdapter, IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
