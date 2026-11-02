import { URL } from 'url';

/**
 * Validates an IANA timezone identifier using the V8 Intl engine.
 */
export function isValidTimezone(tz: unknown): boolean {
  if (!tz || typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (trimmed.length > 64 || trimmed.length < 2) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a BCP 47 language/locale tag (e.g. 'en', 'en-US', 'hi-IN', 'es').
 */
export function isValidLocale(locale: unknown): boolean {
  if (!locale || typeof locale !== 'string') return false;
  const trimmed = locale.trim();
  if (trimmed.length > 35 || trimmed.length < 2) return false;

  // Standard BCP 47 pattern
  const bcp47Regex = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
  if (!bcp47Regex.test(trimmed)) return false;

  try {
    const parsed = new Intl.Locale(trimmed);
    return Boolean(parsed.language);
  } catch {
    return false;
  }
}

/**
 * Validates a 6-character hex color with leading hash (e.g. '#2563EB').
 */
export function isValidHexColor(color: unknown): boolean {
  if (!color || typeof color !== 'string') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(color.trim());
}

/**
 * Validates a logo URL.
 * Requires http or https scheme, valid hostname, no credentials or script protocols.
 */
export function isValidLogoUrl(rawUrl: unknown): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) return false;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    if (!parsed.hostname || parsed.hostname.includes(' ') || parsed.hostname.includes('<')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Domain or Origin format validation.
 * Supports: example.com, sub.example.com, https://example.com, https://example.com:3000
 * Strictly forbids wildcards like '*', invalid characters, and dangerous schemes.
 */
export function validateAllowedDomains(input: unknown): { valid: boolean; domains?: string[]; error?: string } {
  if (input === undefined || input === null) {
    return { valid: true, domains: [] };
  }

  let domainsList: string[] = [];
  if (Array.isArray(input)) {
    domainsList = input.map((d) => String(d).trim()).filter(Boolean);
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        domainsList = parsed.map((d) => String(d).trim()).filter(Boolean);
      } else {
        domainsList = input.split(',').map((d) => d.trim()).filter(Boolean);
      }
    } catch {
      domainsList = input.split(',').map((d) => d.trim()).filter(Boolean);
    }
  } else {
    return { valid: false, error: 'Allowed domains must be an array of domain strings or a comma-separated list' };
  }

  const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  const localhostRegex = /^localhost(?::\d+)?$/i;

  const validated: string[] = [];
  for (const raw of domainsList) {
    const item = raw.trim();
    if (!item) continue;

    if (item === '*' || item.includes('*')) {
      return { valid: false, error: 'Wildcard domain "*" is forbidden for CORS isolation security' };
    }

    if (item.startsWith('http://') || item.startsWith('https://')) {
      try {
        const parsed = new URL(item);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { valid: false, error: `Invalid protocol in domain origin: ${item}` };
        }
        if (parsed.pathname !== '/' && parsed.pathname !== '') {
          return { valid: false, error: `Allowed origin must not contain a path component: ${item}` };
        }
        validated.push(parsed.origin);
      } catch {
        return { valid: false, error: `Invalid URL format for allowed domain: ${item}` };
      }
    } else {
      // Plain hostname or FQDN
      if (!hostnameRegex.test(item) && !localhostRegex.test(item)) {
        return { valid: false, error: `Invalid domain hostname format: ${item}` };
      }
      validated.push(item);
    }
  }

  return { valid: true, domains: validated };
}

export const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type ValidDay = typeof VALID_DAYS[number];

export interface BusinessDayConfig {
  enabled: boolean;
  start?: string;
  end?: string;
}

export interface BusinessHoursPayload {
  timezone?: string;
  schedule?: Record<string, BusinessDayConfig>;
}

const TIME_REGEX = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Validates weekly business hours structure, requiring exactly the seven weekday identifiers,
 * boolean enabled flags, valid 24-hr time formats, start < end for operational days,
 * and consistent normalization for non-operational days.
 */
export function validateBusinessHours(input: unknown): { valid: boolean; data?: any; error?: string } {
  if (input === undefined || input === null) {
    return { valid: true, data: null };
  }

  let hoursObj: any = input;
  if (typeof input === 'string') {
    try {
      hoursObj = JSON.parse(input);
    } catch {
      return { valid: false, error: 'businessHours must be valid JSON or structured object' };
    }
  }

  if (typeof hoursObj !== 'object' || hoursObj === null || Array.isArray(hoursObj)) {
    return { valid: false, error: 'businessHours must be a structured object' };
  }

  // Validate allowed top-level keys
  const allowedKeys = ['timezone', 'schedule'];
  for (const k of Object.keys(hoursObj)) {
    if (!allowedKeys.includes(k)) {
      return { valid: false, error: `businessHours contains unrecognized field "${k}"` };
    }
  }

  // Validate timezone in business hours if specified
  if (hoursObj.timezone !== undefined && hoursObj.timezone !== null) {
    if (!isValidTimezone(hoursObj.timezone)) {
      return { valid: false, error: `Invalid timezone in businessHours: ${hoursObj.timezone}` };
    }
  }

  if (!hoursObj.schedule || typeof hoursObj.schedule !== 'object' || Array.isArray(hoursObj.schedule)) {
    return { valid: false, error: 'businessHours must contain a "schedule" object defining weekly operational days' };
  }

  const schedule = hoursObj.schedule;
  const scheduleKeys = Object.keys(schedule).map((k) => k.toLowerCase());

  // Must reject empty schedules
  if (scheduleKeys.length === 0) {
    return { valid: false, error: 'businessHours schedule cannot be empty; exactly all seven weekdays are required' };
  }

  // Require exactly the seven supported weekday identifiers
  for (const day of VALID_DAYS) {
    if (!scheduleKeys.includes(day)) {
      return {
        valid: false,
        error: `businessHours schedule must contain all seven weekdays; missing operational day "${day}"`,
      };
    }
  }

  // Reject unexpected day keys
  for (const key of Object.keys(schedule)) {
    if (!VALID_DAYS.includes(key.toLowerCase() as ValidDay)) {
      return { valid: false, error: `Invalid day identifier "${key}" in business hours schedule` };
    }
  }

  const normalizedSchedule: Record<string, { enabled: boolean; start: string; end: string }> = {};

  for (const day of VALID_DAYS) {
    const rawKey = Object.keys(schedule).find((k) => k.toLowerCase() === day) || day;
    const dayCfg = schedule[rawKey];

    if (typeof dayCfg !== 'object' || dayCfg === null || Array.isArray(dayCfg)) {
      return { valid: false, error: `Day configuration for "${day}" must be an object` };
    }

    if (typeof dayCfg.enabled !== 'boolean') {
      return { valid: false, error: `Field "enabled" must be an actual boolean for day "${day}"` };
    }

    if (dayCfg.enabled) {
      if (!dayCfg.start || typeof dayCfg.start !== 'string' || !TIME_REGEX.test(dayCfg.start.trim())) {
        return { valid: false, error: `Invalid start time format for ${day}: must be 24-hour HH:MM (e.g. 09:00)` };
      }
      if (!dayCfg.end || typeof dayCfg.end !== 'string' || !TIME_REGEX.test(dayCfg.end.trim())) {
        return { valid: false, error: `Invalid end time format for ${day}: must be 24-hour HH:MM (e.g. 17:00)` };
      }

      const start = dayCfg.start.trim();
      const end = dayCfg.end.trim();

      if (start === end) {
        return {
          valid: false,
          error: `Start time (${start}) and end time (${end}) cannot be equal for operational day ${day}`,
        };
      }

      if (start > end) {
        return {
          valid: false,
          error: `Start time (${start}) must precede end time (${end}) for operational day ${day}`,
        };
      }

      normalizedSchedule[day] = { enabled: true, start, end };
    } else {
      // Validate start/end if optionally provided on disabled day
      if (dayCfg.start !== undefined && dayCfg.start !== null) {
        if (typeof dayCfg.start !== 'string' || !TIME_REGEX.test(dayCfg.start.trim())) {
          return { valid: false, error: `Invalid start time format for disabled day ${day}` };
        }
      }
      if (dayCfg.end !== undefined && dayCfg.end !== null) {
        if (typeof dayCfg.end !== 'string' || !TIME_REGEX.test(dayCfg.end.trim())) {
          return { valid: false, error: `Invalid end time format for disabled day ${day}` };
        }
      }

      // Consistent representation for disabled days
      normalizedSchedule[day] = {
        enabled: false,
        start: '00:00',
        end: '00:00',
      };
    }
  }

  return {
    valid: true,
    data: {
      timezone: hoursObj.timezone || 'UTC',
      schedule: normalizedSchedule,
    },
  };
}
