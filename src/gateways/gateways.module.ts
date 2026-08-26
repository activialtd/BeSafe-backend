import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { RidesModule } from '@/modules/rides/rides.module';
import { RidesGateway } from './rides.gateway';

@Module({
  imports: [AuthModule, RidesModule],
  providers: [RidesGateway],
  exports: [RidesGateway],
})
export class GatewaysModule {}
