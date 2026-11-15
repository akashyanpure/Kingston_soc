/**
 * Manager portal (role manager or admin): operations overview + report archive.
 * Contract: packages/shared/src/roles.ts. Dates are Europe/London calendar dates, inclusive.
 */
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { formatAddress, listVisits, itemRecords, schemes, properties, reports, roomInstances, signatures, users, visits } from '@soc/db';
import { ManagerOverview, ManagerOverviewQuery, ReportSearchQuery, ReportSummary, SCHEMES } from '@soc/shared';
import { requireRole } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { badRequest, parse } from '../errors.js';

const TZ = 'Europe/London';

/** YYYY-MM-DD of an instant in Europe/London. */
export function londonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Monday–Sunday (Europe/London) of the week containing `now`. */
export function currentWeek(now = new Date()): { from: string; to: string } {
  const today = londonDate(now);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = (noonUtc.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(noonUtc.getTime() - dow * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

const lDate = (col: AnyPgColumn | SQL) => sql`(${col} at time zone 'Europe/London')::date`;
const inRange = (col: AnyPgColumn | SQL, from: string, to: string) => sql`${lDate(col)} between ${from}::date and ${to}::date`;
const within = (d: Date | null, from: string, to: string) => !!d && londonDate(d) >= from && londonDate(d) <= to;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const v = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(v * 10) / 10;
}

const landlordSignedSql = sql<boolean>`exists (select 1 from ${signatures} s where s.visit_id = ${visits.id} and s.role = 'landlord_agent' and s.deleted_at is null)`;
/** F/P/U items in present rooms (or miscellaneous), not deleted. */
const defectsSql = sql<number>`(select count(*)::int from ${itemRecords} i left join ${roomInstances} r on r.id = i.room_instance_id
  where i.visit_id = ${visits.id} and i.deleted_at is null and i.condition in ('F','P','U')
  and (i.room_instance_id is null or (r.present and r.deleted_at is null)))`;

/** One CSV cell: quoted when needed; formula-looking text is neutralised for spreadsheet safety. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const VISIT_TYPE_TEXT: Record<string, string> = { check_in: 'Check-in', check_out: 'Check-out', interim: 'Interim' };
const STATUS_TEXT: Record<string, string> = { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', issued: 'Issued', cancelled: 'Cancelled' };

export function manageRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** "Export CSV" of the schedule: visits scheduled in the range (Europe/London dates, inclusive). */
  app.get('/manage/visits.csv', async (req, reply) => {
    requireRole(req, 'manager', 'admin');
    const q = parse(ManagerOverviewQuery, req.query);
    const week = currentWeek();
    const from = q.from ?? week.from;
    const to = q.to ?? week.to;
    if (from > to) throw badRequest('from must be on or before to.');
    const rows = await listVisits(ctx.db, { from, to, limit: 5000 });
    const schemeNames = new Map((await ctx.db.select().from(schemes)).map((x) => [x.code as string, x.name]));
    const hm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    const header = ['date', 'time', 'address', 'postcode', 'scheme', 'visit type', 'officer', 'status', 'items graded', 'items total', 'defects', 'report number'];
    const lines = [header.join(',')];
    for (const v of rows) {
      const at = v.scheduledAt ? new Date(v.scheduledAt) : null;
      lines.push([
        at ? londonDate(at) : '', at ? hm(at) : '', v.address, v.postcode,
        schemeNames.get(v.schemeCode) ?? SCHEMES.find((x) => x.code === v.schemeCode)?.name ?? v.schemeCode, VISIT_TYPE_TEXT[v.visitType] ?? v.visitType,
        v.officerName, STATUS_TEXT[v.status] ?? v.status, v.itemsGraded, v.itemsTotal, v.defects, v.reportNumber ?? '',
      ].map(csvCell).join(','));
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="soc-visits-${from}-to-${to}.csv"`)
      .header('cache-control', 'no-store')
      .send('﻿' + lines.join('\r\n') + '\r\n'); // BOM so Excel reads UTF-8
  });

  app.get('/manage/overview', async (req) => {
    requireRole(req, 'manager', 'admin');
    const q = parse(ManagerOverviewQuery, req.query);
    const week = currentWeek();
    const from = q.from ?? week.from;
    const to = q.to ?? week.to;
    if (from > to) throw badRequest('from must be on or before to.');

    // Visits with any lifecycle date in range; classified in JS by London date.
    const activity = sql`coalesce(${visits.scheduledAt}, ${visits.startedAt}, ${visits.createdAt})`;
    const vRows = await ctx.db
      .select({
        id: visits.id, officerId: visits.officerId, status: visits.status,
        scheduledAt: visits.scheduledAt, startedAt: visits.startedAt, completedAt: visits.completedAt, createdAt: visits.createdAt,
      })
      .from(visits)
      .where(and(isNull(visits.deletedAt), or(inRange(activity, from, to), inRange(visits.completedAt, from, to), inRange(visits.startedAt, from, to))));

    const rRows = await ctx.db
      .select({
        reportId: reports.id, visitId: reports.visitId, reportNumber: reports.reportNumber, issuedAt: reports.issuedAt,
        officerId: visits.officerId, addressLine1: properties.addressLine1, addressLine2: properties.addressLine2, postcode: properties.postcode,
        landlordSigned: landlordSignedSql,
      })
      .from(reports)
      .innerJoin(visits, eq(visits.id, reports.visitId))
      .innerJoin(properties, eq(properties.id, visits.propertyId))
      .where(inRange(reports.issuedAt, from, to))
      .orderBy(desc(reports.issuedAt));

    const issuedVisitIds = rRows.map((r) => r.visitId);
    const uRows = await ctx.db
      .select({
        visitId: visits.id, addressLine1: properties.addressLine1, addressLine2: properties.addressLine2, postcode: properties.postcode,
        room: roomInstances.label, item: itemRecords.label, comment: itemRecords.comment, officerName: users.name, at: itemRecords.updatedAt,
      })
      .from(itemRecords)
      .innerJoin(visits, eq(visits.id, itemRecords.visitId))
      .innerJoin(properties, eq(properties.id, visits.propertyId))
      .innerJoin(users, eq(users.id, visits.officerId))
      .leftJoin(roomInstances, eq(roomInstances.id, itemRecords.roomInstanceId))
      .where(and(
        eq(itemRecords.condition, 'U'),
        isNull(itemRecords.deletedAt),
        isNull(visits.deletedAt),
        or(isNull(itemRecords.roomInstanceId), and(eq(roomInstances.present, true), isNull(roomInstances.deletedAt))),
        or(inRange(visits.updatedAt, from, to), issuedVisitIds.length ? inArray(visits.id, issuedVisitIds) : sql`false`),
      ))
      .orderBy(desc(itemRecords.updatedAt), desc(itemRecords.id));

    const officers = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.role, 'officer'), eq(users.active, true)))
      .orderBy(users.name);

    const activityDate = (v: (typeof vRows)[number]) => v.scheduledAt ?? v.startedAt ?? v.createdAt;
    const isScheduled = (v: (typeof vRows)[number]) => v.status === 'scheduled' && within(activityDate(v), from, to);
    const isInProgress = (v: (typeof vRows)[number]) => v.status === 'in_progress' && (within(activityDate(v), from, to) || within(v.startedAt, from, to));
    const isCompleted = (v: (typeof vRows)[number]) => v.status === 'completed' && (within(v.completedAt, from, to) || (!v.completedAt && within(activityDate(v), from, to)));
    const minutes = (v: (typeof vRows)[number]) =>
      v.startedAt && v.completedAt && within(v.completedAt, from, to) && (v.status === 'completed' || v.status === 'issued')
        ? (v.completedAt.getTime() - v.startedAt.getTime()) / 60_000
        : null;
    const durations = (rows: typeof vRows) => rows.map(minutes).filter((m): m is number => m !== null && m >= 0);
    const addr = (r: { addressLine1: string; addressLine2: string | null }) => formatAddress(r.addressLine1, r.addressLine2);
    const unsigned = rRows.filter((r) => !r.landlordSigned);

    return ManagerOverview.parse({
      from,
      to,
      kpis: {
        scheduled: vRows.filter(isScheduled).length,
        inProgress: vRows.filter(isInProgress).length,
        completed: vRows.filter(isCompleted).length,
        issued: rRows.length,
        unacceptableOpen: uRows.length,
        unsignedByLandlord: unsigned.length,
        medianMinutesPerSoc: median(durations(vRows)),
      },
      byOfficer: officers.map((o) => {
        const mine = vRows.filter((v) => v.officerId === o.id);
        return {
          officerId: o.id,
          name: o.name,
          scheduled: mine.filter(isScheduled).length,
          inProgress: mine.filter(isInProgress).length,
          issued: rRows.filter((r) => r.officerId === o.id).length,
          medianMinutes: median(durations(mine)),
        };
      }),
      unacceptable: uRows.slice(0, 50).map((u) => ({
        visitId: u.visitId, address: addr(u), postcode: u.postcode, room: u.room ?? 'MISCELLANEOUS', item: u.item,
        comment: u.comment, officerName: u.officerName, at: u.at.toISOString(),
      })),
      unsigned: unsigned.slice(0, 50).map((r) => ({
        reportId: r.reportId, visitId: r.visitId, reportNumber: r.reportNumber, address: `${addr(r)}, ${r.postcode}`, issuedAt: r.issuedAt.toISOString(),
      })),
    });
  });

  app.get('/manage/reports', async (req) => {
    requireRole(req, 'manager', 'admin');
    const q = parse(ReportSearchQuery, req.query);
    const where: (SQL | undefined)[] = [];
    const term = q.q?.trim();
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const compact = term.replace(/\s+/g, '').toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
      where.push(or(
        ilike(reports.reportNumber, like),
        ilike(properties.addressLine1, like),
        ilike(properties.addressLine2, like),
        sql`replace(lower(${properties.postcode}), ' ', '') like ${`%${compact}%`}`,
        eq(properties.uprn, term),
      ));
    }
    if (q.from) where.push(sql`${lDate(reports.issuedAt)} >= ${q.from}::date`);
    if (q.to) where.push(sql`${lDate(reports.issuedAt)} <= ${q.to}::date`);
    if (q.scheme) where.push(eq(visits.schemeCode, q.scheme));

    const rows = await ctx.db
      .select({
        reportId: reports.id, reportNumber: reports.reportNumber, visitId: reports.visitId, propertyId: visits.propertyId,
        addressLine1: properties.addressLine1, addressLine2: properties.addressLine2, postcode: properties.postcode,
        schemeCode: visits.schemeCode, visitType: visits.visitType, officerName: users.name, issuedAt: reports.issuedAt,
        pdfReady: reports.pdfReady, defects: defectsSql.mapWith(Number), landlordSigned: landlordSignedSql.mapWith(Boolean),
      })
      .from(reports)
      .innerJoin(visits, eq(visits.id, reports.visitId))
      .innerJoin(properties, eq(properties.id, visits.propertyId))
      .innerJoin(users, eq(users.id, visits.officerId))
      .where(and(...where))
      .orderBy(desc(reports.issuedAt), desc(reports.reportNumber))
      .limit(100);

    return {
      reports: rows.map(({ addressLine1, addressLine2, issuedAt, ...r }) =>
        ReportSummary.parse({ ...r, address: formatAddress(addressLine1, addressLine2), issuedAt: issuedAt.toISOString() })),
    };
  });
}
