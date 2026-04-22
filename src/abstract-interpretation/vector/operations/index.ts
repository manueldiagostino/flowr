
/**
 * Vector operations barrel export.
 * Re-exports all vector abstract interpretation operations.
 */

export { applyConcatenate } from './concatenate';
export { applyRecycle, recyclePair, applyBinaryOp, applyNegate } from './arithmetic';
export {
	applySelect,
	applySelectPositive,
	applySelectNegative,
	applySelectLogical
} from './select';
export {
	applyUpdate,
	applyUpdatePositive,
	applyUpdateNegative,
	applyUpdateLogical,
	buildSelectorMatchingSourceLength
} from './update';
export { applySetAttr } from './set-attr';
