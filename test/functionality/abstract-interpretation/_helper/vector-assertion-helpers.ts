import { assert } from 'vitest';
import type { AbstractValue, AnyAbstractDomain } from '../../../../src/abstract-interpretation/domains/abstract-domain';
import type { ArithmeticDomain } from '../../../../src/abstract-interpretation/domains/arithmetic-domain';
import { IntervalDomain, IntervalTop } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import type { SingletonDomain } from '../../../../src/abstract-interpretation/domains/singleton-domain';
import type { VectorAttr } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import type { RVectorType } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import type { ValueToDomainConverter } from '../../../../src/abstract-interpretation/vector/resolve-vector-args';
import type { VectorDomain, VectorProduct } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { Identifier } from '../../../../src/dataflow/environments/identifier';
import type { RSymbol } from '../../../../src/r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import type { ParentInformation } from '../../../../src/r-bridge/lang-4.x/ast/model/processing/decorate';
import { RType } from '../../../../src/r-bridge/lang-4.x/ast/model/type';
import { RNa } from '../../../../src/r-bridge/lang-4.x/convert-values';
import type { RShell } from '../../../../src/r-bridge/shell';
import { SlicingCriterion } from '../../../../src/slicing/criterion/parse';
import { SourceRange } from '../../../../src/util/range';
import { Record } from '../../../../src/util/record';
import { domainFactory, naAwareFactory, intervalFactory } from '../_helper/vector-interval-factory';
import { getVectorForCriterion, runVectorInference } from '../_helper/vector-inference-helpers';

/** The abstract value in an NA-aware domain for a given domain. */
export type AbstractNaValue<Domain extends AnyAbstractDomain> = { inner: AbstractValue<Domain>, hasNA: boolean };

/**
 * The expected abstract value of a vector, used in tests.
 * Each property corresponds to a component of the vector abstract domain, such as `length`, `values`, `summary`, `attributes`, and `type`.
 * The values are represented as abstract values in the respective domains.
 */
export interface ExpectedVector<Domain extends AnyAbstractDomain> extends Record<keyof VectorProduct<Domain>, unknown> {
	length:     AbstractValue<IntervalDomain>;
	known:      readonly AbstractNaValue<Domain>[];
	summary:    AbstractNaValue<Domain>;
	attributes: AbstractValue<VectorAttrDomain>;
	type:       AbstractValue<RVectorTypeDomain>;
};

/** A test case for vector evaluation, mapping identifiers as slicing criteria to their expected abstract vector values. */
export type TestCase<Domain extends AnyAbstractDomain> = Record<`${number}@${string}`, ExpectedVector<Domain> | undefined>;

/**
 * Type of an entry for a validation test case, containing the slicing criterion, the inferred vector domain for this criterion,
 * the R symbol node corresponding to this criterion, and the line of code where this criterion is located.
 */
export interface TestEntry<Domain extends AnyAbstractDomain> {
	criterion: `${number}@${string}`,
	inferred:  Domain | undefined,
	node:      RSymbol<ParentInformation>,
	line:      number
}

/** Converts an abstract value to an NA-aware abstract value. */
export function asNaAware<Domain extends AnyAbstractDomain>(value: AbstractValue<Domain>): AbstractNaValue<Domain> {
	return { inner: value, hasNA: false };
}

/** Converts a list of abstract values to a list of NA-aware abstract values. */
export function asNaAwares<Domain extends AnyAbstractDomain>(...values: readonly (AbstractValue<Domain> | AbstractNaValue<Domain>)[]): readonly AbstractNaValue<Domain>[] {
	return values.map((value): AbstractNaValue<Domain> => {
		if(typeof value == 'object' && value !== null && 'inner' in value && 'hasNA' in value) {
			return value;
		}
		return asNaAware(value);
	});
}

/** Wraps a plain abstract value into an AbstractNaValue with hasNA=true. */
export function asNaAwareWithNA<Domain extends AnyAbstractDomain>(value: AbstractValue<Domain>): AbstractNaValue<Domain> {
	return { inner: value, hasNA: true };
}

/** Converts a list of abstract values to a list of NA-aware abstract values, all with hasNA=true. */
export function asNaAwareWithNAs<Domain extends AnyAbstractDomain>(...values: readonly AbstractValue<Domain>[]): readonly AbstractNaValue<Domain>[] {
	return values.map(value => asNaAwareWithNA(value));
}

/** NA interval constant (bottom inner with hasNA=true). */
export const NaInterval = { inner: Bottom, hasNA: true } satisfies AbstractNaValue<IntervalDomain>;

/** NA boolean constant (bottom inner with hasNA=true). */
export const NaBoolean = { inner: Bottom, hasNA: true } satisfies AbstractNaValue<SingletonDomain<boolean>>;

/** Converts an AbstractNaValue<IntervalDomain> to a real NAAwareDomain<IntervalDomain>. */
export function toNAAwareDomain(value: AbstractNaValue<IntervalDomain>): NAAwareDomain<IntervalDomain> {
	const { inner, hasNA } = value;
	let domainValue: IntervalDomain;
	if(inner === IntervalTop) {
		domainValue = IntervalDomain.top();
	} else if(inner === Bottom) {
		domainValue = IntervalDomain.bottom();
	} else {
		domainValue = new IntervalDomain(inner);
	}
	return new NAAwareDomain({ inner: domainValue, hasNA }, intervalFactory);
}

/** Converts a list of AbstractNaValue<IntervalDomain> to real NAAwareDomain<IntervalDomain> instances. */
export function toNAAwareDomains(values: readonly AbstractNaValue<IntervalDomain>[]): NAAwareDomain<IntervalDomain>[] {
	return values.map(toNAAwareDomain);
}

/**
 * Asserts that the inferred interval vectors for a given criterion in the code match the expected vector.
 */
export async function assertVectorDomainIntervals(shell: RShell, code: string, expected: TestCase<IntervalDomain>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(IntervalDomain.top()), value => {
			if(typeof value === 'number') {
				return new Set([value]);
			} else if(typeof value === 'boolean') {
				return new Set([value ? 1 : 0]);
			}
			return undefined;
		});
		assertVectorValue(criterion, inferred, expectedVector, IntervalDomain.top());
	}
}

/**
 * Asserts that the inferred string set vectors for a given criterion in the code match the expected vector.
 * NOTE: Currently disabled because VectorDomain requires ArithmeticDomain and BoundedSetDomain doesn't implement it.
 */
/*
export async function assertVectorDomainStrings(shell: RShell, code: string, expected: TestCase<BoundedSetDomain<string>>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(BoundedSetDomain.top<string>()), value => typeof value === 'string' ? new Set([value]) : undefined);
		assertVectorValue(criterion, inferred, expectedVector, BoundedSetDomain.top());
	}
}
*/

/**
 * Asserts that the inferred boolean vectors for a given criterion in the code match the expected vector.
 * NOTE: Currently disabled because VectorDomain requires ArithmeticDomain and SingletonDomain doesn't implement it.
 */
/*
export async function assertVectorDomainBooleans(shell: RShell, code: string, expected: TestCase<SingletonDomain<boolean>>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(SingletonDomain.top<boolean>()), value => typeof value === 'boolean' ? new Set([value]) : undefined);
		assertVectorValue(criterion, inferred, expectedVector, SingletonDomain.top());
	}
}
*/

/**
 * Validates that the inferred interval vector domain for the given criteria in the code matches the expected interval vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
export async function validateVectorDomainIntervals(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, IntervalDomain.top(), value => {
		if(typeof value === 'number') {
			return new Set([value]);
		} else if(typeof value === 'boolean') {
			return new Set([value ? 1 : 0]);
		}
		return undefined;
	}, str => {
		const value = Number.parseFloat(str);
		return [value, value] as const;
	});
}

/**
 * Validates that the inferred string set vector domain for the given criteria in the code matches the expected string set vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 * NOTE: Currently disabled because VectorDomain requires ArithmeticDomain and BoundedSetDomain doesn't implement it.
 */
/*
export async function validateVectorDomainStrings(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, BoundedSetDomain.top<string>(), value => typeof value === 'string' ? new Set([value]) : undefined, str => new Set([str]));
}
*/

/**
 * Validates that the inferred boolean vector domain for the given criteria in the code matches the expected boolean vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 * NOTE: Currently disabled because VectorDomain requires ArithmeticDomain and SingletonDomain doesn't implement it.
 */
/*
export async function validateVectorDomainBooleans(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, SingletonDomain.top<boolean>(), value => typeof value === 'boolean' ? new Set([value]) : undefined, str => str === 'TRUE');
}
*/

/**
 * Validates that the inferred vector domain for the given criteria in the code matches the expected vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
export async function validateVectorDomain<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(shell: RShell, code: string, criteria: readonly `${number}@${string}`[], domain: Domain, valueToDomain: ValueToDomainConverter<Domain>, valueDeserializer: (value: string) => AbstractValue<Domain>) {
	const testEntries: TestEntry<VectorDomain<Domain>>[] = [];

	for(const criterion of criteria) {
		const result = await runVectorInference(shell, code, domainFactory(domain), valueToDomain);
		const inferred = result.getForCriterion(criterion);
		const nodeId = SlicingCriterion.parse(criterion, result.pipelineResult.normalize.idMap);
		const node = result.pipelineResult.normalize.idMap.get(nodeId);

		if(node?.type !== RType.Symbol) {
			throw new Error(`slicing criterion ${criterion} does not refer to an R symbol`);
		}
		const range = SourceRange.fromNode(node);
		const line = range ? SourceRange.getEndLine(range) : undefined;

		if(line === undefined) {
			throw new Error(`cannot resolve line of criterion ${criterion}`);
		}
		testEntries.push({ criterion, inferred, node, line });
	}
	testEntries.sort((a, b) => b.line - a.line);
	const lines = code.split('\n');

	for(const { criterion, node, line } of testEntries) {
		const outputCode = createCodeForOutput(criterion, Identifier.toString(node.content));
		lines.splice(line, 0, outputCode);
	}
	shell.clearEnvironment();
	const instrumentedCode = lines.join('\n');
	const output = await shell.sendCommandWithOutput(instrumentedCode);

	for(const { criterion, inferred } of testEntries) {
		const expected = getRealDomainFromOutput(criterion, output, domain, valueDeserializer);
		assertVectorValue(criterion, inferred, expected, domain, true);
	}
}

/**
 * Creates R code to output the properties of the vector at the given slicing criterion.
 */
export function createCodeForOutput(
	criterion: SlicingCriterion,
	symbol: string
): string {
	const marker = getOutputMarker(criterion);
	return `cat(sprintf("${marker} %s,%s,%s,%s,%s,%s\\n", is.vector(${symbol}), is.atomic(${symbol}), paste(length(${symbol})), paste(${symbol}, collapse = ";"), paste(names(attributes(${symbol})), collapse = ";"), typeof(${symbol})))`;
}

/**
 * Parses the output of the instrumented code to extract the actual properties of the vector at the given slicing criterion, and constructs an expected vector from these properties.
 */
export function getRealDomainFromOutput<Domain extends AnyAbstractDomain>(
	criterion: SlicingCriterion,
	output: string[],
	domain: Domain,
	valueDeserializer: (value: string) => AbstractValue<Domain>
): ExpectedVector<Domain> | undefined {
	const marker = getOutputMarker(criterion);
	const line = output.find(line => line.startsWith(marker))?.replace(marker, '').trim();

	if(line === undefined) {
		throw new Error(`cannot parse output of instrumented code for ${criterion}`);
	}
	const OutputRegex = /^(TRUE|FALSE),(TRUE|FALSE),(\w*),(.*),(.*),(.*)$/;
	const result = line.match(OutputRegex);

	if(result?.length === 7) {
		const domainBottom = domain.bottom().value as AbstractValue<Domain>;
		const isVector = result[1] === 'TRUE';
		const isAtomic = result[2] === 'TRUE';
		const length = Number.parseInt(result[3]);
		const values = result[4].length > 0 ? result[4].split(';') : [];
		const attributes = result[5].length > 0 ? result[5].split(';') : [];
		const type = result[6];

		if(isVector && isAtomic) {
			return {
				length:     [length, length],
				known:      values.map(value => value === RNa ? { inner: domainBottom, hasNA: true } : asNaAware(valueDeserializer(value))),
				summary:    asNaAware(domainBottom),
				attributes: { may: new Set(attributes as VectorAttr[]), must: new Set(attributes as VectorAttr[]) },
				type:       type as RVectorType
			};
		}
	}
}

/**
 * Generates a marker for a slicing criterion to identify the corresponding line in the output of the instrumented code.
 */
export function getOutputMarker(criterion: SlicingCriterion): string {
	return `VECTOR INFERENCE ${criterion}:`;
}

/**
 * Asserts that the inferred vector for a given criterion matches the expected vector.
 */
export function assertVectorValue<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(criterion: string, inferred: VectorDomain<Domain> | undefined, expected: ExpectedVector<Domain> | undefined, domain: Domain, overapproximation?: boolean) {
	if(inferred === undefined || expected === undefined) {
		if(overapproximation) {
			assert.ok(inferred === undefined, `Expected vector for criterion "${criterion}" to be undefined, but got ${inferred?.toString()}`);
		} else {
			assert.ok(inferred === undefined && expected === undefined, `Expected vector for criterion "${criterion}" to be ${expected === undefined ? 'undefined' : 'defined'}, but got ${inferred?.toString()}`);
		}
		return;
	}
	const factory = domainFactory(domain);
	const naFactory = naAwareFactory(factory);
	const length = new IntervalDomain(expected.length);
	const known = new KnownInitialPositionsDomain(expected.known.map(({ inner, hasNA }) => new NAAwareDomain({ inner: domain.create(inner), hasNA }, factory)), naFactory);
	const summary = new NAAwareDomain({ inner: domain.create(expected.summary.inner), hasNA: expected.summary.hasNA }, factory);
	const attributes = new VectorAttrDomain(expected.attributes);
	const type = new RVectorTypeDomain(expected.type);

	if(overapproximation) {
		assert.ok(length.leq(inferred.length), `Expected vector for criterion "${criterion}" to have an over-approximation of length ${length.toString()}, but got ${inferred.length.toString()}`);
		assert.ok(known.leq(inferred.known), `Expected vector for criterion "${criterion}" to have an over-approximation of known values ${known.toString()}, but got ${inferred.known.toString()}`);
		assert.ok(summary.leq(inferred.summary), `Expected vector for criterion "${criterion}" to have an over-approximation of summary ${summary.toString()}, but got ${inferred.summary.toString()}`);
		assert.ok(attributes.leq(inferred.attributes), `Expected vector for criterion "${criterion}" to have an over-approximation of attributes ${attributes.toString()}, but got ${inferred.attributes.toString()}`);
		assert.ok(type.leq(inferred.type), `Expected vector for criterion "${criterion}" to have an over-approximation of type ${type.toString()}, but got ${inferred.type.toString()}`);
	} else {
		assert.ok(inferred.length.equals(length), `Expected vector for criterion "${criterion}" to have length ${length.toString()}, but got ${inferred.length.toString()}`);
		assert.ok(inferred.known.equals(known), `Expected vector for criterion "${criterion}" to have known values ${known.toString()}, but got ${inferred.known.toString()}`);
		assert.ok(inferred.summary.equals(summary), `Expected vector for criterion "${criterion}" to have summary ${summary.toString()}, but got ${inferred.summary.toString()}`);
		assert.ok(inferred.attributes.equals(attributes), `Expected vector for criterion "${criterion}" to have attributes ${attributes.toString()}, but got ${inferred.attributes.toString()}`);
		assert.ok(inferred.type.equals(type), `Expected vector for criterion "${criterion}" to have type ${type.toString()}, but got ${inferred.type.toString()}`);
	}
}
