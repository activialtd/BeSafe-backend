import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { z } from "zod";
import { CurrentUser, Roles } from "@/common/auth.guard";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { DriversService } from "./drivers.service";
import {
  RegisterVehicleDto,
  VerifyLicenseDto,
  registerVehicleDto,
  verifyLicenseDto,
} from "./dto/register.dto";

const setOnlineDto = z.object({ online: z.boolean() });
const revokeDto = z.object({ reason: z.string().min(1).max(500) });

@Controller("driver")
export class DriversController {
  constructor(private readonly svc: DriversService) {}

  @Get("me")
  @Roles("driver")
  me(@CurrentUser() user: { id: string }) {
    return this.svc.getProfile(user.id);
  }

  @Post("license/verify")
  @Roles("driver")
  verifyLicense(
    @Body(new ZodValidationPipe(verifyLicenseDto)) body: VerifyLicenseDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.verifyLicense(user.id, body, req.correlationId, req.ip);
  }

  @Post("vehicles")
  @Roles("driver")
  register(
    @Body(new ZodValidationPipe(registerVehicleDto)) body: RegisterVehicleDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.registerVehicle(user.id, body, req.correlationId, req.ip);
  }

  @Delete("vehicles/:id")
  @Roles("driver")
  revoke(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(revokeDto)) body: { reason: string },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.revokeVehicle(
      user.id,
      id,
      body.reason,
      req.correlationId,
      req.ip,
    );
  }

  @Put("online")
  @Roles("driver")
  setOnline(
    @Body(new ZodValidationPipe(setOnlineDto)) body: { online: boolean },
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.svc.setOnline(user.id, body.online, req.correlationId, req.ip);
  }
}
