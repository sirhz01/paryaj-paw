import { Module } from '@nestjs/common';
import { SiteAdminController, SiteController } from './site.controller';
import { SiteService } from './site.service';

@Module({ controllers: [SiteController, SiteAdminController], providers: [SiteService] })
export class SiteModule {}
