import { z } from 'zod';

// Repair path (spec section 6): a free sequence of steps — bay (or bay type),
// person, working days and wage. A bay may appear twice; a step may run at the
// same time as the previous one; the order can be changed later.

export const repairStepSchema = z.object({
  departmentId: z.uuid(),
  stationId: z.uuid().nullish(),
  assignedUserId: z.uuid().nullish(),
  days: z.number().min(0.25).max(180).multipleOf(0.25),
  /** Technician wage of this step in Rial, independent of the assessment labour. */
  wageRial: z.number().int().min(0).max(1_000_000_000_000).optional(),
  title: z.string().trim().max(200).optional(),
  /** Runs together with the previous step instead of after it. */
  concurrentWithPrevious: z.boolean().default(false),
});
export type RepairStepInput = z.infer<typeof repairStepSchema>;

export const repairPlanStepsSchema = z
  .object({
    steps: z.array(repairStepSchema).min(1).max(20),
    /** Steps the first new step waits for; default: the open steps nothing else waits for. */
    afterTaskIds: z.array(z.uuid()).max(20).optional(),
  })
  .refine((v) => !v.steps.some((s) => s.wageRial !== undefined && !s.assignedUserId), { message: 'اجرت فقط برای قدمی که نفرش مشخص است ثبت می‌شود', path: ['steps'] });
export type RepairPlanStepsInput = z.infer<typeof repairPlanStepsSchema>;

/**
 * Dependencies of each new step: a sequential step waits for every step of the
 * previous group; a concurrent step waits for what the previous step waits for.
 */
export function stepDependencies<T>(steps: readonly { days?: number; concurrentWithPrevious?: boolean }[], ids: readonly T[], before: readonly T[]): T[][] {
  const out: T[][] = [];
  let waitFor = [...before];
  let group: T[] = [];
  steps.forEach((s, i) => {
    if (i > 0 && !s.concurrentWithPrevious) {
      waitFor = group;
      group = [];
    }
    out.push([...waitFor]);
    group.push(ids[i]!);
  });
  return out;
}

/** Repair duration = sum of the groups, a group lasting as long as its longest step. */
export function repairDurationDays(steps: readonly { days: number; concurrentWithPrevious?: boolean }[]): number {
  let total = 0;
  let group = 0;
  steps.forEach((s, i) => {
    if (i > 0 && !s.concurrentWithPrevious) {
      total += group;
      group = 0;
    }
    group = Math.max(group, s.days);
  });
  return total + group;
}
