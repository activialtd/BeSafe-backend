import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { VerifyService, verifyByPlateDto, verifyByQrDto } from './verify.service';
import { z } from 'zod';

@Controller('verify')
export class VerifyController {
  constructor(private readonly svc: VerifyService) {}

  @Public()
  @Post('qr')
  byQr(
    @Body(new ZodValidationPipe(verifyByQrDto)) body: z.infer<typeof verifyByQrDto>,
    @Req() req: Request,
  ) {
    return this.svc.byQr(body.qrToken, req.user?.id ?? null, req.correlationId, req.ip);
  }

  @Public()
  @Post('plate')
  byPlate(
    @Body(new ZodValidationPipe(verifyByPlateDto)) body: z.infer<typeof verifyByPlateDto>,
    @Req() req: Request,
  ) {
    return this.svc.byPlate(body.plate, req.user?.id ?? null, req.correlationId, req.ip);
  }
}
