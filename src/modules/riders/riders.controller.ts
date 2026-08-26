import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { AddContactDto, RidersService, addContactDto } from './riders.service';

@Controller('rider')
export class RidersController {
  constructor(private readonly svc: RidersService) {}

  @Get('contacts')
  list(@CurrentUser() user: { id: string }) {
    return this.svc.listContacts(user.id);
  }

  @Post('contacts')
  add(
    @Body(new ZodValidationPipe(addContactDto)) body: AddContactDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.addContact(user.id, body, req.correlationId, req.ip);
  }

  @Delete('contacts/:id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.removeContact(user.id, id, req.correlationId, req.ip);
  }
}
