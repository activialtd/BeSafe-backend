import { Body, Controller, Get, Ip, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, Public } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import {
  RefreshDto,
  RequestOtpDto,
  SetRoleDto,
  SetSosPinDto,
  VerifyNinDto,
  VerifyOtpDto,
  refreshDto,
  requestOtpDto,
  setRoleDto,
  setSosPinDto,
  verifyNinDto,
  verifyOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Public()
  @Post('otp/request')
  requestOtp(
    @Body(new ZodValidationPipe(requestOtpDto)) body: RequestOtpDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.requestOtp(body.phone, body.purpose, req.correlationId, ip);
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpDto)) body: VerifyOtpDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.verifyOtp(
      body.phone,
      body.code,
      req.correlationId,
      ip,
      req.headers['user-agent'],
    );
  }

  @Post('role')
  setRole(
    @Body(new ZodValidationPipe(setRoleDto)) body: SetRoleDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.setRole(user.id, body.role, body.fullName, req.correlationId, ip);
  }

  @Post('nin/verify')
  verifyNin(
    @Body(new ZodValidationPipe(verifyNinDto)) body: VerifyNinDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.verifyNin(user.id, body.nin, body.dateOfBirth, req.correlationId, ip);
  }

  @Post('sos-pin')
  setSosPin(
    @Body(new ZodValidationPipe(setSosPinDto)) body: SetSosPinDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.setSosPin(user.id, body.pin, req.correlationId, ip);
  }

  @Public()
  @Post('refresh')
  refresh(
    @Body(new ZodValidationPipe(refreshDto)) body: RefreshDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.svc.refresh(body.refreshToken, ip, req.headers['user-agent']);
  }

  @Post('logout')
  logout(@CurrentUser() user: { id: string }, @Body() body: { refreshToken?: string }) {
    return this.svc.logout(user.id, body?.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.svc.me(user.id);
  }
}
