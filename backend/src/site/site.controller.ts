import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Roles, StaffGuard } from '../common/auth';
import { MIN_FILL_MS, SiteService } from './site.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class ContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;

  /** Piège à robots : champ invisible pour un humain, donc toujours vide. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  /** Durée écoulée entre l'affichage du formulaire et son envoi. */
  @IsInt()
  @Min(0)
  elapsedMs!: number;
}

class PageviewDto {
  @IsString()
  @MaxLength(60)
  path!: string;
}

class RangeQuery {
  @Matches(DAY)
  from!: string;

  @Matches(DAY)
  to!: string;
}

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /** Un robot reçoit la même réponse qu'un humain : il ne sait pas qu'il a été écarté. */
  @Post('contact')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async contact(@Body() dto: ContactDto) {
    if (!dto.website && dto.elapsedMs >= MIN_FILL_MS) await this.site.saveContact(dto);
    return { received: true };
  }

  /** Audience anonyme, envoyée seulement si le visiteur a accepté (js/consent.js). */
  @Post('pageview')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async pageview(@Body() dto: PageviewDto) {
    await this.site.countView(dto.path);
  }
}

@Controller('admin/site')
@UseGuards(StaffGuard)
export class SiteAdminController {
  constructor(private readonly site: SiteService) {}

  @Get('overview')
  @Roles('super_admin', 'support', 'finance', 'auditor')
  overview(@Query() q: RangeQuery) {
    return this.site.overview(q.from, q.to);
  }
}
