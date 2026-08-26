import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RidesService, pingDto, setSharesDto, startRideDto } from './rides.service';

const endRideDto = z.object({
  reason: z.enum(['arrived', 'cancelled', 'sos_resolved']).default('arrived'),
});

@Controller('rides')
export class RidesController {
  constructor(private readonly svc: RidesService) {}

  @Post()
  start(
    @Body(new ZodValidationPipe(startRideDto)) body: { vehicleId: string },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.start(user.id, body.vehicleId, req.correlationId, req.ip);
  }

  @Post(':id/ping')
  ping(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pingDto)) body: z.infer<typeof pingDto>,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.ping(user.id, id, body, req.correlationId);
  }

  @Post(':id/end')
  end(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endRideDto)) body: z.infer<typeof endRideDto>,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.end(user.id, id, body.reason, req.correlationId, req.ip);
  }

  @Put(':id/shares')
  setShares(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setSharesDto)) body: { contactIds: string[] },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.setShares(user.id, id, body.contactIds, req.correlationId, req.ip);
  }

  @Public()
  @Get('watch/:token')
  watch(@Param('token') token: string) {
    return this.svc.watchByToken(token);
  }

  @Get('history')
  history(@CurrentUser() user: { id: string; role: 'rider' | 'driver' }) {
    return this.svc.history(user.id, user.role);
  }
}
