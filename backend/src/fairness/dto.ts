import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** Clé d'idempotence d'une mise ou d'un tour, générée par le client. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export class RotateSeedDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  clientSeed?: string;
}

export class VerifyDto {
  @IsString()
  @MaxLength(128)
  serverSeed!: string;

  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  clientSeed!: string;

  @IsInt()
  @Min(0)
  nonce!: number;
}
