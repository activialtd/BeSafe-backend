import { Global, Module } from "@nestjs/common";
import { IdentityService, DojahAdapter } from "./identity.service";

@Global()
@Module({
  providers: [IdentityService, DojahAdapter],
  exports: [IdentityService],
})
export class IdentityModule {}
