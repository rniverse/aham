// Compact duration strings — `<integer><unit>`, unit one of s/m/h/d/w/y.
// No month unit, no long-form words. `1y` is exactly 365 days.
// Stateless, no DB, no AppError (see spec §4).

const SECONDS_PER_UNIT = {
	s: 1,
	m: 60,
	h: 60 * 60,
	d: 24 * 60 * 60,
	w: 7 * 24 * 60 * 60,
	y: 365 * 24 * 60 * 60,
} as const;

type Unit = keyof typeof SECONDS_PER_UNIT;

function toSeconds(input: string): number {
	const match = /^(\d+)([smhdwy])$/.exec(input.trim());
	if (!match) {
		throw new Error(
			`Invalid duration "${input}" — expected <integer><unit>, unit one of s m h d w y`,
		);
	}
	const amount = Number(match[1]);
	const unit = match[2] as Unit;
	return amount * SECONDS_PER_UNIT[unit];
}

export const utils$duration = { toSeconds };
