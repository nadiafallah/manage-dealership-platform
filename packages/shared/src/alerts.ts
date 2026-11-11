// Cost alerts and advance-payment decisions (spec section 9). An alert never
// stops work: Manage asks the accident expert one question and records the
// answer. The cashier/manager advance approval flow is retired.

/** Kinds that raise a new alert. 'advance' only appears in the history of answers given before the change. */
export const ALERT_KINDS = ['parts_amount', 'expensive_part'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertHistoryKind = AlertKind | 'advance';

export const ALERT_KIND_LABELS: Record<AlertHistoryKind, string> = {
  parts_amount: 'هزینهٔ قطعات از سقف گذشت',
  expensive_part: 'قطعهٔ گران در خودروی شخصی',
  advance: 'پیش‌پرداخت (روال قبلی)',
};

export const ALERT_RESPONSES = ['received', 'not_received', 'not_needed'] as const;
export type AlertResponse = (typeof ALERT_RESPONSES)[number];

/** Owner/system-admin settings stored in tenants.settings; all amounts in Rial. */
export interface AlertSettings {
  /** Parts total of one case (spec decision 1: 100,000,000 toman). */
  partsAlertThresholdRial: number;
  /** One line (unit price × quantity) of a personal-coverage case, e.g. a body shell. */
  expensivePartThresholdRial: number;
  /** An Emdad Vijeh request unchanged for more than this many days is late. */
  emdadLateDays: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  partsAlertThresholdRial: 1_000_000_000,
  expensivePartThresholdRial: 500_000_000,
  emdadLateDays: 3,
};

/** Stored settings with defaults for missing or invalid values. */
export function alertSettingsOf(stored: Partial<Record<keyof AlertSettings, unknown>> | null | undefined): AlertSettings {
  const pick = (k: keyof AlertSettings, min: number) => {
    const v = stored?.[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : DEFAULT_ALERT_SETTINGS[k];
  };
  return {
    partsAlertThresholdRial: pick('partsAlertThresholdRial', 1),
    expensivePartThresholdRial: pick('expensivePartThresholdRial', 1),
    emdadLateDays: pick('emdadLateDays', 1),
  };
}

export interface AlertPartLine {
  description: string;
  quantity: number;
  /** Current sale price, else the price paid or approved; null when not priced yet. */
  unitRial: number | null;
}

export interface OpenAlert {
  kind: AlertKind;
  /** Each further multiple of the threshold, or each further expensive line, is a new level and asks again. */
  level: number;
  totalRial: number | null;
  thresholdRial: number;
  partDescription: string | null;
}

/**
 * Alerts the expert has not answered yet for one case. parts_amount: the total of
 * active lines crossed N × threshold. expensive_part: personal coverage only, the
 * Nth line at or above the per-line threshold.
 */
export function openAlerts(input: {
  coverageType: string;
  lines: readonly AlertPartLine[];
  settings: AlertSettings;
  answered: (kind: AlertKind, level: number) => boolean;
}): OpenAlert[] {
  const { lines, settings, answered } = input;
  const out: OpenAlert[] = [];
  const amount = (l: AlertPartLine) => (l.unitRial ?? 0) * l.quantity;
  const total = lines.reduce((n, l) => n + amount(l), 0);
  const level = Math.floor(total / settings.partsAlertThresholdRial);
  if (level >= 1 && !answered('parts_amount', level)) {
    out.push({ kind: 'parts_amount', level, totalRial: total, thresholdRial: settings.partsAlertThresholdRial, partDescription: null });
  }
  if (input.coverageType === 'personal') {
    const expensive = lines.filter((l) => amount(l) >= settings.expensivePartThresholdRial);
    if (expensive.length && !answered('expensive_part', expensive.length)) {
      const last = expensive[expensive.length - 1]!;
      out.push({ kind: 'expensive_part', level: expensive.length, totalRial: amount(last), thresholdRial: settings.expensivePartThresholdRial, partDescription: last.description });
    }
  }
  return out;
}
