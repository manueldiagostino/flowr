import type { AnyAbstractDomain } from './abstract-domain';

/**
 * Capability interface for domains that support arithmetic operations.
 * Only numeric domains (IntervalDomain, PosIntervalDomain) implement this.
 * All operations must handle Bottom/Top short-circuiting internally.
 * @template Domain - The concrete domain type implementing this interface
 */
// eslint-disable-next-line unused-imports/no-unused-vars -- Domain is used in constraint
export interface ArithmeticDomain<Domain extends AnyAbstractDomain> {
	/** Element-wise addition: this + other */
	add(other: this): this;
	/** Element-wise subtraction: this - other */
	subtract(other: this): this;
	/** Element-wise multiplication: this * other */
	multiply(other: this): this;
	/** Element-wise division: this / other */
	divide(other: this): this;
	/** Unary negation: -this */
	negate(): this;
}
