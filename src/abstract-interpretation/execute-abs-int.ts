import type { NormalizedAst } from '../r-bridge/lang-4.x/ast/model/processing/decorate';

export interface AbsIntResult {
	result: string;
}

export function executeAbsInt(normalizeAst: NormalizedAst, input: string): Readonly<AbsIntResult> {

	const _a = normalizeAst;
	const _b = input;

	return {
		result: 'result AbsInt',
	};
}
