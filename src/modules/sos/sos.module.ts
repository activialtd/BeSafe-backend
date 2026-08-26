import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  imports: [AuthModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
