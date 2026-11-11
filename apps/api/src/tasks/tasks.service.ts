import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { addWorkingMinutes,workingDayMinutes,nextWorkingInstant } from '@manage/shared';
import { calendarAt } from '../workshop/work-calendar';
import { stepDependencies, type CreateTaskInput, type RepairPlanStepsInput, type Task, type TaskActionInput, type TaskStatus, type UpdateTaskInput } from '@manage/shared';
import { AuditService, diff } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { assertNotFuture, CasesService, MINUTE_TOLERANCE_MS } from '../cases/cases.service';
import { badRequest, forbidden, notFound, versionConflict } from '../common/errors';
import { requireSupportReason } from '../auth/support-reason';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { departments, externalWork, taskDependencies, tasks, technicianWages, workshopStations, users } from '../db/schema';

type TaskRow = typeof tasks.$inferSelect;

const FINISHED: TaskStatus[] = ['done', 'approved'];
// Stages before repair; starting the first task moves the case to in_repair.
const PRE_REPAIR_STAGES = ['reception', 'assessment', 'awaiting_approval', 'awaiting_parts'];

const toDate = (v: string | null | undefined) => (v == null ? null : new Date(v));

const invalidTransition = (from: string, action: string) =>
  badRequest('INVALID_TRANSITION', `انجام «${action}» در وضعیت فعلی فعالیت (${from}) ممکن نیست`);

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /** importRef: set by the vehicle import so the same sheet row never creates a second task. */
  async create(actor: Actor, caseId: string, input: CreateTaskInput, importRef?: string): Promise<Task> {
    const id = await this.db.transaction(tx => this.createIn(tx, actor, caseId, input, importRef));
    return this.get(actor, caseId, id);
  }

  async createIn(tx: DbOrTx, actor: Actor, caseId: string, input: CreateTaskInput, importRef?: string): Promise<string> {
    const tenantId = actor.user.tenantId;
    const id = newId();
    const kase = await this.cases.loadForWrite(tx, tenantId, caseId);
    if (kase.stage === 'delivered') throw badRequest('CASE_DELIVERED', 'پرونده تحویل شده است');
    await this.assertDepartment(tx, tenantId, input.departmentId);
    const planning = await this.plan(tx, actor, input,undefined,caseId);
    assertPlannedRange(input.plannedStartAt, planning.plannedEndAt?.toISOString() ?? input.plannedEndAt);
    const dependsOn = [...new Set(input.dependsOn ?? [])];
    await this.assertSameCase(tx, tenantId, caseId, dependsOn);

    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.caseId, caseId),eq(tasks.tenantId,tenantId)))) as [{ n: number }];
    const [row] = await tx
      .insert(tasks)
      .values({
        id,
        tenantId,
        caseId,
        departmentId: input.departmentId,
        title: input.title ?? null,
        technicianName: input.technicianName ?? null,
        technicianCode: input.technicianCode ?? null,
        plannedStartAt: toDate(input.plannedStartAt),
        plannedEndAt: toDate(input.plannedEndAt),
        ...planning,
        baselineStartAt: planning.plannedStartAt??toDate(input.plannedStartAt),
        baselineEndAt: planning.plannedEndAt ?? toDate(input.plannedEndAt),
        weight: input.weight,
        sortOrder: n + 1,
        notes: input.notes ?? null,
        importRef: importRef ?? null,
        isTest: actor.user.isTestTenant,
        createdBy: actor.user.id,
      })
      .returning();
    if (dependsOn.length) {
      await tx.insert(taskDependencies).values(dependsOn.map((d) => ({ taskId: id, dependsOnTaskId: d })));
    }
    await this.audit.record(tx, actor, {
      entityType: 'task',
      entityId: id,
      caseId,
      action: 'task.created',
      after: {
        departmentId: input.departmentId,
        title: input.title ?? null,
        technicianName: input.technicianName ?? null,
        dependsOn,
      },
      snapshot: { version: 1, row: { ...row!, dependsOn } },
    });
    return id;
  }

  /**
   * Repair plan (spec §8): the expert lists the steps in order; each step waits for the previous one unless
   * it is marked «هم‌زمان با قبلی». The first steps wait for the case's open tail tasks (or afterTaskIds).
   * Wages are written in the same transaction, so a plan is saved whole or not at all.
   */
  async addPlanSteps(actor: Actor, caseId: string, input: RepairPlanStepsInput): Promise<Task[]> {
    const tenantId = actor.user.tenantId;
    if (input.steps.some((s) => s.wageRial !== undefined) && !actor.user.permissions.has('wage.manage')) throw forbidden();
    const ids: string[] = [];
    await this.db.transaction(async (tx) => {
      await this.cases.loadForWrite(tx, tenantId, caseId);
      const before = input.afterTaskIds ? [...new Set(input.afterTaskIds)] : await this.openTail(tx, tenantId, caseId);
      await this.assertSameCase(tx, tenantId, caseId, before);
      const planned: string[] = [];
      for (const [i, step] of input.steps.entries()) {
        const deps = stepDependencies(input.steps.slice(0, i + 1), [...planned, ''], before)[i]!;
        const id = await this.createIn(tx, actor, caseId, {
          departmentId: step.departmentId,
          stationId: step.stationId ?? null,
          assignedUserId: step.assignedUserId ?? null,
          durationDays: step.days,
          title: step.title,
          dependsOn: deps,
          weight: 1,
        });
        planned.push(id);
        if (step.wageRial !== undefined) {
          const now = new Date();
          const [row] = await tx
            .insert(technicianWages)
            .values({ taskId: id, tenantId, caseId, amountRial: step.wageRial, reason: null, setBy: actor.user.id, setAt: now, isTest: actor.user.isTestTenant })
            .returning();
          await this.audit.record(tx, actor, { entityType: 'task_wage', entityId: id, caseId, action: 'wage.set', occurredAt: now, after: { amountRial: step.wageRial }, snapshot: { version: 1, row: row! } });
        }
      }
      ids.push(...planned);
    });
    return Promise.all(ids.map((id) => this.get(actor, caseId, id)));
  }

  /** Unfinished tasks of a case that nothing else waits for: where a new plan step naturally continues. */
  private async openTail(tx: DbOrTx, tenantId: string, caseId: string): Promise<string[]> {
    const rows = await tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.caseId, caseId), eq(tasks.tenantId, tenantId)));
    const open = rows.filter((r) => !FINISHED.includes(r.status as TaskStatus) ).map((r) => r.id);
    if (!open.length) return [];
    const deps = await tx.select().from(taskDependencies).where(inArray(taskDependencies.dependsOnTaskId, open));
    const waitedOn = new Set(deps.filter((d) => open.includes(d.taskId)).map((d) => d.dependsOnTaskId));
    return open.filter((id) => !waitedOn.has(id));
  }

  async update(actor: Actor, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const tenantId = actor.user.tenantId;
    let caseId = '';
    await this.db.transaction(async (tx) => {
      const task = await this.loadForWrite(tx, tenantId, taskId, input.expectedVersion);
      caseId = task.caseId;
      // Any change of a recorded job by a system administrator is a correction with a reason.
      requireSupportReason(actor, input.scheduleReason);
      await this.cases.loadForWrite(tx, tenantId, task.caseId);
      if (input.departmentId) await this.assertDepartment(tx, tenantId, input.departmentId);

      const scheduleChanged=['departmentId','plannedStartAt','plannedEndAt','durationMinutes','durationDays','stationId','assignedUserId','dependsOn'].some(k=>k in input);
      const existingDependencies=input.durationDays&&input.dependsOn===undefined?await tx.select({id:taskDependencies.dependsOnTaskId}).from(taskDependencies).where(eq(taskDependencies.taskId,task.id)):[];
      if(scheduleChanged && !input.scheduleReason) throw badRequest('SCHEDULE_REASON_REQUIRED','برای تغییر برنامه یا ارجاع، دلیل را ثبت کنید');
      const planning = scheduleChanged ? await this.plan(tx,actor,{...input,dependsOn:input.dependsOn??existingDependencies.map(d=>d.id),departmentId:input.departmentId??task.departmentId,stationId:input.stationId===undefined?task.stationId:input.stationId,assignedUserId:input.assignedUserId===undefined?task.assignedUserId:input.assignedUserId,plannedStartAt:input.plannedStartAt===undefined?task.plannedStartAt?.toISOString():input.plannedStartAt,plannedEndAt:input.plannedEndAt===undefined?task.plannedEndAt?.toISOString():input.plannedEndAt},(task.plannedStartAt||task.plannedEndAt||task.actualStartAt)?task.calendarSnapshot:null,task.caseId) : {};
      const patch: Partial<TaskRow> = {...planning};
      for (const key of ['departmentId', 'title', 'technicianName', 'technicianCode', 'weight', 'notes'] as const) {
        if (input[key] !== undefined) (patch as any)[key] = input[key];
      }
      if (planning.technicianName) patch.technicianName=planning.technicianName;
      if (input.plannedStartAt !== undefined && !input.durationDays) patch.plannedStartAt = toDate(input.plannedStartAt);
      if (input.plannedEndAt !== undefined && input.durationMinutes === undefined && input.durationDays === undefined) patch.plannedEndAt = toDate(input.plannedEndAt);
      assertPlannedRange(
        (patch.plannedStartAt ?? task.plannedStartAt)?.toISOString(),
        (patch.plannedEndAt ?? task.plannedEndAt)?.toISOString(),
      );

      if(!task.baselineEndAt&&!task.plannedEndAt&&patch.plannedEndAt){patch.baselineEndAt=patch.plannedEndAt;patch.baselineStartAt=patch.plannedStartAt??task.plannedStartAt;}
      let depsChange: { before: string[]; after: string[] } | null = null;
      if (input.dependsOn !== undefined) {
        const next = [...new Set(input.dependsOn)];
        if (next.includes(taskId)) throw badRequest('DEPENDENCY_CYCLE', 'فعالیت نمی‌تواند به خودش وابسته باشد');
        await this.assertSameCase(tx, tenantId, task.caseId, next);
        await this.assertNoCycle(tx, tenantId, task.caseId, taskId, next);
        const before = (
          await tx.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId))
        ).map((d) => d.dependsOnTaskId);
        await tx.delete(taskDependencies).where(eq(taskDependencies.taskId, taskId));
        if (next.length) {
          await tx.insert(taskDependencies).values(next.map((d) => ({ taskId, dependsOnTaskId: d })));
        }
        depsChange = { before, after: next };
      }

      const updated = await this.save(tx, task, patch);
      const fields = Object.keys(patch);
      const changes = diff(pickRow(task, fields), pickRow(updated, fields));
      await this.audit.record(tx, actor, {
        entityType: 'task',
        entityId: taskId,
        caseId: task.caseId,
        action: 'task.updated',
        reason: input.scheduleReason ?? null,
        before: { ...changes?.before, ...(depsChange ? { dependsOn: depsChange.before } : {}) },
        after: { ...changes?.after, ...(depsChange ? { dependsOn: depsChange.after } : {}) },
        snapshot: { version: updated.version, row: updated },
      });
    });
    return this.get(actor, caseId, taskId);
  }

  /**
   * Phase-1 status recording by the supervisor: start → complete → approve,
   * with reopen for corrective work. Blocking goes through BlockersService.
   */
  async executeOwn(actor: Actor, taskId: string, input: TaskActionInput) {
    if(!['start','complete'].includes(input.action) || input.at || input.note) throw forbidden('فقط شروع و پایان کار محول‌شده مجاز است');
    await this.act(actor,taskId,input,true);
    return {status:'ok'};
  }

  async act(actor: Actor, taskId: string, input: TaskActionInput, own = false): Promise<Task> {
    const updated = await this.db.transaction(tx => this.actIn(tx, actor, taskId, input, own));
    return this.get(actor, updated.caseId, taskId);
  }

  async actIn(tx: DbOrTx, actor: Actor, taskId: string, input: TaskActionInput, own = false, external = false): Promise<TaskRow> {
    const tenantId = actor.user.tenantId;
    if (input.action === 'approve' && !actor.user.permissions.has('task.approve')) throw forbidden();
    const at = input.at ? new Date(input.at) : new Date();
    assertNotFuture(at, 'زمان ثبت‌شده نمی‌تواند در آینده باشد');
    const task = await this.loadForWrite(tx, tenantId, taskId, input.expectedVersion);
    if(own && task.assignedUserId !== actor.user.id) throw forbidden('این کار به شما محول نشده است');
    if (!external && (input.action === 'start' || input.action === 'complete')) {
      const [job] = await tx.select({ id: externalWork.taskId }).from(externalWork)
        .where(and(eq(externalWork.taskId, taskId), eq(externalWork.tenantId, tenantId)));
      if (job) throw badRequest('EXTERNAL_WORK_ACTION', 'این مرحله در بخش کار بیرون از نمایندگی پیگیری می‌شود');
    }
    const kase = await this.cases.loadForWrite(tx, tenantId, task.caseId);
    if(kase.stage==='delivered')throw badRequest('CASE_DELIVERED','خودرو تحویل شده است');
    const status = task.status as TaskStatus;
    let patch: Partial<TaskRow>;
    let action: string;

    switch (input.action) {
      case 'start': {
        if (status !== 'pending') throw invalidTransition(status, 'شروع');
        const unfinished = await this.unfinishedDependencies(tx, tenantId, taskId);
        if (unfinished.length) {
          throw badRequest('DEPENDENCY_NOT_DONE', 'فعالیت‌های پیش‌نیاز هنوز تمام نشده‌اند', {
            taskIds: unfinished,
          });
        }
        patch = { status: 'in_progress', actualStartAt: at };
        action = 'task.started';
        break;
      }
      case 'complete':
        if (status !== 'in_progress') throw invalidTransition(status, 'اتمام');
        if (task.actualStartAt && at.getTime() < task.actualStartAt.getTime() - MINUTE_TOLERANCE_MS) {
          throw badRequest('INVALID_TIME', 'زمان اتمام نمی‌تواند قبل از زمان شروع باشد');
        }
        patch = {
          status: 'done',
          actualEndAt: task.actualStartAt && at < task.actualStartAt ? task.actualStartAt : at,
          completedBy: actor.user.id,
        };
        action = 'task.completed';
        break;
      case 'approve':
        if (status !== 'done') throw invalidTransition(status, 'تأیید');
        if(task.actualEndAt&&at.getTime()<task.actualEndAt.getTime()-MINUTE_TOLERANCE_MS)throw badRequest('INVALID_TIME','تأیید تحویل نمی‌تواند پیش از پایان کار باشد');
        patch = { status: 'approved', approvedAt:task.actualEndAt&&at<task.actualEndAt?task.actualEndAt:at, approvedBy: actor.user.id };
        action = 'task.approved';
        break;
      case 'reopen':
        if (!FINISHED.includes(status)) throw invalidTransition(status, 'بازگشایی');
        patch = { status: 'in_progress', actualEndAt: null, completedBy: null, approvedAt: null, approvedBy: null };
        action = 'task.reopened';
        break;
    }

    const updated = await this.save(tx, task, patch);
    await this.audit.record(tx, actor, {
      entityType: 'task',
      entityId: taskId,
      caseId: task.caseId,
      action,
      reason: input.note ?? null,
      occurredAt: at,
      before: { status },
      after: { status: updated.status },
      snapshot: { version: updated.version, row: updated },
    });

    if (input.action === 'start' && PRE_REPAIR_STAGES.includes(kase.stage)) {
      await this.cases.applyStage(tx, actor, kase, { stage: 'in_repair' }, 'خودکار: شروع اولین فعالیت تعمیر');
    }
    return updated;
  }

  async get(actor: Actor, caseId: string, taskId: string): Promise<Task> {
    const task = (await this.cases.tasksOf(actor.user.tenantId, caseId)).find((t) => t.id === taskId);
    if (!task) throw notFound('فعالیت');
    return task;
  }

  async loadForWrite(tx: DbOrTx, tenantId: string, id: string, expectedVersion?: number): Promise<TaskRow> {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));
    if (!row) throw notFound('فعالیت');
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw versionConflict(row.version);
    return row;
  }

  async save(tx: DbOrTx, task: TaskRow, patch: Partial<TaskRow>): Promise<TaskRow> {
    const [row] = await tx
      .update(tasks)
      .set({ ...patch, updatedAt: new Date(), version: task.version + 1 })
      .where(and(eq(tasks.id, task.id), eq(tasks.tenantId, task.tenantId), eq(tasks.version, task.version)))
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  private async plan(tx:DbOrTx,actor:Actor,input:Partial<CreateTaskInput>,frozen?:TaskRow['calendarSnapshot'],caseId?:string):Promise<Partial<TaskRow>> {
    let stationSnapshot:TaskRow['stationSnapshot']=null;
    if(input.stationId) {
      const [s]=await tx.select().from(workshopStations).where(and(eq(workshopStations.id,input.stationId),eq(workshopStations.tenantId,actor.user.tenantId),eq(workshopStations.isActive,true)));
      if(!s || s.departmentId!==input.departmentId)throw badRequest('INVALID_STATION','جایگاه باید فعال و متعلق به همین رشته باشد');
      stationSnapshot={code:s.code,name:s.name,trade:s.trade};
    }
    let assigneeName:string|null=null;
    if(input.assignedUserId) {
      const [u]=await tx.select().from(users).where(and(eq(users.id,input.assignedUserId),eq(users.tenantId,actor.user.tenantId),eq(users.isActive,true)));
      if(!u)throw badRequest('INVALID_ASSIGNEE','تعمیرکار معتبر یا فعال نیست');
      assigneeName=u.displayName;
    }
    if(input.durationDays&&input.durationMinutes)throw badRequest('DURATION_CONFLICT','مدت را فقط به روز یا دقیقه وارد کنید');
    let start=input.plannedStartAt??null;
    let caseCalendar:TaskRow['calendarSnapshot']=null;
    if(input.durationDays&&caseId){
      const kase=await this.cases.loadForWrite(tx,actor.user.tenantId,caseId);
      caseCalendar=kase.repairPlan?.calendar??null;
      const dependencies=[...new Set(input.dependsOn??[])];
      if(dependencies.length){
        const rows=await tx.select().from(tasks).where(and(eq(tasks.tenantId,actor.user.tenantId),eq(tasks.caseId,caseId),inArray(tasks.id,dependencies)));
        if(rows.length!==dependencies.length||rows.some(t=>!t.plannedEndAt))throw badRequest('DEPENDENCY_SCHEDULE_REQUIRED','ابتدا پایان برنامه پیش‌نیازهای همین پرونده را مشخص کنید');
        const previousEnd=Math.max(...rows.map(t=>t.plannedEndAt!.getTime()));
        if(start&&Date.parse(start)<previousEnd)throw badRequest('DEPENDENCY_TIME_CONFLICT','شروع این جایگاه نمی‌تواند قبل از پایان برنامه پیش‌نیاز باشد');
        start??=new Date(previousEnd).toISOString();
      }else start??=kase.repairPlan?.startAt??kase.admittedAt.toISOString();
    }
    const calendarSnapshot=frozen ?? caseCalendar ?? await calendarAt(tx,actor.user.tenantId,start??new Date().toISOString());
    if(input.durationDays&&!input.plannedStartAt&&start)start=nextWorkingInstant(start,calendarSnapshot.calendar);
    let plannedEndAt=toDate(input.plannedEndAt);
    const minutes=input.durationDays?Math.round(input.durationDays*workingDayMinutes(calendarSnapshot.calendar)):input.durationMinutes;
    if(minutes){if(!start)throw badRequest('PLANNED_START_REQUIRED','شروع برنامه برای محاسبه مدت کاری لازم است');plannedEndAt=new Date(addWorkingMinutes(start,minutes,calendarSnapshot.calendar));}
    return {stationId:input.stationId??null,stationSnapshot,assignedUserId:input.assignedUserId??null,...(assigneeName?{technicianName:assigneeName}:{}),calendarSnapshot,plannedEndAt,...(input.durationDays?{plannedStartAt:toDate(start)}:{})};
  }

  private async unfinishedDependencies(tx: DbOrTx, tenantId:string, taskId: string): Promise<string[]> {
    const rows = await tx
      .select({ id: tasks.id, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.taskId, taskId),eq(tasks.tenantId,tenantId)));
    return rows.filter((r) => r.status !== 'approved').map((r) => r.id);
  }

  private async assertDepartment(tx: DbOrTx, tenantId: string, departmentId: string) {
    const [d] = await tx
      .select({ isActive: departments.isActive })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
    if (!d || !d.isActive) throw badRequest('INVALID_DEPARTMENT', 'واحد انتخاب‌شده معتبر نیست');
  }

  private async assertSameCase(tx: DbOrTx, tenantId: string, caseId: string, ids: string[]) {
    if (!ids.length) return;
    const rows = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.caseId, caseId), eq(tasks.tenantId, tenantId)));
    if (rows.length !== ids.length) {
      throw badRequest('INVALID_DEPENDENCY', 'پیش‌نیازها باید از فعالیت‌های همین پرونده باشند');
    }
  }

  private async assertNoCycle(tx: DbOrTx, tenantId:string, caseId: string, taskId: string, next: string[]) {
    const edges = await tx
      .select({ from: taskDependencies.taskId, to: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(and(eq(tasks.caseId, caseId),eq(tasks.tenantId,tenantId)));
    const graph = new Map<string, string[]>();
    for (const e of edges) if (e.from !== taskId) graph.set(e.from, [...(graph.get(e.from) ?? []), e.to]);
    graph.set(taskId, next);
    // DFS from the edited task: reaching it again means a cycle.
    const stack = [...next];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === taskId) throw badRequest('DEPENDENCY_CYCLE', 'این وابستگی چرخه ایجاد می‌کند');
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(graph.get(cur) ?? []));
    }
  }
}

function assertPlannedRange(start?: string | null, end?: string | null) {
  if (start && end && new Date(end) < new Date(start)) {
    throw badRequest('INVALID_TIME', 'پایان برنامه‌ای نمی‌تواند قبل از شروع برنامه‌ای باشد');
  }
}

function pickRow(obj: Record<string, any>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
