import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// 0036_manage_pulse is additive: up on a 0035 database keeps existing rows, down removes only
// the new tables, and up again works (rehearsal of spec section 26 on PGlite).
const PULSE_TABLES = ['pulse_connections', 'pulse_runs', 'pulse_commands', 'receptions', 'reception_parts', 'reception_repairs', 'reception_defects', 'reception_external_work', 'reception_documents', 'reception_notes', 'reception_events'];

it('0036 up, down and up again on PGlite without touching existing rows', async () => {
  const source = resolve(__dirname, '../src/db/migrations');
  const prefix = join(tmpdir(), 'manage-pulse-migration-');
  const folder = mkdtempSync(prefix);
  if (!resolve(folder).startsWith(resolve(prefix))) throw new Error('Unexpected migration rehearsal path');
  const client = new PGlite();
  try {
    const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
    const previous = { ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx < 36) };
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(previous));
    for (const entry of previous.entries) copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
    const [tenant, user, vehicle, kase] = Array.from({ length: 4 }, () => randomUUID());
    await client.query("insert into tenants(id,code,name,is_test) values ($1,'pulse-0036','Synthetic 0036',true)", [tenant]);
    await client.query("insert into users(id,tenant_id,username,display_name,password_hash,roles,is_test) values ($1,$2,'pulse-0036','Synthetic user','unusable',ARRAY['system_admin'],true)", [user, tenant]);
    await client.query("insert into vehicles(id,tenant_id,vin,is_test) values ($1,$2,'TESTVIN0036000001',true)", [vehicle, tenant]);
    await client.query("insert into cases(id,tenant_id,vehicle_id,case_number,admitted_at,stage,created_by,updated_by,admission_no,admission_no_key,is_test) values ($1,$2,$3,'AC-1405-0936',now(),'in_repair',$4,$4,'1405020001','1405020001',true)", [kase, tenant, vehicle, user]);
    const before = (await client.query('select to_jsonb(c) as data from cases c where id=$1', [kase])).rows;

    await migrate(db, { migrationsFolder: source });
    for (const t of PULSE_TABLES) expect((await client.query(`select to_regclass('public.${t}') as name`)).rows).toEqual([{ name: t }]);
    expect((await client.query('select to_jsonb(c) as data from cases c where id=$1', [kase])).rows).toEqual(before);
    // A reception linked to the case, with a part, then a second card with the same DrcdRcd is refused.
    const reception = randomUUID();
    await client.query("insert into receptions(id,tenant_id,kasb_rcd,admission_no,admission_no_key,official,row_hash,case_id,link_state,is_test) values ($1,$2,'880001','1405020001','1405020001','{}'::jsonb,'h',$3,'linked',true)", [reception, tenant, kase]);
    await client.query("insert into reception_parts(id,tenant_id,reception_id,kasb_line_id,official,row_hash,is_test) values ($1,$2,$3,'11','{}'::jsonb,'h',true)", [randomUUID(), tenant, reception]);
    await expect(client.query("insert into receptions(id,tenant_id,kasb_rcd,official,row_hash) values ($1,$2,'880001','{}'::jsonb,'h')", [randomUUID(), tenant])).rejects.toThrow();
    await expect(client.query("insert into reception_parts(id,tenant_id,reception_id,kasb_line_id,official,row_hash) values ($1,$2,$3,'11','{}'::jsonb,'h')", [randomUUID(), tenant, reception])).rejects.toThrow();
    await client.query("insert into pulse_connections(id,tenant_id,dealer_code,username,settings,is_test) values ($1,$2,'9999','test.user','{}'::jsonb,true)", [randomUUID(), tenant]);
    await expect(client.query("insert into pulse_connections(id,tenant_id,dealer_code,username,settings) values ($1,$2,'9999','x','{}'::jsonb)", [randomUUID(), tenant])).rejects.toThrow();

    // Later migrations depend on these tables (0037 nightly list): roll them back first, newest first.
    const later = journal.entries.filter((e: { idx: number }) => e.idx > 36).map((e: { tag: string }) => e.tag).reverse() as string[];
    for (const tag of later) await client.exec(readFileSync(join(source, '../down', `${tag}.sql`), 'utf8'));
    await client.exec(readFileSync(join(source, '../down', '0036_manage_pulse.sql'), 'utf8'));
    for (const t of PULSE_TABLES) expect((await client.query(`select to_regclass('public.${t}') as name`)).rows).toEqual([{ name: null }]);
    expect((await client.query('select to_jsonb(c) as data from cases c where id=$1', [kase])).rows).toEqual(before);

    // Up again: the journal entries are removed as a rehearsal would, then 0036 and the later ones run a second time.
    await client.query(`delete from drizzle.__drizzle_migrations where id in (select id from drizzle.__drizzle_migrations order by id desc limit ${later.length + 1})`);
    await migrate(db, { migrationsFolder: source });
    for (const t of PULSE_TABLES) expect((await client.query(`select to_regclass('public.${t}') as name`)).rows).toEqual([{ name: t }]);
    expect((await client.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows).toEqual([{ n: journal.entries.length }]);
  } finally {
    await client.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
