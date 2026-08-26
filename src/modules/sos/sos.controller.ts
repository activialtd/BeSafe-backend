import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { CurrentUser } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { SosService, cancelSosDto, triggerSosDto } from './sos.service';

const resolveDto = z.object({ note: z.string().max(500).optional() });

@Controller('sos')
export class SosController {
  constructor(private readonly svc: SosService) {}

  @Post()
  trigger(
    @Body(new ZodValidationPipe(triggerSosDto)) body: z.infer<typeof triggerSosDto>,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.trigger(user.id, body, req.correlationId, req.ip);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSosDto)) body: { pin: string },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.cancel(user.id, id, body.pin, req.correlationId, req.ip);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveDto)) body: { note?: string },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.resolve(user.id, id, body.note, req.correlationId, req.ip);
  }

  @Get('mine')
  mine(@CurrentUser() user: { id: string }) {
    return this.svc.listMine(user.id);
  }
}
