import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// One client and connection pool for the entire API process.
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
