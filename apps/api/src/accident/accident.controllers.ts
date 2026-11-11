import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import {
  blockerFollowUpSchema,
  caseListQuerySchema,
  changeStageSchema,
  createBlockerSchema,
  createCaseSchema,
  createTaskSchema,
  repairPlanStepsSchema,
  resolveBlockerSchema,
  taskActionSchema,
  updateCaseSchema,
  updateTaskSchema,
  type BlockerFollowUpInput,
  type CaseListQuery,
  type ChangeStageInput,
  type CreateBlockerInput,
  type CreateCaseInput,
  type CreateTaskInput,
  type RepairPlanStepsInput,
  type ResolveBlockerInput,
  type TaskActionInput,
  type UpdateCaseInput,
  type UpdateTaskInput,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { BlockersService } from '../blockers/blockers.service';
import { CasesService } from '../cases/cases.service';
import { IdParam } from '../common/params';
import { ZodPipe } from '../common/zod.pipe';
import { DashboardService } from '../dashboard/dashboard.service';
import { TasksService } from '../tasks/tasks.service';

@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly tasks: TasksService,
    private readonly blockers: BlockersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('case.read')
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(caseListQuerySchema)) q: CaseListQuery) {
    return this.cases.list(actor, q);
  }

  @Post()
  @RequirePermissions('case.create')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(createCaseSchema)) body: CreateCaseInput) {
    return this.cases.create(actor, body);
  }

  @Get(':id')
  @RequirePermissions('case.read')
  detail(@CurrentActor() actor: Actor, @IdParam() id: string) {
    return this.cases.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('case.update')
  update(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(updateCaseSchema)) body: UpdateCaseInput,
  ) {
    return this.cases.update(actor, id, body);
  }

  @Post(':id/stage')
  @RequirePermissions('case.update')
  changeStage(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(changeStageSchema)) body: ChangeStageInput,
  ) {
    return this.cases.changeStage(actor, id, body);
  }

  @Get(':id/timeline')
  @RequirePermissions('case.read', 'audit.read')
  async timeline(@CurrentActor() actor: Actor, @IdParam() id: string) {
    await this.cases.detail(actor, id); // tenant check + 404
    return this.audit.caseTimeline(actor, id);
  }

  @Post(':id/tasks')
  @RequirePermissions('task.manage')
  createTask(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.tasks.create(actor, id, body);
  }

  /** Repair plan: several ordered steps (bay, person, days, wage) saved together. Wages need wage.manage. */
  @Post(':id/repair-plan/steps')
  @RequirePermissions('task.manage')
  addPlanSteps(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(repairPlanStepsSchema)) body: RepairPlanStepsInput,
  ) {
    return this.tasks.addPlanSteps(actor, id, body);
  }

  @Post(':id/blockers')
  @RequirePermissions('blocker.report')
  createBlocker(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(createBlockerSchema)) body: CreateBlockerInput,
  ) {
    return this.blockers.create(actor, id, body);
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Patch(':id')
  @RequirePermissions('task.manage')
  update(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(actor, id, body);
  }

  @Post(':id/actions')
  @RequirePermissions('task.manage')
  act(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(taskActionSchema)) body: TaskActionInput,
  ) {
    return this.tasks.act(actor, id, body);
  }
}

@Controller('blockers')
export class BlockersController {
  constructor(private readonly blockers: BlockersService) {}

  @Post(':id/follow-up')
  @RequirePermissions('blocker.manage')
  followUp(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(blockerFollowUpSchema)) body: BlockerFollowUpInput,
  ) {
    return this.blockers.followUp(actor, id, body);
  }

  @Post(':id/resolve')
  @RequirePermissions('blocker.manage')
  resolve(
    @CurrentActor() actor: Actor,
    @IdParam() id: string,
    @Body(new ZodPipe(resolveBlockerSchema)) body: ResolveBlockerInput,
  ) {
    return this.blockers.resolve(actor, id, body);
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard.read')
  summary(@CurrentActor() actor: Actor) {
    return this.dashboard.summary(actor);
  }
}
