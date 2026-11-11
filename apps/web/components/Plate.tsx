import { toLatinDigits, toPersianDigits } from '@manage/shared';

// Standard Iranian private plate: 2 digits, letter, 3 digits, 2-digit region.
const PLATE_RE = /^(\d{2})\s*([؀-ۿa-zA-Z]{1,3})\s*(\d{3})\s*[-–|]?\s*(\d{2})$/;

export function parsePlate(text: string) {
  const m = toLatinDigits(text).trim().match(PLATE_RE);
  return m ? { a: m[1]!, letter: m[2]!, b: m[3]!, region: m[4]! } : null;
}

/** Renders a plate the way workshop staff recognise it; free text otherwise. */
export function Plate({ value, large, size }: { value: string | null | undefined; large?: boolean; size?: 'xl' }) {
  if (!value) return <span className="muted small">بدون پلاک</span>;
  const p = parsePlate(value);
  if (!p) return <span className="plate-free">{toPersianDigits(value)}</span>;
  return (
    <span className={`plate${large || size ? ' lg' : ''}${size ? ` ${size}` : ''}`} aria-label={`پلاک ${toPersianDigits(value)}`} role="img">
      <span className="flag" aria-hidden />
      <span className="seg" aria-hidden>
        <span>{toPersianDigits(p.a)}</span>
        <span className="letter">{p.letter}</span>
        <span>{toPersianDigits(p.b)}</span>
      </span>
      <span className="region" aria-hidden>
        <small>ایران</small>
        {toPersianDigits(p.region)}
      </span>
    </span>
  );
}

/** Compact one-line plate for tables and chips, in the physical order of the plate (left to right). */
export function PlateText({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const p = parsePlate(value);
  return (
    <bdi dir="ltr" className="plate-text" aria-label={`پلاک ${toPersianDigits(value)}`}>
      {p ? <>{toPersianDigits(p.a)} <bdi>{p.letter}</bdi> {toPersianDigits(p.b)} | {toPersianDigits(p.region)}</> : toPersianDigits(value)}
    </bdi>
  );
}
