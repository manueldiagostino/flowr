import type { VectorDomain } from './vector-domain';
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import type { ArithmeticDomain } from '../domains/arithmetic-domain';

/**
 * Format a VectorDomain for logging.
 * Shows: length, number of known positions, summary, attributes.
 */
export function formatVectorDomain<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	domain: VectorDomain<Domain>
): string {
	const lengthStr = domain.length.toString();
	const valuesStr = domain.known.toString();
	const summaryStr = domain.summary.toString();
	const attrsStr = domain.attributes.toString();

	return `Vector[length=${lengthStr}, values=${valuesStr}, summary=${summaryStr}, attrs=${attrsStr}]`;
}

/**
 * Format Top/Bottom result for debug logs.
 */
export function formatExtremeResult(
	result: 'top' | 'bottom',
	reason: string,
	context?: Record<string, string | undefined>
): string {
	const ctx = context ?
		Object.entries(context)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => `${k}=${v}`)
			.join(', ') :
		'';
	return `${result.toUpperCase()}: ${reason}${ctx ? ` (${ctx})` : ''}`;
}
