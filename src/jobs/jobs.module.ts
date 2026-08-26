import { Module } from '@nestjs/common';
import { MaintenanceJobs } from './maintenance.jobs';

@Module({
  providers: [MaintenanceJobs],
})
export class JobsModule {}
