import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';

export type RoutineSchedule =
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'interval'; minutes: number };

export type RoutineInput = {
  requestId: string;
  name: string;
  instruction: string;
  schedule: RoutineSchedule;
  timezone: string;
};
export type RoutineEditInput = Omit<RoutineInput, 'requestId'>;
export type RoutineRunScope = { owner: Pick<Session, 'tenantId' | 'userId'>; botId: string; runId: string; leaseId: string };

export type RoutineRun = { id: string; status: string; scheduledFor: string; result: string | null };
export type StoredRoutine = RoutineInput & {
  id: string;
  botId: string;
  paused: boolean;
  when: string;
  nextRunAt: string;
  runs: RoutineRun[];
};

export class RoutineRequestConflict extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const weekdays = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; }
  catch { return false; }
}

export function validateRoutineInput(value: unknown): RoutineInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid routine');
  const body = value as Record<string, unknown>;
  const requestId = body.requestId;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  const timezone = body.timezone;
  const rawSchedule = body.schedule;
  if (!uuid.test(String(requestId || '')) || !name || name.length > 80 || !instruction || instruction.length > 8000 || !validTimezone(timezone) || !rawSchedule || typeof rawSchedule !== 'object' || Array.isArray(rawSchedule)) throw new Error('Invalid routine');
  const schedule = rawSchedule as Record<string, unknown>;
  if (schedule.kind === 'weekly' && Number.isInteger(schedule.weekday) && Number(schedule.weekday) >= 0 && Number(schedule.weekday) <= 6 && Number.isInteger(schedule.hour) && Number(schedule.hour) >= 0 && Number(schedule.hour) <= 23 && Number.isInteger(schedule.minute) && Number(schedule.minute) >= 0 && Number(schedule.minute) <= 59) {
    return { requestId: String(requestId), name, instruction, timezone, schedule: { kind: 'weekly', weekday: Number(schedule.weekday), hour: Number(schedule.hour), minute: Number(schedule.minute) } };
  }
  if (schedule.kind === 'interval' && Number.isInteger(schedule.minutes) && Number(schedule.minutes) >= 5 && Number(schedule.minutes) <= 10080) {
    return { requestId: String(requestId), name, instruction, timezone, schedule: { kind: 'interval', minutes: Number(schedule.minutes) } };
  }
  throw new Error('Invalid routine');
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };
function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function localTimeToUtc(date: Pick<LocalParts, 'year' | 'month' | 'day'>, hour: number, minute: number, timezone: string): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 6; attempt++) {
    const local = localParts(new Date(guess), timezone);
    const observed = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const adjustment = target - observed;
    if (!adjustment) return new Date(guess);
    guess += adjustment;
  }
  // If a wall time falls in a daylight-saving gap, choose the first local minute
  // after the gap on the intended date instead of dropping the routine.
  const targetDay = Date.UTC(date.year, date.month - 1, date.day);
  for (let delta = -180; delta <= 240; delta++) {
    const candidate = new Date(guess + delta * 60_000);
    const local = localParts(candidate, timezone);
    const localDay = Date.UTC(local.year, local.month - 1, local.day);
    const localMinute = local.hour * 60 + local.minute;
    if (localDay === targetDay && localMinute >= hour * 60 + minute) return candidate;
  }
  throw new Error('Could not resolve the routine schedule time');
}

export function nextRoutineRun(schedule: RoutineSchedule, timezone: string, after = new Date()): Date {
  if (!validTimezone(timezone) || !Number.isFinite(after.getTime())) throw new Error('Invalid routine time zone');
  if (schedule.kind === 'interval') return new Date(after.getTime() + schedule.minutes * 60_000);
  const current = localParts(after, timezone);
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const calendar = new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset));
    if (calendar.getUTCDay() !== schedule.weekday) continue;
    const candidate = localTimeToUtc({ year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate() }, schedule.hour, schedule.minute, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('Could not resolve the next routine run');
}

function nextAfterOccurrence(schedule: RoutineSchedule, timezone: string, occurrence: Date, now: Date): Date {
  if (schedule.kind !== 'interval') return nextRoutineRun(schedule, timezone, now);
  const interval = schedule.minutes * 60_000;
  let next = occurrence.getTime() + interval;
  if (next <= now.getTime()) next += (Math.floor((now.getTime() - next) / interval) + 1) * interval;
  return new Date(next);
}

export function routineWhen(schedule: RoutineSchedule, timezone: string): string {
  void timezone;
  if (schedule.kind === 'interval') return schedule.minutes % 60 === 0 ? `Every ${schedule.minutes / 60} hours` : `Every ${schedule.minutes} minutes`;
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2020, 0, 5, schedule.hour, schedule.minute)));
  return `${weekdays[schedule.weekday]} at ${time}`;
}

type RoutineRow = RowDataPacket & {
  id: string; botId: string; name: string; instruction: string; scheduleKind: 'weekly' | 'interval';
  weekday: number | null; localHour: number | null; localMinute: number | null; intervalMinutes: number | null;
  timezone: string; paused: number | boolean; nextRunAt: Date | string; requestId?: string;
};

function rowSchedule(row: RoutineRow): RoutineSchedule {
  if (row.scheduleKind === 'weekly' && row.weekday != null && row.localHour != null && row.localMinute != null) return { kind: 'weekly', weekday: Number(row.weekday), hour: Number(row.localHour), minute: Number(row.localMinute) };
  if (row.scheduleKind === 'interval' && row.intervalMinutes != null) return { kind: 'interval', minutes: Number(row.intervalMinutes) };
  throw new Error('Stored routine schedule is invalid');
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`);
  return date.toISOString();
}

function stored(row: RoutineRow, runs: RoutineRun[] = []): StoredRoutine {
  const schedule = rowSchedule(row);
  const timezone=String(row.timezone);
  return { id: String(row.id), botId: String(row.botId), requestId: String(row.requestId||''), name: String(row.name), instruction: String(row.instruction), schedule, timezone, paused: Boolean(row.paused), when:routineWhen(schedule,timezone), nextRunAt: asIso(row.nextRunAt), runs };
}

export class RoutineStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_routines (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(80) NOT NULL,
      instruction TEXT NOT NULL,
      schedule_kind ENUM('weekly','interval') NOT NULL,
      weekday TINYINT UNSIGNED NULL,
      local_hour TINYINT UNSIGNED NULL,
      local_minute TINYINT UNSIGNED NULL,
      interval_minutes SMALLINT UNSIGNED NULL,
      timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      next_run_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY routine_request (bot_id, request_id),
      KEY routine_due (paused, next_run_at),
      KEY bot_routines (bot_id, created_at, id),
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS routine_runs (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      routine_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      routine_name VARCHAR(80) NOT NULL,
      trigger_type ENUM('scheduled','test') NOT NULL,
      scheduled_for DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY routine_agent_run (run_id),
      KEY routine_history (routine_id, created_at),
      FOREIGN KEY (routine_id) REFERENCES bot_routines(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  async create(session: Session, botId: string, input: RoutineInput, now = new Date()): Promise<StoredRoutine | null> {
    const normalized = validateRoutineInput(input);
    if (!uuid.test(botId)) throw new Error('Invalid routine');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [bots] = await connection.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [botId, session.tenantId, session.userId]);
      if (!bots.length) { await connection.rollback(); return null; }
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT id,name,instruction,schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,timezone,paused,next_run_at AS nextRunAt,bot_id AS botId,request_id AS requestId FROM bot_routines WHERE bot_id=? AND request_id=? FOR UPDATE', [botId, normalized.requestId]);
      if (existing.length) {
        const row = existing[0] as RoutineRow;
        const same = row.name === normalized.name && row.instruction === normalized.instruction && row.timezone === normalized.timezone && JSON.stringify(rowSchedule(row)) === JSON.stringify(normalized.schedule);
        if (!same) throw new RoutineRequestConflict('Request ID already used with different content');
        await connection.commit();
        return stored(row);
      }
      const [counts] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM bot_routines WHERE bot_id=?', [botId]);
      if (Number(counts[0]?.count || 0) >= 50) throw new Error('Routine limit reached');
      const [scheduleKind, weekday, hour, minute, intervalMinutes] = normalized.schedule.kind === 'weekly'
        ? ['weekly', normalized.schedule.weekday, normalized.schedule.hour, normalized.schedule.minute, null]
        : ['interval', null, null, null, normalized.schedule.minutes];
      const id = randomUUID();
      const nextRunAt = nextRoutineRun(normalized.schedule, normalized.timezone, now);
      await connection.execute('INSERT INTO bot_routines (id,bot_id,request_id,name,instruction,schedule_kind,weekday,local_hour,local_minute,interval_minutes,timezone,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, botId, normalized.requestId, normalized.name, normalized.instruction, scheduleKind, weekday, hour, minute, intervalMinutes, normalized.timezone, nextRunAt]);
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT id,bot_id AS botId,request_id AS requestId,name,instruction,schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,timezone,paused,next_run_at AS nextRunAt FROM bot_routines WHERE id=?', [id]);
      await connection.commit();
      return stored(rows[0] as RoutineRow);
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }

  async list(session: Session, botId: string): Promise<StoredRoutine[] | null> {
    if (!uuid.test(botId)) return null;
    const [rows] = await this.pool.execute<RoutineRow[]>('SELECT r.id,r.bot_id AS botId,r.request_id AS requestId,r.name,r.instruction,r.schedule_kind AS scheduleKind,r.weekday,r.local_hour AS localHour,r.local_minute AS localMinute,r.interval_minutes AS intervalMinutes,r.timezone,r.paused,r.next_run_at AS nextRunAt FROM bot_routines r JOIN bots b ON b.id=r.bot_id WHERE r.bot_id=? AND b.tenant_id=? AND b.owner_id=? ORDER BY r.created_at,r.id LIMIT 50', [botId, session.tenantId, session.userId]);
    const routines = rows.map(row => ({ ...stored(row), requestId: String((row as RoutineRow & { requestId?: string }).requestId || '') }));
    if (!routines.length) {
      const [owned] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?', [botId, session.tenantId, session.userId]);
      return owned.length ? [] : null;
    }
    const ids = routines.map(routine => routine.id);
    const placeholders = ids.map(() => '?').join(',');
    const [runRows] = await this.pool.execute<RowDataPacket[]>(`SELECT rr.routine_id AS routineId,rr.id,rr.scheduled_for AS scheduledFor,ar.status,ar.result FROM routine_runs rr JOIN agent_runs ar ON ar.id=rr.run_id WHERE rr.routine_id IN (${placeholders}) ORDER BY rr.created_at DESC LIMIT ?`, [...ids, Math.min(1000, ids.length * 20)]);
    const byRoutine = new Map<string, RoutineRun[]>();
    for (const row of runRows) {
      const key = String(row.routineId), list = byRoutine.get(key) || [];
      if (list.length >= 20) continue;
      list.push({ id: String(row.id), status: String(row.status), scheduledFor: asIso(row.scheduledFor as Date | string), result: row.result == null ? null : String(row.result) });
      byRoutine.set(key, list);
    }
    return routines.map(routine => ({ ...routine, runs: byRoutine.get(routine.id) || [] }));
  }

  async listForRun(scope: RoutineRunScope): Promise<StoredRoutine[] | null> {
    if (!validRunScope(scope) || !await this.liveOwnedRun(this.pool, scope, false)) return null;
    const session: Session = { ...scope.owner, email: '', name: '', role: 'owner' };
    return this.list(session, scope.botId);
  }

  async createForRun(scope: RoutineRunScope, input: RoutineEditInput, now = new Date()): Promise<StoredRoutine | null> {
    if (!validRunScope(scope)) return null;
    const normalized = validateRoutineInput({ ...input, requestId: randomUUID() });
    normalized.requestId = deterministicRoutineRequestId(scope.runId, normalized);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (!await this.liveOwnedRun(connection, scope, true)) { await connection.rollback(); return null; }
      const session: Session = { ...scope.owner, email: '', name: '', role: 'owner' };
      const routine = await this.createInTransaction(connection, session, scope.botId, normalized, now);
      await connection.commit();
      return routine;
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }

  async updateForRun(scope: RoutineRunScope, routineId: string, input: RoutineEditInput, now = new Date()): Promise<StoredRoutine | null> {
    if (!validRunScope(scope) || !uuid.test(routineId)) return null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (!await this.liveOwnedRun(connection, scope, true)) { await connection.rollback(); return null; }
      const [rows] = await connection.execute<RoutineRow[]>(`SELECT r.id,r.bot_id AS botId,r.request_id AS requestId,r.name,r.instruction,
        r.schedule_kind AS scheduleKind,r.weekday,r.local_hour AS localHour,r.local_minute AS localMinute,r.interval_minutes AS intervalMinutes,
        r.timezone,r.paused,r.next_run_at AS nextRunAt FROM bot_routines r JOIN bots b ON b.id=r.bot_id
        WHERE r.id=? AND r.bot_id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE`, [routineId, scope.botId, scope.owner.tenantId, scope.owner.userId]);
      if (!rows.length) { await connection.rollback(); return null; }
      const previous = rows[0];
      const normalized = validateRoutineInput({ ...input, requestId: String(previous.requestId) });
      const [kind, weekday, hour, minute, interval] = normalized.schedule.kind === 'weekly'
        ? ['weekly', normalized.schedule.weekday, normalized.schedule.hour, normalized.schedule.minute, null]
        : ['interval', null, null, null, normalized.schedule.minutes];
      const nextRunAt = nextRoutineRun(normalized.schedule, normalized.timezone, now);
      await connection.execute(`UPDATE bot_routines SET name=?,instruction=?,schedule_kind=?,weekday=?,local_hour=?,local_minute=?,interval_minutes=?,timezone=?,next_run_at=? WHERE id=?`,
        [normalized.name, normalized.instruction, kind, weekday, hour, minute, interval, normalized.timezone, nextRunAt, routineId]);
      const [updated] = await connection.execute<RoutineRow[]>(`SELECT id,bot_id AS botId,request_id AS requestId,name,instruction,
        schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,
        timezone,paused,next_run_at AS nextRunAt FROM bot_routines WHERE id=?`, [routineId]);
      await connection.commit();
      return stored(updated[0]);
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }

  private async createInTransaction(connection: PoolConnection, session: Session, botId: string, normalized: RoutineInput, now: Date): Promise<StoredRoutine | null> {
    if (!uuid.test(botId)) throw new Error('Invalid routine');
    const [bots] = await connection.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [botId, session.tenantId, session.userId]);
    if (!bots.length) return null;
    const [existing] = await connection.execute<RowDataPacket[]>('SELECT id,name,instruction,schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,timezone,paused,next_run_at AS nextRunAt,bot_id AS botId,request_id AS requestId FROM bot_routines WHERE bot_id=? AND request_id=? FOR UPDATE', [botId, normalized.requestId]);
    if (existing.length) {
      const row = existing[0] as RoutineRow;
      const same = row.name === normalized.name && row.instruction === normalized.instruction && row.timezone === normalized.timezone && JSON.stringify(rowSchedule(row)) === JSON.stringify(normalized.schedule);
      if (!same) throw new RoutineRequestConflict('Request ID already used with different content');
      return stored(row);
    }
    const [counts] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM bot_routines WHERE bot_id=?', [botId]);
    if (Number(counts[0]?.count || 0) >= 50) throw new Error('Routine limit reached');
    const [scheduleKind, weekday, hour, minute, intervalMinutes] = normalized.schedule.kind === 'weekly'
      ? ['weekly', normalized.schedule.weekday, normalized.schedule.hour, normalized.schedule.minute, null]
      : ['interval', null, null, null, normalized.schedule.minutes];
    const id = randomUUID(), nextRunAt = nextRoutineRun(normalized.schedule, normalized.timezone, now);
    await connection.execute('INSERT INTO bot_routines (id,bot_id,request_id,name,instruction,schedule_kind,weekday,local_hour,local_minute,interval_minutes,timezone,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, botId, normalized.requestId, normalized.name, normalized.instruction, scheduleKind, weekday, hour, minute, intervalMinutes, normalized.timezone, nextRunAt]);
    const [rows] = await connection.execute<RoutineRow[]>('SELECT id,bot_id AS botId,request_id AS requestId,name,instruction,schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,timezone,paused,next_run_at AS nextRunAt FROM bot_routines WHERE id=?', [id]);
    return stored(rows[0]);
  }

  private async liveOwnedRun(connection: Pool | PoolConnection, scope: RoutineRunScope, lock: boolean): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id
      WHERE r.id=? AND r.bot_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3)
      AND b.tenant_id=? AND b.owner_id=?${lock ? ' FOR UPDATE' : ''}`,
      [scope.runId, scope.botId, scope.leaseId, scope.owner.tenantId, scope.owner.userId]);
    return rows.length === 1;
  }

  async setPaused(session: Session, routineId: string, paused: boolean, now = new Date()): Promise<StoredRoutine | null> {
    if (!uuid.test(routineId) || typeof paused !== 'boolean') return null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RoutineRow[]>('SELECT r.id,r.bot_id AS botId,r.name,r.instruction,r.schedule_kind AS scheduleKind,r.weekday,r.local_hour AS localHour,r.local_minute AS localMinute,r.interval_minutes AS intervalMinutes,r.timezone,r.paused,r.next_run_at AS nextRunAt FROM bot_routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE', [routineId, session.tenantId, session.userId]);
      if (!rows.length) { await connection.rollback(); return null; }
      const row = rows[0], schedule = rowSchedule(row);
      const nextRunAt = paused ? row.nextRunAt : new Date(asIso(row.nextRunAt)).getTime() > now.getTime() ? row.nextRunAt : nextRoutineRun(schedule, row.timezone, now);
      await connection.execute('UPDATE bot_routines SET paused=?,next_run_at=? WHERE id=?', [paused, nextRunAt, routineId]);
      const [updated] = await connection.execute<RoutineRow[]>('SELECT id,bot_id AS botId,name,instruction,schedule_kind AS scheduleKind,weekday,local_hour AS localHour,local_minute AS localMinute,interval_minutes AS intervalMinutes,timezone,paused,next_run_at AS nextRunAt FROM bot_routines WHERE id=?', [routineId]);
      await connection.commit();
      return stored(updated[0]);
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }

  async remove(session: Session, routineId: string): Promise<boolean> {
    if (!uuid.test(routineId)) return false;
    const [result] = await this.pool.execute<ResultSetHeader>('DELETE r FROM bot_routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=?', [routineId, session.tenantId, session.userId]);
    return result.affectedRows > 0;
  }

  async test(session: Session, routineId: string): Promise<{ id: string; status: 'queued' } | null> {
    if (!uuid.test(routineId)) return null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT r.id,r.bot_id AS botId,r.name,r.instruction,b.tenant_id AS tenantId,b.owner_id AS ownerId FROM bot_routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE', [routineId, session.tenantId, session.userId]);
      if (!rows.length) { await connection.rollback(); return null; }
      const row = rows[0], runId = randomUUID(), routineRunId = randomUUID(), requestId = randomUUID(), now = new Date();
      const prompt = `Test routine: ${String(row.name)}\n\n${String(row.instruction)}`;
      await connection.execute("INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash) VALUES (?,?,?,?,'queued','none',?)", [runId, row.botId, requestId, prompt, '0'.repeat(64)]);
      await connection.execute("INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'queued','Routine test')", [runId]);
      await connection.execute('INSERT INTO routine_runs (id,routine_id,run_id,routine_name,trigger_type,scheduled_for) VALUES (?,?,?,? ,\'test\',?)', [routineRunId, routineId, runId, row.name, now]);
      await connection.commit();
      return { id: runId, status: 'queued' };
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }

  /** Queue each overdue scheduled occurrence once, atomically with its next-run advance. */
  async dispatchDue(now = new Date(), limit = 50): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid routine dispatch limit');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RoutineRow[]>(`SELECT r.id,r.bot_id AS botId,r.name,r.instruction,r.schedule_kind AS scheduleKind,r.weekday,r.local_hour AS localHour,r.local_minute AS localMinute,r.interval_minutes AS intervalMinutes,r.timezone,r.paused,r.next_run_at AS nextRunAt
        FROM bot_routines r WHERE r.paused=FALSE AND r.next_run_at<=? ORDER BY r.next_run_at,r.id LIMIT ? FOR UPDATE SKIP LOCKED`, [now, limit]);
      for (const row of rows) {
        const runId = randomUUID(), routineRunId = randomUUID(), requestId = randomUUID();
        const prompt = `Scheduled routine: ${row.name}\n\n${row.instruction}`;
        await connection.execute("INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash) VALUES (?,?,?,?,'queued','none',?)", [runId, row.botId, requestId, prompt, '0'.repeat(64)]);
        await connection.execute("INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'queued','Scheduled routine')", [runId]);
        await connection.execute("INSERT INTO routine_runs (id,routine_id,run_id,routine_name,trigger_type,scheduled_for) VALUES (?,?,?,?,'scheduled',?)", [routineRunId, row.id, runId, row.name, row.nextRunAt]);
        const next = nextAfterOccurrence(rowSchedule(row), row.timezone, new Date(asIso(row.nextRunAt)), now);
        await connection.execute('UPDATE bot_routines SET next_run_at=? WHERE id=?', [next, row.id]);
      }
      await connection.commit();
      return rows.length;
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }
}

function validRunScope(scope: RoutineRunScope): boolean {
  return Boolean(scope && uuid.test(scope.owner?.tenantId || '') && uuid.test(scope.owner?.userId || '') && uuid.test(scope.botId || '') && uuid.test(scope.runId || '') && uuid.test(scope.leaseId || ''));
}

function deterministicRoutineRequestId(runId: string, input: RoutineEditInput): string {
  const schedule = input.schedule.kind === 'weekly'
    ? { kind: input.schedule.kind, weekday: input.schedule.weekday, hour: input.schedule.hour, minute: input.schedule.minute }
    : { kind: input.schedule.kind, minutes: input.schedule.minutes };
  const canonical = JSON.stringify({ name: input.name, instruction: input.instruction, schedule, timezone: input.timezone });
  const bytes = createHash('sha256').update(`${runId}\0${canonical}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
