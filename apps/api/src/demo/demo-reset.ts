import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import {users} from '../db/schema';

/**
 * Deletes every synthetic tenant (tenants.is_test = true) and all of its rows.
 * Real tenants are never touched. The audit trigger only allows deleting
 * is_test audit rows, and only inside this transaction's purge flag.
 */
export async function purgeTestTenants(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('manage.audit_purge', 'on', true)`);
    const rows = await tx.execute<{ id: string }>(sql`select id from tenants where is_test = true`);
    const ids = ((rows as any).rows ?? rows) as { id: string }[];
    if(ids.length){
      const personal=await tx.select({id:users.id}).from(users).where(and(inArray(users.tenantId,ids.map(x=>x.id)),isNotNull(users.email))).limit(1);
      if(personal.length)throw new Error('Refusing to purge a Preview tenant with personal accounts; preserve identities and use an explicitly reviewed reset procedure.');
    }
    for (const { id } of ids) {
      await tx.execute(sql`delete from reference_entries where tenant_id = ${id}`);
      await tx.execute(sql`delete from reference_imports where tenant_id = ${id}`);
      await tx.execute(sql`delete from idempotency_keys where tenant_id = ${id}`);
      await tx.execute(sql`delete from change_log where tenant_id = ${id}`);
      await tx.execute(sql`delete from audit_events where tenant_id = ${id}`);
      // Phase 3 rows reference cases, tasks and users; delete them first.
      await tx.execute(sql`delete from reminder_recipients where tenant_id = ${id}`);
      await tx.execute(sql`delete from reminders where tenant_id = ${id}`);
      await tx.execute(sql`delete from technician_wages where tenant_id = ${id}`);
      await tx.execute(sql`delete from case_responsibility_periods where tenant_id = ${id}`);
      await tx.execute(sql`delete from notifications where tenant_id = ${id}`);
      await tx.execute(sql`delete from case_alert_responses where tenant_id = ${id}`);
      await tx.execute(sql`delete from parts_statements where tenant_id = ${id}`);
      await tx.execute(sql`delete from external_work where tenant_id = ${id}`);
      await tx.execute(sql`delete from external_contractors where tenant_id = ${id}`);
      await tx.execute(sql`delete from part_discrepancies where tenant_id = ${id}`);
      await tx.execute(sql`delete from vehicle_import_rows where tenant_id = ${id}`);
      await tx.execute(sql`delete from vehicle_imports where tenant_id = ${id}`);
      await tx.execute(sql`delete from case_payments where tenant_id = ${id}`);
      await tx.execute(sql`delete from financial_approvals where tenant_id = ${id}`);
      await tx.execute(sql`delete from case_finance where tenant_id = ${id}`);
      await tx.execute(sql`update blockers set part_request_id = null where tenant_id = ${id}`);
      await tx.execute(sql`delete from part_price_notices where tenant_id = ${id}`);
      await tx.execute(sql`delete from part_quotes where tenant_id = ${id}`);
      await tx.execute(sql`delete from part_requests where tenant_id = ${id}`);
      await tx.execute(sql`delete from assessment_items where tenant_id = ${id}`);
      await tx.execute(sql`delete from assessments where tenant_id = ${id}`);
      await tx.execute(sql`delete from blockers where tenant_id = ${id}`);
      await tx.execute(
        sql`delete from task_dependencies where task_id in (select id from tasks where tenant_id = ${id})`,
      );
      await tx.execute(sql`delete from tasks where tenant_id = ${id}`);
      await tx.execute(sql`delete from qc_inspections where tenant_id = ${id}`);
      await tx.execute(sql`delete from cases where tenant_id = ${id}`);
      await tx.execute(sql`delete from case_counters where tenant_id = ${id}`);
      await tx.execute(sql`delete from customers where tenant_id = ${id}`);
      await tx.execute(sql`delete from vehicles where tenant_id = ${id}`);
      await tx.execute(sql`delete from sessions where tenant_id = ${id}`);
      await tx.execute(sql`delete from workshop_stations where tenant_id = ${id}`);
      await tx.execute(sql`delete from work_calendars where tenant_id = ${id}`);
      await tx.execute(sql`delete from departments where tenant_id = ${id}`);
      await tx.execute(sql`delete from users where tenant_id = ${id}`);
      await tx.execute(sql`delete from tenants where id = ${id} and is_test = true`);
    }
    return ids.length;
  });
}
