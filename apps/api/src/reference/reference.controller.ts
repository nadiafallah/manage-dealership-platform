import { Controller, Get, Inject } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Department, UserRef } from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { departments, users } from '../db/schema';

@Controller()
export class ReferenceController {
  constructor(@Inject(DATABASE) private readonly handle: DatabaseHandle) {}

  @Get('departments')
  @RequirePermissions('case.read')
  async departments(@CurrentActor() actor: Actor): Promise<Department[]> {
    return this.handle.db
      .select({ id: departments.id, code: departments.code, name: departments.name, isActive: departments.isActive })
      .from(departments)
      .where(and(eq(departments.tenantId, actor.user.tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.sortOrder));
  }

  /** Staff who can be made responsible for a case. */
  @Get('users/assignable')
  @RequirePermissions('case.read')
  async assignable(@CurrentActor() actor: Actor): Promise<(UserRef & { roles: string[] })[]> {
    return this.handle.db
      .select({ id: users.id, displayName: users.displayName, roles: users.roles })
      .from(users)
      .where(
        and(
          eq(users.tenantId, actor.user.tenantId),
          eq(users.isActive, true),
          sql`${users.roles} && array['accident_expert','system_admin']::text[]`,
        ),
      )
      .orderBy(asc(users.displayName));
  }
}
