interface Env {
  DB: D1Database;
}

type EventType = "charged" | "used" | "storage";
const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}


function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const requestedHeaders = request.headers.get("access-control-request-headers");
  const allowOrigin = origin && origin.trim().length > 0 ? origin : "*";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": requestedHeaders || "content-type",
    "access-control-max-age": "86400",
    vary: "Origin, Access-Control-Request-Headers"
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function empty(status = 204): Response {
  return new Response(null, {
    status
  });
}

async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}


function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 0.0000001;
}

function parseVoltage(value: unknown): { value: number | null; error: string | null } {
  if (value === null || value === undefined || value === "") {
    return { value: null, error: null };
  }

  let parsed: number | null = null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { value: null, error: "finalAvgVoltage must be numeric." };
    }
    if (!hasAtMostTwoDecimals(value)) {
      return { value: null, error: "finalAvgVoltage must have at most 2 decimal places." };
    }
    parsed = value;
  } else if (typeof value === "string") {
    let cleaned = value.trim().replace(/v$/i, "").trim();
    if (cleaned.startsWith(".")) {
      cleaned = `0${cleaned}`;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      return { value: null, error: "finalAvgVoltage must be numeric with up to 2 decimals (example: 16.24 or 16.24v)." };
    }
    parsed = Number(cleaned);
  } else {
    return { value: null, error: "finalAvgVoltage must be numeric." };
  }

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 25) {
    return { value: null, error: "finalAvgVoltage must be between 0 and 25." };
  }

  return { value: Number(parsed.toFixed(2)), error: null };
}

function parseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseEventTimestamp(value: unknown): string {
  if (typeof value !== "string") return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseBatteryId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/batteries\/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseBatteryEventsId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/batteries\/(\d+)\/events$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function randomSerialPart(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => (byte % 36).toString(36))
    .join("")
    .toUpperCase();
}

function serialDatePart(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

async function generateSerial(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const serial = `LIPO-${serialDatePart()}-${randomSerialPart()}`;
    const existing = await env.DB.prepare("SELECT id FROM batteries WHERE serial = ? LIMIT 1").bind(serial).first();
    if (!existing) return serial;
  }
  return `LIPO-${serialDatePart()}-${Date.now().toString(36).toUpperCase()}`;
}

async function listBatteries(env: Env, archivedQuery: string | null): Promise<Response> {
  let whereClause = "WHERE b.archived = 0";
  if (archivedQuery === "all") {
    whereClause = "";
  } else if (archivedQuery === "true" || archivedQuery === "1") {
    whereClause = "WHERE b.archived = 1";
  }

  const { results } = await env.DB.prepare(
    `
      SELECT
        b.*,
        COALESCE((SELECT COUNT(*) FROM usage_events ue WHERE ue.battery_id = b.id AND ue.event_type = 'used'), 0) AS used_count,
        COALESCE((SELECT COUNT(*) FROM usage_events ue WHERE ue.battery_id = b.id AND ue.event_type = 'charged'), 0) AS charged_count,
        (SELECT MAX(ue.occurred_at) FROM usage_events ue WHERE ue.battery_id = b.id) AS last_usage_at,
        (SELECT ROUND(AVG(ue.final_avg_voltage), 2) FROM usage_events ue WHERE ue.battery_id = b.id AND ue.event_type = 'used' AND ue.final_avg_voltage IS NOT NULL) AS avg_final_voltage
      FROM batteries b
      ${whereClause}
      ORDER BY b.archived ASC, b.created_at DESC
    `
  ).all();

  return json({ batteries: results ?? [] });
}

async function getBatteryById(env: Env, batteryId: number): Promise<Response> {
  const battery = await env.DB.prepare(
    "SELECT * FROM batteries WHERE id = ?"
  )
    .bind(batteryId)
    .first();

  if (!battery) {
    return json({ error: "Battery not found." }, 404);
  }

  const stats = await env.DB.prepare(
    `
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'used' THEN 1 ELSE 0 END), 0) AS used_count,
        COALESCE(SUM(CASE WHEN event_type = 'charged' THEN 1 ELSE 0 END), 0) AS charged_count,
        MAX(occurred_at) AS last_usage_at,
        ROUND(AVG(CASE WHEN event_type = 'used' THEN final_avg_voltage END), 2) AS avg_final_voltage
      FROM usage_events
      WHERE battery_id = ?
    `
  )
    .bind(batteryId)
    .first();

  return json({ battery, stats });
}

async function createBattery(env: Env, request: Request): Promise<Response> {
  const body = await parseBody<Record<string, unknown>>(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);

  const capacityMah = parseInteger(body.capacityMah);
  const cellCount = parseInteger(body.cellCount);
  const purchasedDate = parseDateOnly(body.purchasedDate);
  const name = parseText(body.name);
  const notes = parseText(body.notes);
  const serialInput = parseText(body.serial);
  const ratingRaw = body.rating;
  const archivedRaw = body.archived;

  if (!capacityMah || capacityMah < 100 || capacityMah > 30000) {
    return json({ error: "capacityMah must be between 100 and 30000." }, 400);
  }

  if (!cellCount || cellCount < 1 || cellCount > 12) {
    return json({ error: "cellCount must be between 1 and 12." }, 400);
  }

  if (!purchasedDate) {
    return json({ error: "purchasedDate is required and must be a valid date." }, 400);
  }

  let rating: number | null = null;
  if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== "") {
    rating = parseInteger(ratingRaw);
    if (!rating || rating < 1 || rating > 5) {
      return json({ error: "rating must be between 1 and 5." }, 400);
    }
  }

  let archived = 0;
  if (archivedRaw !== undefined) {
    if (typeof archivedRaw === "boolean") {
      archived = archivedRaw ? 1 : 0;
    } else if (archivedRaw === 1 || archivedRaw === "1") {
      archived = 1;
    } else if (archivedRaw === 0 || archivedRaw === "0") {
      archived = 0;
    } else {
      return json({ error: "archived must be a boolean." }, 400);
    }
  }

  const serial = serialInput ? serialInput.toUpperCase() : await generateSerial(env);
  const now = new Date().toISOString();

  try {
    const result = await env.DB.prepare(
      `
        INSERT INTO batteries (
          name, serial, capacity_mah, cell_count, purchased_date, rating, archived, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(name, serial, capacityMah, cellCount, purchasedDate, rating, archived, notes, now, now)
      .run();

    const batteryId = Number(result.meta.last_row_id);
    const battery = await env.DB.prepare("SELECT * FROM batteries WHERE id = ?")
      .bind(batteryId)
      .first();

    return json({ battery }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    if (message.includes("UNIQUE")) {
      return json({ error: "Serial already exists." }, 409);
    }
    return json({ error: message }, 500);
  }
}

async function patchBattery(env: Env, request: Request, batteryId: number): Promise<Response> {
  const body = await parseBody<Record<string, unknown>>(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (body.serial !== undefined) {
    const serial = parseText(body.serial);
    if (!serial) return json({ error: "serial must be a non-empty string." }, 400);
    updates.push("serial = ?");
    binds.push(serial.toUpperCase());
  }

  if (body.name !== undefined) {
    updates.push("name = ?");
    binds.push(parseText(body.name));
  }

  if (body.capacityMah !== undefined) {
    const value = parseInteger(body.capacityMah);
    if (!value || value < 100 || value > 30000) {
      return json({ error: "capacityMah must be between 100 and 30000." }, 400);
    }
    updates.push("capacity_mah = ?");
    binds.push(value);
  }

  if (body.cellCount !== undefined) {
    const value = parseInteger(body.cellCount);
    if (!value || value < 1 || value > 12) {
      return json({ error: "cellCount must be between 1 and 12." }, 400);
    }
    updates.push("cell_count = ?");
    binds.push(value);
  }

  if (body.purchasedDate !== undefined) {
    const value = parseDateOnly(body.purchasedDate);
    if (!value) {
      return json({ error: "purchasedDate must be a valid date." }, 400);
    }
    updates.push("purchased_date = ?");
    binds.push(value);
  }

  if (body.rating !== undefined) {
    if (body.rating === null || body.rating === "") {
      updates.push("rating = ?");
      binds.push(null);
    } else {
      const rating = parseInteger(body.rating);
      if (!rating || rating < 1 || rating > 5) {
        return json({ error: "rating must be between 1 and 5." }, 400);
      }
      updates.push("rating = ?");
      binds.push(rating);
    }
  }

  if (body.archived !== undefined) {
    let archived: number | null = null;
    if (typeof body.archived === "boolean") archived = body.archived ? 1 : 0;
    else if (body.archived === 1 || body.archived === "1") archived = 1;
    else if (body.archived === 0 || body.archived === "0") archived = 0;
    if (archived === null) {
      return json({ error: "archived must be a boolean." }, 400);
    }
    updates.push("archived = ?");
    binds.push(archived);
  }

  if (body.notes !== undefined) {
    updates.push("notes = ?");
    binds.push(parseText(body.notes));
  }

  if (updates.length === 0) {
    return json({ error: "No valid fields to update." }, 400);
  }

  updates.push("updated_at = ?");
  binds.push(new Date().toISOString());
  binds.push(batteryId);

  try {
    const result = await env.DB.prepare(`UPDATE batteries SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

    if (!result.meta.changes) {
      return json({ error: "Battery not found." }, 404);
    }

    const battery = await env.DB.prepare("SELECT * FROM batteries WHERE id = ?")
      .bind(batteryId)
      .first();

    return json({ battery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    if (message.includes("UNIQUE")) {
      return json({ error: "Serial already exists." }, 409);
    }
    return json({ error: message }, 500);
  }
}

async function insertUsageEvents(
  env: Env,
  batteryIds: number[],
  eventType: EventType,
  finalAvgVoltage: number | null,
  notes: string | null,
  occurredAt: string
): Promise<void> {
  const storedEventType = eventType === "storage" ? "charged" : eventType;
  const placeholders = batteryIds.map(() => "?").join(", ");
  const existing = await env.DB.prepare(`SELECT id FROM batteries WHERE id IN (${placeholders})`)
    .bind(...batteryIds)
    .all();

  const existingIds = new Set((existing.results ?? []).map((item: Record<string, unknown>) => Number(item.id)));
  const missing = batteryIds.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Battery IDs not found: ${missing.join(", ")}`);
  }

  const createdAt = new Date().toISOString();
  const statements = batteryIds.map((batteryId) =>
    env.DB.prepare(
      `
        INSERT INTO usage_events (
          battery_id, event_type, final_avg_voltage, notes, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).bind(batteryId, storedEventType, finalAvgVoltage, notes, occurredAt, createdAt)
  );

  await env.DB.batch(statements);
}

async function createSingleEvent(env: Env, request: Request): Promise<Response> {
  const body = await parseBody<Record<string, unknown>>(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);

  const batteryId = parseInteger(body.batteryId);
  if (!batteryId) return json({ error: "batteryId must be an integer." }, 400);

  const eventType = body.eventType;
  if (eventType !== "charged" && eventType !== "used" && eventType !== "storage") {
    return json({ error: "eventType must be 'charged', 'used', or 'storage'." }, 400);
  }

  const parsedVoltage = parseVoltage(body.finalAvgVoltage);
  if (parsedVoltage.error) {
    return json({ error: parsedVoltage.error }, 400);
  }
  const finalAvgVoltage = eventType === "storage" ? 3.8 : parsedVoltage.value;
  if (eventType === "used" && finalAvgVoltage === null) {
    return json({ error: "finalAvgVoltage is required for used events." }, 400);
  }

  const notes = parseText(body.notes);
  const occurredAt = parseEventTimestamp(body.occurredAt);

  try {
    await insertUsageEvents(env, [batteryId], eventType, finalAvgVoltage, notes, occurredAt);
    return json({ inserted: 1 }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    return json({ error: message }, 400);
  }
}

async function createBatchEvents(env: Env, request: Request): Promise<Response> {
  const body = await parseBody<Record<string, unknown>>(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);

  const batteryIds = Array.isArray(body.batteryIds) ? body.batteryIds.map((id) => parseInteger(id)).filter((id): id is number => id !== null) : [];
  if (batteryIds.length === 0) {
    return json({ error: "batteryIds must contain at least one id." }, 400);
  }

  const uniqueIds = [...new Set(batteryIds)];
  const eventType = body.eventType;
  if (eventType !== "charged" && eventType !== "used" && eventType !== "storage") {
    return json({ error: "eventType must be 'charged', 'used', or 'storage'." }, 400);
  }

  const parsedVoltage = parseVoltage(body.finalAvgVoltage);
  if (parsedVoltage.error) {
    return json({ error: parsedVoltage.error }, 400);
  }
  const finalAvgVoltage = eventType === "storage" ? 3.8 : parsedVoltage.value;
  if (eventType === "used" && finalAvgVoltage === null) {
    return json({ error: "finalAvgVoltage is required for used events." }, 400);
  }

  const notes = parseText(body.notes);
  const occurredAt = parseEventTimestamp(body.occurredAt);

  try {
    await insertUsageEvents(env, uniqueIds, eventType, finalAvgVoltage, notes, occurredAt);
    return json({ inserted: uniqueIds.length }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    return json({ error: message }, 400);
  }
}

async function listBatteryEvents(env: Env, batteryId: number, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limitRaw = parseInteger(url.searchParams.get("limit"));
  const limit = Math.min(Math.max(limitRaw ?? 20, 1), 100);

  const battery = await env.DB.prepare("SELECT id FROM batteries WHERE id = ?")
    .bind(batteryId)
    .first();
  if (!battery) return json({ error: "Battery not found." }, 404);

  const { results } = await env.DB.prepare(
    `
      SELECT id, battery_id, event_type, final_avg_voltage, notes, occurred_at, created_at
      FROM usage_events
      WHERE battery_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `
  )
    .bind(batteryId, limit)
    .all();

  return json({ events: results ?? [] });
}

async function deleteUsageEvent(env: Env, eventId: number): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM usage_events WHERE id = ?").bind(eventId).run();
  if (!result.meta.changes) {
    return json({ error: "Event not found." }, 404);
  }
  return json({ deleted: 1 });
}

async function globalStats(env: Env): Promise<Response> {
  const totals = await env.DB.prepare(
    `
      SELECT
        COUNT(*) AS total_batteries,
        COALESCE(SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END), 0) AS archived_batteries,
        ROUND(AVG(rating), 2) AS average_rating
      FROM batteries
    `
  ).first();

  const { results } = await env.DB.prepare(
    `
      SELECT event_type, COUNT(*) AS count
      FROM usage_events
      GROUP BY event_type
    `
  ).all();

  return json({
    totals,
    events: results ?? []
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(empty(), request);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/health" && request.method === "GET") {
      return withCors(json({ ok: true, time: new Date().toISOString() }), request);
    }

    if (!pathname.startsWith("/api/")) {
      return withCors(json({ error: "Not found." }, 404), request);
    }

    try {
      if (pathname === "/api/batteries" && request.method === "GET") {
        return withCors(await listBatteries(env, url.searchParams.get("archived")), request);
      }

      if (pathname === "/api/batteries" && request.method === "POST") {
        return withCors(await createBattery(env, request), request);
      }

      const batteryId = parseBatteryId(pathname);
      if (batteryId && request.method === "GET") {
        return withCors(await getBatteryById(env, batteryId), request);
      }
      if (batteryId && request.method === "PATCH") {
        return withCors(await patchBattery(env, request, batteryId), request);
      }

      const batteryEventsId = parseBatteryEventsId(pathname);
      if (batteryEventsId && request.method === "GET") {
        return withCors(await listBatteryEvents(env, batteryEventsId, request), request);
      }

      if (pathname === "/api/events" && request.method === "POST") {
        return withCors(await createSingleEvent(env, request), request);
      }

      if (pathname === "/api/events/batch" && request.method === "POST") {
        return withCors(await createBatchEvents(env, request), request);
      }

      if (pathname === "/api/stats" && request.method === "GET") {
        return withCors(await globalStats(env), request);
      }

      const eventIdMatch = pathname.match(/^\/api\/events\/(\d+)$/);
      if (eventIdMatch && request.method === "DELETE") {
        return withCors(await deleteUsageEvent(env, Number(eventIdMatch[1])), request);
      }

      if (batteryId && request.method === "DELETE") {
        return withCors(await deleteBattery(env, batteryId), request);
      }

      if (pathname === "/api/stats" && request.method === "GET") {
        return withCors(await globalStats(env), request);
      }

      return withCors(json({ error: "Not found." }, 404), request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error.";
      return withCors(json({ error: message }, 500), request);
    }
  }
};

